# rumahl OS Dev — VS Code extension

A first-class VS Code companion for hot-deploying [rumahl OS](https://github.com/rumahl-os/rumahl-os)
components from your laptop to a dev device on the LAN.

It is paired with the **`rumahl-dev-deploy`** Rust daemon (in
[`../rumahl-dev-deploy`](../rumahl-dev-deploy)), which the extension auto-spawns
in the background and talks to over a local HTTP/WebSocket API.

## Highlights

* **Auto-managed daemon** — `rumahl-dev-deploy daemon` runs in the background and
  exposes a versioned JSON API (`/api/v1/*`) plus a live event stream
  (`/api/v1/events`). The extension auto-starts it on activation and writes
  the URL + bearer token to `~/.config/rumahl-dev-deploy/daemon.json`.
* **Discovery** — mDNS scan for `_rumahl-dev._tcp.local.` devices, results
  shown in the *Devices* tree view.
* **Deploy** — pick component(s) from the catalog or use *Deploy Current Crate*
  to deduce the target from the open file. Cross-compiles, uploads, and
  restarts the systemd unit on the device.
* **Watch sessions** — start/stop file-watch sessions per component; the
  extension shows them live in the *Watch Sessions* view.
* **Recent jobs** — the *Recent Jobs* view shows every build/deploy/log job
  with status icons and per-job logs.
* **Dashboard webview** — a single panel summarising connection, devices,
  watch sessions and jobs, with one-click actions.
* **Logs / restart / reload / compose-reload** — every device-side dev-bridge
  endpoint is exposed as a palette command.

## Install

### From a `.vsix`

```sh
cd rumahl-os/tools/vscode-rumahl-dev
npm install
npm run package        # produces rumahl-dev.vsix
code --install-extension rumahl-dev.vsix
```

### From source (extension dev host)

Open `rumahl-os/tools/vscode-rumahl-dev` in VS Code and press **F5**.

You also need the `rumahl-dev-deploy` binary on your PATH (or set
`oraDev.cliPath`).

```sh
cd rumahl-os/tools/rumahl-dev-deploy
cargo install --path .       # → ~/.cargo/bin/rumahl-dev-deploy
```

## Settings

| key | default | meaning |
| --- | --- | --- |
| `oraDev.cliPath` | `rumahl-dev-deploy` | Path to the daemon binary. |
| `oraDev.daemon.url` | (empty) | Override daemon URL — empty means read `~/.config/rumahl-dev-deploy/daemon.json` or auto-spawn. |
| `oraDev.daemon.token` | (empty) | Override bearer token. |
| `oraDev.daemon.autoStart` | `true` | Auto-spawn the daemon on activation. |
| `oraDev.daemon.bind` | `127.0.0.1:8765` | Bind address used when auto-starting. |
| `oraDev.target` | `aarch64-unknown-linux-gnu` | Cross-compile target triple. |
| `oraDev.discoverTimeoutSecs` | `4` | mDNS scan duration. |
| `oraDev.watchDebounceMs` | `800` | File-watch debounce window. |

## Commands

| Command | What it does |
| --- | --- |
| `rumahl Dev: Discover Devices on LAN` | mDNS scan, populates the Devices view. |
| `rumahl Dev: Connect to Device…` | Save host + dev token after a `variant=="dev"` check. |
| `rumahl Dev: Disconnect Saved Device` | Clear saved device. |
| `rumahl Dev: Show Device Status` | Print `/dev/status` to the output channel. |
| `rumahl Dev: Deploy Component(s)…` | QuickPick → build → upload → restart. |
| `rumahl Dev: Deploy Current Crate` | Same, deduced from the open file. |
| `rumahl Dev: Watch Component(s)…` | Start a long-running watch session. |
| `rumahl Dev: Stop Watch Session` | Stop a running session by id. |
| `rumahl Dev: Restart systemd Unit…` | `systemctl restart` on the device. |
| `rumahl Dev: Reload systemd Unit…` | `systemctl try-reload-or-restart`. |
| `rumahl Dev: Reload Compose Service…` | `docker compose up -d --force-recreate`. |
| `rumahl Dev: Tail Compose Logs…` | Tail the last 500 lines into the output channel. |
| `rumahl Dev: Open Dashboard` | Webview with live state. |
| `rumahl Dev: Start/Stop Daemon` | Manual daemon lifecycle control. |

## Safety

Both the daemon and the on-device dev-bridge refuse to operate unless
`/dev/status` reports `variant == "dev"`. Production OS images do not ship
the dev-bridge binary at all, so the extension cannot accidentally talk to a
production device.

## License

[MIT](LICENSE)
