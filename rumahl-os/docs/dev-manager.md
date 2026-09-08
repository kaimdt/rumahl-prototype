# rumahl Dev Manager

`rumahl-dev-manager` is the cross-platform Rust control plane for the local QEMU development environment: comparable to a small Proxmox VE instance dedicated to the rumahl VM. It provides the same ratatui/crossterm interface on Windows, macOS, and Linux. QEMU launch, lifecycle control, QMP, QGA, health, services, connections, snapshots, recovery, and presentation are owned by one compiled program.

## Start

```shell
cd rumahl-os/backend
cargo run -p rumahl-dev-manager -- --root ..
```

On Windows, `rumahl-os/dev-manager.ps1` automatically launches the compiled Rust manager or builds it through Cargo. Its former PowerShell menu remains a compatibility fallback when Rust is unavailable; set `RUMAHL_DEV_MANAGER_LEGACY=1` only when that fallback is explicitly needed.

The dashboard reconstructs a running VM from `.cache/runtime-state.json`, validates its QEMU process and QMP endpoint, queries QGA, refreshes a changed bridge IP, and only then derives SSH and web endpoints.

For automation, `cargo run -p rumahl-dev-manager -- --root .. --doctor` runs the same readiness model without opening the TUI.

## Architecture

```text
rumahl-dev-manager (one Rust TUI on Windows, macOS and Linux)
├── state.rs                       atomic state, validation, endpoints
├── channels.rs                    TCP/Unix QMP and QGA transport
├── devloop.rs                     native sync, HMR and targeted rebuild pipeline
├── manager.rs                     lifecycle, health, process and host integration
├── main.rs                        event loop and ratatui application
└── rumahl-dev-watch                 reusable build/deploy implementation
```

The runtime state is the shared source of truth, not a replacement for live checks. Every manager refresh validates the PID, QMP and QGA. In bridge mode QGA refreshes the DHCP address and SSH is always derived as `<current LAN IP>:22`. In Slirp mode the endpoint remains `127.0.0.1:<forwarded port>`.

## Readiness model

The environment progresses through `Stopped`, `Starting`, `Booting`, `Provisioning`, `Waiting for network`, `Waiting for dependencies`, `Starting services`, `Degraded`, and `Ready`.

`Ready` requires a live QEMU PID, QMP, QGA, operational systemd, guest networking, successful internal and host-side `rumahl-home` health, and the native live-development watcher. SSH is reported independently and is not required for VM administration.

An internally healthy but externally unreachable home service is reported as `Degraded`, with bind-address, firewall, stale bridge address, and routing checks suggested separately.

## QGA-first recovery

The manager uses the guest agent for systemd state, service logs, listening sockets, PostgreSQL readiness, IP discovery, and critical service startup. On Windows it uses the QGA/QMP TCP channels; on macOS and Linux it automatically uses the existing Unix sockets. SSH remains an optional interactive connection.

The Rust TUI provides native QEMU launch, the live Doctor, failed-unit logs, QMP pause/resume/reset, QGA-first graceful shutdown, hard stop, SSH, QGA rescue commands, browser launch, and compressed Golden Snapshots. It never starts `dev-local.ps1` or `dev-local.sh` to perform VM lifecycle operations.

The log view reads journald through QGA and falls back to the host-side manager log when the guest channel is unavailable.

## Monitoring and recovery

The web dashboard includes a **Monitoring** workspace that checks invariants
inside the guest through QGA: the canonical JWT file, Home, Files, Supervisor,
Docker, Docker Compose, the Files health endpoint, disk usage, and failed
systemd units. It refreshes while visible and therefore remains useful when
the normal rumahl frontend or guest network is broken.

**Synchronize config & JWT** runs the repository's `rumahl-config-sync.sh` as
root in the guest, verifies `/etc/ora/jwt-secret`, reloads systemd, and
restarts only `rumahl-home`, `rumahl-files`, and `rumahl-supervisor`. This is the
manual recovery action for cross-service 401 errors; its result is immediately
reflected in the monitoring table. The synchronizer recovers the shared secret
from PostgreSQL, the canonical or fallback secret files, or the previous service
environment. If no valid value exists, it generates a cryptographically random
secret and persists it back to PostgreSQL when the database is reachable.

**Install Docker Compose** repairs development guests that have Docker Engine
but neither the Compose v2 plugin nor the standalone `docker-compose` command.
It selects the first compatible package exposed by the guest's APT repositories,
verifies the command, and restarts `rumahl-supervisor`. Newly provisioned Linux
and Windows-hosted development VMs install `docker-compose` with Docker Engine,
so the recovery action is primarily intended for existing VMs.

## Independent VM control plane

The Rust VM view exposes start, pause, resume, reset, graceful guest shutdown, hard process stop, SSH, browser launch, and the QGA rescue prompt. Hypervisor actions go directly through QMP rather than being inferred from SSH.

QEMU configuration is cross-platform and native. `RUMAHL_DEV_QEMU`, `RUMAHL_DEV_QEMU_IMG`, `RUMAHL_DEV_ACCEL`, `RUMAHL_DEV_RAM`, `RUMAHL_DEV_CPUS`, and `RUMAHL_DEV_TAP` override binary, acceleration, resources, and bridge adapter without adding more launcher scripts.

SSH is optional. Press `g` to execute a root rescue command through QGA without network access. Service listing, restart, health inspection, failed-unit diagnosis, and journald access use QGA directly and remain available when the guest network, firewall, or SSH daemon is broken.

## Native live development

The manager watches the repository directly through Rust `notify`; `dev-sync.sh` is not started. Changes are debounced, filtered, and copied incrementally to `/home/ora/ora`. SSH/SCP is used when healthy, while files up to 1 MiB fall back to QGA transfer when SSH is broken.

Frontend source changes are immediately available to the Vite server and therefore use normal HMR without a service restart. Changes to Vite, TypeScript, PostCSS, Tailwind, or package configuration restart and validate `rumahl-frontend-dev`.

For Rust, migrations, Cargo manifests, and systemd definitions, the manager queries `cargo metadata`, finds the owning crate, follows reverse dependencies, and processes only affected rumahl services. Builds run inside the VM so produced binaries match rumahl OS. Services are restarted sequentially and must pass `systemctl is-active` before the pipeline reports success.

New crates under `backend/services` or `backend/apps/system` are discovered from Cargo metadata automatically. If a matching unit does not yet exist, the manager installs a development systemd unit with the rumahl source workspace, `ora` user, PostgreSQL ordering, restart policy, and native debug binary. Adding a service therefore requires adding it to the Rust workspace and creating its crate; no additional watcher or launcher script is required.

## Script consolidation

Rust is the user-facing and cross-platform source of truth. The existing PowerShell and shell files are retained only for backward compatibility and initial legacy image creation; the manager does not invoke them for VM lifecycle, source synchronization, health, or live reload. A prepared `.cache/rumahl-dev-vm.qcow2` can be started, controlled, developed against, diagnosed, and snapshotted entirely from the Rust process. New development-server functionality belongs in `rumahl-dev-manager` rather than in another platform-specific script.

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
