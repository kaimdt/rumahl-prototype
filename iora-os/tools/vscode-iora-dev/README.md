# IORA OS Dev — VS Code extension

A first-class VS Code companion for hot-deploying [IORA OS](https://github.com/iora-os/iora-os)
components from your laptop to a dev device on the LAN.

It is paired with the **`iora-dev-deploy`** Rust daemon (in
[`../iora-dev-deploy`](../iora-dev-deploy)), which the extension auto-spawns
in the background and talks to over a local HTTP/WebSocket API.

## Highlights

* **Auto-managed daemon** — `iora-dev-deploy daemon` runs in the background and
  exposes a versioned JSON API (`/api/v1/*`) plus a live event stream
  (`/api/v1/events`). The extension auto-starts it on activation and writes
  the URL + bearer token to `~/.config/iora-dev-deploy/daemon.json`.
* **Discovery** — mDNS scan for `_iora-dev._tcp.local.` devices, results
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
cd iora-os/tools/vscode-iora-dev
npm install
npm run package        # produces iora-dev.vsix
code --install-extension iora-dev.vsix
```

### From source (extension dev host)

Open `iora-os/tools/vscode-iora-dev` in VS Code and press **F5**.

You also need the `iora-dev-deploy` binary on your PATH (or set
`ioraDev.cliPath`).

```sh
cd iora-os/tools/iora-dev-deploy
cargo install --path .       # → ~/.cargo/bin/iora-dev-deploy
```

## Settings

| key | default | meaning |
| --- | --- | --- |
| `ioraDev.cliPath` | `iora-dev-deploy` | Path to the daemon binary. |
| `ioraDev.daemon.url` | (empty) | Override daemon URL — empty means read `~/.config/iora-dev-deploy/daemon.json` or auto-spawn. |
| `ioraDev.daemon.token` | (empty) | Override bearer token. |
| `ioraDev.daemon.autoStart` | `true` | Auto-spawn the daemon on activation. |
| `ioraDev.daemon.bind` | `127.0.0.1:8765` | Bind address used when auto-starting. |
| `ioraDev.target` | `aarch64-unknown-linux-gnu` | Cross-compile target triple. |
| `ioraDev.discoverTimeoutSecs` | `4` | mDNS scan duration. |
| `ioraDev.watchDebounceMs` | `800` | File-watch debounce window. |

## Commands

| Command | What it does |
| --- | --- |
| `IORA Dev: Discover Devices on LAN` | mDNS scan, populates the Devices view. |
| `IORA Dev: Connect to Device…` | Save host + dev token after a `variant=="dev"` check. |
| `IORA Dev: Disconnect Saved Device` | Clear saved device. |
| `IORA Dev: Show Device Status` | Print `/dev/status` to the output channel. |
| `IORA Dev: Deploy Component(s)…` | QuickPick → build → upload → restart. |
| `IORA Dev: Deploy Current Crate` | Same, deduced from the open file. |
| `IORA Dev: Watch Component(s)…` | Start a long-running watch session. |
| `IORA Dev: Stop Watch Session` | Stop a running session by id. |
| `IORA Dev: Restart systemd Unit…` | `systemctl restart` on the device. |
| `IORA Dev: Reload systemd Unit…` | `systemctl try-reload-or-restart`. |
| `IORA Dev: Reload Compose Service…` | `docker compose up -d --force-recreate`. |
| `IORA Dev: Tail Compose Logs…` | Tail the last 500 lines into the output channel. |
| `IORA Dev: Open Dashboard` | Webview with live state. |
| `IORA Dev: Start/Stop Daemon` | Manual daemon lifecycle control. |

## Safety

Both the daemon and the on-device dev-bridge refuse to operate unless
`/dev/status` reports `variant == "dev"`. Production OS images do not ship
the dev-bridge binary at all, so the extension cannot accidentally talk to a
production device.

## License

[MIT](LICENSE)
