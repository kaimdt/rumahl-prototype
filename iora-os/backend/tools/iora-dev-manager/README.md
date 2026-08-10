# IORA Dev Manager

Background daemon + web dashboard for the IORA OS development VM. It is the
recommended entry point on Windows, where `dev-local.ps1` has friction
(PowerShell 5.1 UTF-8 parsing, per-module security prompts for downloaded
scripts). The manager handles all of that for you.

## Quick start

```powershell
# Build (once)
cargo build -p iora-dev-manager

# Run the daemon + dashboard (http://localhost:8127)
.\target\debug\iora-dev-manager.exe serve --open
```

On startup the manager **auto-starts the VM** (provisioning it first when
the disk is missing) — no need to run `dev-local.ps1` manually. While the
cloud image is downloaded, the dashboard shows the **"Vorbereitung"**
(Preparing) state with a live progress bar (percent, MB, rate, ETA) and the
controls stay disabled. The dashboard stays responsive during the download
(the QEMU process scan is cached, log reads are incremental):

- WHPX is tried first, with an automatic **TCG fallback** when Hyper-V/WHP
  is unavailable (no disk modification on failure).
- TCG resources are clamped (4-8 GB RAM, 2-8 vCPUs).
- When the disk is missing, the provisioning bootstrap is launched with
  **Unblock-File applied** to all scripts (no security prompts) and
  **PowerShell 7** when installed (correct UTF-8 parsing).
- The watchdog waits for an in-progress provision instead of declaring the
  VM dead.
- The dashboard is served on a **dedicated runtime** (its own worker
  threads): blocking host work (image download, process scans, SSH tunnels)
  can never stall the web UI. The QEMU-process scan runs via
  `spawn_blocking` and is cached; log reads are incremental.

## Common commands

```powershell
iora-dev-manager serve --open   # daemon + dashboard, auto-start VM
iora-dev-manager status         # JSON status (lifecycle, last error)
iora-dev-manager logs           # recent QEMU / manager output
iora-dev-manager doctor         # diagnostics, exits 0 when Ready
iora-dev-manager start          # start the VM (daemon must run)
iora-dev-manager stop           # graceful guest shutdown
iora-dev-manager kill           # force-kill QEMU
iora-dev-manager guest "<cmd>"  # run a command in the guest (no IP needed)
```

## Configuration (environment variables)

| Variable | Effect |
| --- | --- |
| `IORA_DEV_NO_AUTOSTART=1` | Do not auto-start the VM when the daemon boots |
| `IORA_DEV_ACCEL=tcg` | Skip WHPX/HVF/KVM, force TCG |
| `IORA_DEV_SKIP_WHPX=1` | Windows: skip the WHPX attempt (TCG only) |
| `IORA_DEV_RAM=4G` / `IORA_DEV_CPUS=2` | VM sizing (TCG clamps to 4-8 GB / 2-8 CPUs) |
| `IORA_DEV_TAP=iora-tap0` | Bridge-mode TAP adapter name |
| `IORA_OS_ROOT=...` | iora-os root (auto-discovered from the working dir) |
