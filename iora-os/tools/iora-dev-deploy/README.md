# iora-dev-deploy

A **developer-machine** companion CLI for the **internal, non-public** IORA OS
Dev variant.  It discovers IORA OS Dev devices on the local network, recompiles
IORA components, and hot-deploys them — all from your laptop.

> This binary is built and run on the developer's workstation. It never ships
> on a customer image.

## Why dev-only?

The on-device counterpart, [`iora-dev-bridge`](../iora-dev-bridge), is **only
installed on images built with `IORA_OS_DEV=1`**:

* The binary `/usr/bin/iora-dev-bridge` does not exist on production images.
* The systemd unit is not installed on production images.
* The bridge refuses to start unless `/etc/iora/os-dev-mode` is present.
* It also advertises itself over mDNS as `_iora-dev._tcp.local.` only when running.
* Every CLI command first calls `GET /dev/status` and aborts unless the device
  reports `variant == "dev"`.

So a production IORA OS will never appear in `discover` and will never accept
a deploy — even if someone tried to point the CLI at its IP.

## Install

From the repo root:

```sh
cd iora-os/tools/iora-dev-deploy
cargo install --path .
```

You also need a Linux cross-compile target for the device's CPU. For Raspberry
Pi 4/5 and most IORA OS hardware:

```sh
rustup target add aarch64-unknown-linux-gnu
# Plus a linker, e.g. on Debian/Ubuntu:
sudo apt install gcc-aarch64-linux-gnu
```

…and add to `~/.cargo/config.toml`:

```toml
[target.aarch64-unknown-linux-gnu]
linker = "aarch64-linux-gnu-gcc"
```

## Quickstart

```sh
# 1. Find IORA OS Dev devices on your LAN (mDNS).
iora-dev-deploy discover

# 2. Save one as the default.  Token comes from /etc/iora/dev-token on the device
#    (printed at the end of the dev-image build).
iora-dev-deploy connect 192.168.1.42:8099 --token 0123abcd…

# 3. Sanity check.
iora-dev-deploy status

# 4. Build & deploy a single component.
iora-dev-deploy deploy iora-control

# 5. Live-reload while you code.
iora-dev-deploy watch iora-control iora-home

# 6. Restart a unit / read logs.
iora-dev-deploy restart iora-control
iora-dev-deploy logs iora-stack --tail 500
```

## Subcommands

| command | description |
| --- | --- |
| `discover [--timeout S]` | mDNS browse for `_iora-dev._tcp.local.`, list devices. |
| `connect HOST --token HEX` | Verify variant=dev and save default device. |
| `status` | Show `/dev/status` (build, hostname, capabilities). |
| `list` | Show all known IORA components and their on-device paths. |
| `deploy <c1> [c2…]` | `cargo build --release -p <c>` then upload + restart. |
| `watch <c1> [c2…]` | File-watch each crate (and `iora-shared`); auto-deploy on save. |
| `restart <unit>` | `systemctl restart <unit>` on the device. |
| `logs <svc> [--tail N]` | `docker compose logs --tail N <svc>`. |

Common flags:

* `--host HOST` / `IORA_DEV_HOST` — override saved device.
* `--token HEX` / `IORA_DEV_TOKEN` — override saved token.
* `--target TRIPLE` — cross-compile target (default `aarch64-unknown-linux-gnu`).
* `--no-build`, `--no-restart` — skip cargo build / unit restart.

## VS Code integration

A companion extension in [`../vscode-iora-dev`](../vscode-iora-dev)
wraps these commands with a status-bar item, palette commands, and a tree view.
The extension simply spawns this CLI; if you have it installed, the extension
works.

## Safety summary

| risk | mitigation |
| --- | --- |
| Production OS receives a deploy | `iora-dev-bridge` not shipped on prod images; CLI checks `variant == "dev"` before every action; mDNS service only advertised by the bridge. |
| Token leak | Per-image token in `/etc/iora/dev-token`; constant-time comparison; HTTP exposed only to LAN by explicit opt-in. |
| Path traversal / arbitrary-binary install | Device-side allowlist (`/usr/bin/iora-*`, `/opt/iora/`, `/mnt/data/iora/**`). |
| Arbitrary unit restart | Device-side allowlist (`iora-*.service`, `docker.service`, `iora-stack.service`). |
| SHA mismatch / corruption | CLI computes SHA-256, server verifies; atomic rename only on full match. |
