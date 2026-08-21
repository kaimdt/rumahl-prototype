# rumahl-dev-deploy

A **developer-machine** companion CLI for the **internal, non-public** rumahl OS
Dev variant.  It discovers rumahl OS Dev devices on the local network, recompiles
rumahl components, and hot-deploys them — all from your laptop.

> This binary is built and run on the developer's workstation. It never ships
> on a customer image.

## Why dev-only?

The on-device counterpart, [`rumahl-dev-bridge`](../rumahl-dev-bridge), is **only
installed on images built with `RUMAHL_OS_DEV=1`**:

* The binary `/usr/bin/rumahl-dev-bridge` does not exist on production images.
* The systemd unit is not installed on production images.
* The bridge refuses to start unless `/etc/ora/os-dev-mode` is present.
* It also advertises itself over mDNS as `_rumahl-dev._tcp.local.` only when running.
* Every CLI command first calls `GET /dev/status` and aborts unless the device
  reports `variant == "dev"`.

So a production rumahl OS will never appear in `discover` and will never accept
a deploy — even if someone tried to point the CLI at its IP.

## Install

From the repo root:

```sh
cd rumahl-os/tools/rumahl-dev-deploy
cargo install --path .
```

You also need a Linux cross-compile target for the device's CPU. For Raspberry
Pi 4/5 and most rumahl OS hardware:

```sh
rustup target add aarch64-unknown-linux-gnu
# Plus a linker, e.g. on Debian/Ubuntu:
sudo apt install gcc-aarch64-linux-gnu
```

On Windows or macOS, if the native target toolchain is missing the CLI can now
fall back to a Docker-based cross-compile container when `cargo build --target`
fails. Ensure Docker Desktop is installed and running on your host before using
that path.

…and add to `~/.cargo/config.toml`:

```toml
[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"
```

## Quickstart

```sh
# 1. Find rumahl OS Dev devices on your LAN (mDNS).
rumahl-dev-deploy discover

# 2. Save one as the default.  Token comes from /etc/ora/dev-token on the device
#    (printed at the end of the dev-image build).
rumahl-dev-deploy connect 192.168.1.42:8099 --token 0123abcd…

# 3. Sanity check.
rumahl-dev-deploy status

# 4. Build & deploy a single component.
rumahl-dev-deploy deploy rumahl-control

# 5. Live-reload while you code.
rumahl-dev-deploy watch rumahl-control rumahl-home

# 6. Restart a unit / read logs.
rumahl-dev-deploy restart rumahl-control
rumahl-dev-deploy logs rumahl-stack --tail 500
```

## Subcommands

| command | description |
| --- | --- |
| `discover [--timeout S]` | mDNS browse for `_rumahl-dev._tcp.local.`, list devices. |
| `connect HOST --token HEX` | Verify variant=dev and save default device. |
| `status` | Show `/dev/status` (build, hostname, capabilities). |
| `list` | Show all known rumahl components and their on-device paths. |
| `deploy <c1> [c2…]` | `cargo build --release -p <c>` then upload + restart. |
| `watch <c1> [c2…]` | File-watch each crate (and `rumahl-shared`); auto-deploy on save. |
| `restart <unit>` | `systemctl restart <unit>` on the device. |
| `logs <svc> [--tail N]` | `docker compose logs --tail N <svc>`. |

Common flags:

* `--host HOST` / `RUMAHL_DEV_HOST` — override saved device.
* `--token HEX` / `RUMAHL_DEV_TOKEN` — override saved token.
* `--target TRIPLE` — cross-compile target (default `aarch64-unknown-linux-gnu`).
* `--no-build`, `--no-restart` — skip cargo build / unit restart.

## VS Code integration

A companion extension in [`../vscode-rumahl-dev`](../vscode-rumahl-dev)
wraps these commands with a status-bar item, palette commands, and a tree view.
The extension simply spawns this CLI; if you have it installed, the extension
works.

## Safety summary

| risk | mitigation |
| --- | --- |
| Production OS receives a deploy | `rumahl-dev-bridge` not shipped on prod images; CLI checks `variant == "dev"` before every action; mDNS service only advertised by the bridge. |
| Token leak | Per-image token in `/etc/ora/dev-token`; constant-time comparison; HTTP exposed only to LAN by explicit opt-in. |
| Path traversal / arbitrary-binary install | Device-side allowlist (`/usr/bin/rumahl-*`, `/opt/rumahl/`, `/mnt/data/ora/**`). |
| Arbitrary unit restart | Device-side allowlist (`rumahl-*.service`, `docker.service`, `rumahl-stack.service`). |
| SHA mismatch / corruption | CLI computes SHA-256, server verifies; atomic rename only on full match. |
