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

## Configuration

### dev-manager.json (persistent settings)

The dashboard tab **VM Settings** edits `dev-manager.json` (in the `iora-os`
root, next to `dev-local.ps1`). All values apply to the NEXT VM start
or to every NEW disk creation (first boot / `-Rebuild`):

| Key | Default | Effect |
| --- | --- | --- |
| `defaultDiskGb` | `40` | Virtual disk size for newly created VM disks (GB) |
| `defaultRamGb` | `8` | VM RAM when no `IORA_DEV_RAM` override is set (GB) |
| `defaultCpus` | `4` | vCPU count when no `IORA_DEV_CPUS` override is set |
| `autostart` | `false` | Start the VM automatically when the daemon boots |
| `sftpUser` | `root` | User for the SFTP file-access link |
| `extraPorts` | `""` | Extra host ports forwarded to the guest (comma list) |

The provisioning bootstrap (`dev-local.ps1`) receives `-DiskSize`, `-Ram`
and `-CpuCount` automatically, so a changed disk size is honored on every
new creation. `dev-local.ps1` itself also accepts `-DiskSize <N>G` directly
(env fallback `IORA_DEV_DISK`).

### Disk expansion (Dashboard → Disk &amp; Storage)

* Running VM: live resize via QMP `block_resize` (safe, no host-side races),
  then the guest root partition + filesystem are grown automatically via
  QGA (`growpart` + `resize2fs`/`xfs_growfs`).
* Stopped VM: `qemu-img resize`, the filesystem grows on the next boot
  (the daemon runs the grow step automatically once the guest is up).

### Files access (SFTP + iora-files web UI)

* **SFTP auto-link** in the dashboard (Access &amp; Credentials):
  `sftp://root@127.0.0.1:2222/` plus a direct download of the private key
  (`/api/sftp/key`) for WinSCP / FileZilla.
* **iora-files web UI**: port `8100` is forwarded automatically
  (default mapping) — every file of IORA OS is browsable at
  `http://127.0.0.1:8100`.
* API: `GET /api/disk`, `POST /api/disk/resize {sizeGb}`, `GET/POST
  /api/settings`, `GET /api/sftp/key`.

### Force Sync &amp; Rebuild (Monitoring tab)

`POST /api/maintenance/force-sync` (button „Force Sync &amp; Rebuild“ in the
Monitoring tab): pushes **every** relevant source file into the guest
unconditionally (no drift check - repairs mtime skew and missed watcher
events), then rebuilds all affected IORA services via
`cargo build -p <service> --offline` in the guest and restarts them
(creating missing systemd units on demand). The frontend dev server is
restarted afterwards. Runs detached; progress appears in the live log
stream (Logs tab).

## Environment variables

| Variable | Effect |
| --- | --- |
| `IORA_DEV_NO_AUTOSTART=1` | Do not auto-start the VM when the daemon boots |
| `IORA_DEV_ACCEL=tcg` | Skip WHPX/HVF/KVM, force TCG |
| `IORA_DEV_SKIP_WHPX=1` | Windows: skip the WHPX attempt (TCG only) |
| `IORA_DEV_RAM=4G` / `IORA_DEV_CPUS=2` | VM sizing (TCG clamps to 4-8 GB / 2-8 CPUs) |
| `IORA_DEV_DISK=60G` | Disk size for NEW VM disks (dev-local fallback) |
| `IORA_DEV_TAP=iora-tap0` | Bridge-mode TAP adapter name |
| `IORA_OS_ROOT=...` | iora-os root (auto-discovered from the working dir) |
