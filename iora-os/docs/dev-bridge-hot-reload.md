# Hot-Reload, Builds & Live Logs

This document describes the IORA OS Dev Bridge hot-reload pipeline as of
v0.4 of the VS Code extension (`iora-dev` 0.4.0) and the `iora-dev-deploy`
daemon.

## TL;DR for Windows users

If you are developing IORA on **Windows**, do not change the default
build mode. The default is `auto`, which on Windows resolves to *device
build* — the workspace is sent to the IORA device and built there.

You'll see a log line like:

```
build strategy for iora-watchdog: device build
▶ device build (5 312 ms, incremental cache @ /var/lib/iora-dev/builds/iora-watchdog)
```

Subsequent builds reuse the persistent cache on the device, so saving
one source file rebuilds in 3–10 s, not 2–3 minutes.

## Build modes

| mode      | behaviour                                                                      | typical latency   | notes                                  |
|-----------|--------------------------------------------------------------------------------|-------------------|----------------------------------------|
| `auto` (default) | Picks the best strategy per component automatically                     | best available    | recommended for everyone               |
| `device`  | Always upload + build incrementally on the device                              | 5–10 s            | works on every host (Windows, macOS)   |
| `host`    | Build locally (cargo if possible, docker if not, never device)                 | depends on host   | requires cross-toolchain or docker     |
| `cargo`   | Force `cargo build --target …`                                                 | depends on host   | will fail on Windows for ARM Linux     |
| `docker`  | Force docker `rust:1.90`                                                       | depends on host   | requires Docker Desktop / Engine       |

The auto-resolver lives in [`iora-dev-deploy/src/build.rs`](../tools/iora-dev-deploy/src/build.rs)
in `resolve_strategy()`. The decision matrix for non-bridge components is:

1. If `host_can_cross_compile(target)` → `cargo`
2. Else if Docker is on PATH → `docker`
3. Else → `device`

`host_can_cross_compile` refuses to attempt cross-compilation from
Windows to Linux/ARM unless `IORA_DEV_TRUST_HOST_CROSS=1` is set
(because almost nobody has the Linux/ARM linker installed on Windows
and the failure mode is a cryptic `linker error`). The same heuristic
applies to macOS hosts that don't have an `aarch64-…-gnu-gcc` linker.

## Persistent on-device build cache

The `/dev/build-replace` endpoint on the bridge now extracts the
backend bundle into:

```
/var/lib/iora-dev/builds/<component>/
├── backend/                ← extracted source tree (overwritten each upload)
├── cargo-target/           ← CARGO_TARGET_DIR (incremental cache, persistent)
└── cargo-home/             ← CARGO_HOME (rust-std + git deps, persistent)
```

The first build is full (~2–3 min on a Pi 4 for a typical service),
every subsequent build is incremental and finishes in seconds. The
response includes `elapsed_ms`, `workspace`, and `incremental: true`
so the IDE can surface the speedup.

The bridge cleans up the legacy `/tmp/iora-dev-build-*` directories
from older versions on every restart so /tmp doesn't fill up.

## Live logs in VS Code

Right-click any service in the **Services (live)** tree → *Open Live
Logs*, or run **IORA Dev: Open Live Logs…** from the command palette.
A dedicated Output channel is created (named `IORA: <unit>`) and
streams `journalctl -u <unit> -f` in real time via Server-Sent Events.

The streamer runs entirely client-side (Node 18+ `fetch` with a
`ReadableStream` body, no `eventsource` polyfill, no extra deps) and
auto-reconnects with exponential backoff if the connection drops, so
restarting a service never tears down the live log view.

Stop a session with **IORA Dev: Stop Live Logs…** (multi-select).

## Other useful commands

| command                                  | what it does                                                        |
|------------------------------------------|---------------------------------------------------------------------|
| `IORA Dev: Service Actions…`             | Quick-pick one service then pick an action (also: status-bar click) |
| `IORA Dev: Open Service URL`             | Opens the service's reported URL in your browser                    |
| `IORA Dev: Show Device System Info`      | CPU/memory/disk/uptime read from `/proc` on the device              |
| `IORA Dev: Reboot Device`                | `systemctl reboot` on the device (with confirmation)                |
| `IORA Dev: Tail Service Logs…`           | One-shot tail (300 lines), no streaming                              |

The status bar item now reflects mesh health: it tints red when any
service is unhealthy or stale, yellow when degraded, and shows
`X/N services up`. Clicking it opens the service action quick-pick.

## Troubleshooting

* **Hot-reload silent / nothing happens**: open the Output panel and
  pick the `IORA OS Dev` channel — every watch trigger logs there.
  Common cause: the watch session was started in `host` mode on a host
  that can't cross-compile. Solution: switch to `auto` or `device`.

* **`linker not found` on Windows**: you forced `cargo` mode. Either
  install a cross toolchain and `IORA_DEV_TRUST_HOST_CROSS=1`, or
  switch back to `auto`.

* **Builds still slow**: check the device has enough free disk in
  `/var/lib`. The persistent build cache lives there. `IORA Dev:
  Show Device System Info` displays `disk /` usage.

* **Live logs stop after a restart of the service**: that's expected
  behaviour for the bridge — the SSE socket follows the journal, not
  the service process. The streamer auto-reconnects.
