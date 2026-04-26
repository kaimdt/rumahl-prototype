# vscode-iora-dev

VS Code companion for [`iora-dev-deploy`](../iora-dev-deploy).

This extension is a thin wrapper around the Rust CLI. The CLI does all of the
work (mDNS discovery, building, uploading, watching); the extension just adds
palette commands, a status bar item, and a tree view.

## Build

```sh
cd iora-os/tools/vscode-iora-dev
npm install
npm run compile
```

Then either:

* **Dev**: open this folder in VS Code and press `F5` (Extension Development Host).
* **Install**: package with `vsce package` and `code --install-extension iora-dev-*.vsix`.

## Settings

| key | default | meaning |
| --- | --- | --- |
| `ioraDev.cliPath` | `iora-dev-deploy` | Path to the CLI binary. |
| `ioraDev.target`  | `aarch64-unknown-linux-gnu` | Cross-compile target. |
| `ioraDev.host`    | (empty) | Override saved device host. |
| `ioraDev.token`   | (empty) | Override saved dev token. |

## Commands

* **IORA Dev: Discover Devices on LAN**
* **IORA Dev: Connect to Device…**
* **IORA Dev: Show Device Status**
* **IORA Dev: Deploy Component…**
* **IORA Dev: Deploy Current Crate** (deduces the crate from the active editor file)
* **IORA Dev: Watch Component(s)…**
* **IORA Dev: Restart Unit…**
* **IORA Dev: Tail Compose Logs…**

## Safety

The same dev-only safety guarantee as the CLI: the on-device counterpart only
exists on dev images, and the CLI checks `variant == "dev"` before every
action. The extension cannot bypass either check.
