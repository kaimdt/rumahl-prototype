#!/usr/bin/env python3
"""IORA Home First-Boot Setup Wizard.

A self-contained web application that runs on first boot (or standalone)
to guide users through initial IORA Home configuration.

Listens on port 8080. After setup completes, it writes configuration
to /mnt/data/iora/ and disables itself.

Can also be run standalone (without IORA OS) as a setup tool.
"""

import hashlib
import http.server
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.parse

SETUP_PORT = 8080
DATA_DIR = "/mnt/data/iora"
CONFIG_FILE = "/mnt/data/iora/setup.json"
SETUP_DONE_FLAG = "/mnt/data/iora/.setup-complete"
# Persistent apply-progress state — survives a browser reload and is shared
# across all open tabs so the user can close/reopen the page without losing
# visibility into the running setup. Lives on the data partition when
# available, falls back to rootfs.
SETUP_STATE_FILE = "/mnt/data/iora/setup-state.json"
IORA_VERSION_FILE = "/etc/iora-version"
UPDATE_SERVER = "https://update.kaimdt.com"
DOWNLOAD_SERVER = "https://dist.kaimdt.com"

# Security constants
RECOVERY_PIN_HASH_FILE = "/etc/iora/recovery-pin.hash"
DATA_KEYFILE = "/etc/iora/data.keyfile"
DATA_DEV = "/dev/disk/by-label/iora-data"
PIN_HASH_ITERATIONS = 1000
PIN_DIGITS = 16


def get_local_ip() -> str:
    """Return the first non-loopback LAN IPv4 address, falling back to hostname.

    Uses a UDP connect trick (no traffic is sent) to discover which interface
    the OS would route through to reach an external host — i.e. the IP that
    remote browsers can use to reach this machine.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # 192.0.2.1 is TEST-NET-1 (RFC 5737) — routable but reserved,
            # so no packets are ever actually sent; we just need the OS to
            # pick the right outbound interface.
            s.connect(("192.0.2.1", 80))
            return s.getsockname()[0]
    except Exception:
        return socket.gethostname()


# ── Progress tracker ─────────────────────────────────────────────────────────
# Persists apply-phase progress across page reloads and is read by the
# console first-boot TUI (/usr/lib/iora/iora-setup-tui). The state file is
# atomically rewritten on every update so concurrent readers never see a
# partial JSON document.
class ProgressTracker:
    # Canonical phases and their relative weights (must sum to 100).
    PHASES = [
        ("init",          "Initialising data directory",          5),
        ("recovery_pin",  "Generating Recovery PIN",              5),
        ("luks",          "Encrypting data partition",           15),
        ("compose",       "Writing Docker Compose configuration", 5),
        ("database",      "Configuring native database",         10),
        ("hostname",      "Applying hostname and timezone",       5),
        ("env",           "Writing environment file",             5),
        ("flag",          "Marking setup as complete",            5),
        ("disable_setup", "Disabling first-boot wizard",          5),
        ("stack",         "Starting IORA container stack",       35),
        ("done",          "Setup complete",                       5),
    ]

    def __init__(self, path: str = SETUP_STATE_FILE):
        self.path = path
        self._lock = threading.Lock()
        self._subscribers: "list[queue.Queue[dict]]" = []
        self.state = {
            "status": "pending",          # pending | running | done | failed
            "started_at": None,
            "updated_at": None,
            "finished_at": None,
            "phase": None,                # current phase key
            "phase_label": None,
            "percent": 0,
            "log": [],                    # list of {"ts", "level", "msg"}
            "errors": [],
            "recovery_pin": None,         # cleared once the UI acknowledges it
            "pin_acknowledged": False,
            "finish_url": None,
        }
        # Reload any previous run so a browser that opens /setup after a
        # reboot still sees "setup complete".
        try:
            if os.path.exists(self.path):
                with open(self.path, "r") as f:
                    loaded = json.load(f)
                    # Never leak a previous Recovery PIN through reload.
                    loaded.pop("recovery_pin", None)
                    self.state.update(loaded)
        except Exception:
            pass

    def _persist_locked(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            # Shallow copy without the plaintext PIN — we keep the PIN only
            # in memory so an attacker with filesystem access can't grab it.
            to_disk = {k: v for k, v in self.state.items() if k != "recovery_pin"}
            with open(tmp, "w") as f:
                json.dump(to_disk, f, indent=2)
            os.replace(tmp, self.path)
        except Exception as exc:
            # Non-fatal: tracker must never take down setup.
            print(f"WARN: cannot persist setup state: {exc}", file=sys.stderr)

    def _broadcast_locked(self) -> None:
        snapshot = dict(self.state)
        for q in list(self._subscribers):
            try:
                q.put_nowait(snapshot)
            except queue.Full:
                pass

    def subscribe(self) -> "queue.Queue[dict]":
        q: "queue.Queue[dict]" = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.append(q)
            # Prime the subscriber with the current state immediately.
            q.put_nowait(dict(self.state))
        return q

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        with self._lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self.state)

    def log(self, msg: str, level: str = "info") -> None:
        from time import time as _t
        entry = {"ts": _t(), "level": level, "msg": msg}
        with self._lock:
            self.state["log"].append(entry)
            # Cap the log so memory doesn't grow unbounded on re-runs.
            if len(self.state["log"]) > 500:
                self.state["log"] = self.state["log"][-500:]
            self.state["updated_at"] = entry["ts"]
            self._persist_locked()
            self._broadcast_locked()
        # Mirror to stdout so journalctl / console TUI can tail it.
        print(f"[setup:{level}] {msg}", flush=True)

    def start(self) -> None:
        from time import time as _t
        with self._lock:
            self.state["status"] = "running"
            self.state["started_at"] = _t()
            self.state["updated_at"] = _t()
            self.state["finished_at"] = None
            self.state["phase"] = None
            self.state["phase_label"] = None
            self.state["percent"] = 0
            self.state["log"] = []
            self.state["errors"] = []
            self.state["recovery_pin"] = None
            self.state["pin_acknowledged"] = False
            self.state["finish_url"] = None
            self._persist_locked()
            self._broadcast_locked()

    def set_phase(self, phase: str) -> None:
        # Compute cumulative percentage based on phase weights.
        cumulative = 0
        total = sum(w for _, _, w in self.PHASES)
        label = phase
        for key, lbl, weight in self.PHASES:
            if key == phase:
                label = lbl
                # Percent at the START of this phase.
                percent = int(cumulative * 100 / max(total, 1))
                break
            cumulative += weight
        else:
            percent = self.state["percent"]
        with self._lock:
            self.state["phase"] = phase
            self.state["phase_label"] = label
            if percent > self.state["percent"]:
                self.state["percent"] = percent
            self._persist_locked()
            self._broadcast_locked()
        self.log(f"→ {label}")

    def set_percent(self, percent: int) -> None:
        with self._lock:
            clamped = max(0, min(100, int(percent)))
            if clamped > self.state["percent"]:
                self.state["percent"] = clamped
                self._persist_locked()
                self._broadcast_locked()

    def set_recovery_pin(self, pin: str | None) -> None:
        with self._lock:
            self.state["recovery_pin"] = pin
            # Do not persist the PIN to disk — see _persist_locked.
            self._broadcast_locked()

    def acknowledge_pin(self) -> None:
        with self._lock:
            self.state["pin_acknowledged"] = True
            self.state["recovery_pin"] = None
            self._persist_locked()
            self._broadcast_locked()

    def add_error(self, msg: str) -> None:
        with self._lock:
            self.state["errors"].append(msg)
            self._persist_locked()
            self._broadcast_locked()
        self.log(msg, level="error")

    def finish(self, status: str, finish_url: str | None = None) -> None:
        from time import time as _t
        with self._lock:
            self.state["status"] = status
            self.state["finished_at"] = _t()
            self.state["percent"] = 100 if status == "done" else self.state["percent"]
            if finish_url:
                self.state["finish_url"] = finish_url
            self._persist_locked()
            self._broadcast_locked()
        self.log(f"Setup finished with status={status}",
                 level="info" if status == "done" else "error")


# Queue stdlib is used by ProgressTracker.subscribe; import here so the
# tracker class can reference it (imports at top of file pull it in).
import queue  # noqa: E402

PROGRESS = ProgressTracker()


def generate_recovery_pin() -> str:
    """Generate a cryptographically secure 16-digit Recovery PIN."""
    # Generate as a zero-padded integer from a single secrets call for efficiency.
    return f"{secrets.randbelow(10 ** PIN_DIGITS):0{PIN_DIGITS}d}"


def hash_recovery_pin(pin: str, salt: str | None = None) -> str:
    """Hash a Recovery PIN with PBKDF2-HMAC-SHA256.

    Uses Python's standard ``hashlib.pbkdf2_hmac`` for a correct PBKDF2
    implementation.  Storage format: ``pbkdf2-sha256:<hex_salt>:<iter>:<hex>``
    """
    if salt is None:
        salt = secrets.token_hex(16)
    iterations = PIN_HASH_ITERATIONS
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        pin.encode("utf-8"),
        salt.encode("utf-8"),
        iterations,
    )
    return f"pbkdf2-sha256:{salt}:{iterations}:{digest.hex()}"


def store_recovery_pin_hash(pin_hash: str) -> None:
    """Write the PIN hash to /etc/iora/recovery-pin.hash (root-only readable)."""
    os.makedirs("/etc/iora", exist_ok=True)
    # Write atomically via temp file.
    tmp = RECOVERY_PIN_HASH_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            f.write(pin_hash + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, RECOVERY_PIN_HASH_FILE)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def setup_luks_data_partition(keyfile_path: str) -> list[str]:
    """Initialise LUKS encryption on the data partition.

    Returns a list of error strings (empty on success).
    Only called when the partition exists and is not yet LUKS-formatted.

    The partition is normally mounted at /mnt/data at this point (the setup
    wizard runs AFTER mnt-data.mount) and may also be exposed through a
    device-mapper alias (``/dev/mapper/iora-data``) that
    iora-data-unlock.service creates. ``cryptsetup luksFormat`` refuses to
    wipe the header while the device is in use, so we tear those down
    first. After a successful format and open we create a fresh ext4
    filesystem inside the LUKS container and remount /mnt/data so that all
    subsequent setup steps write to the encrypted partition.
    """
    errors: list[str] = []
    if not os.path.exists(DATA_DEV):
        return []  # Partition does not exist yet — skip silently.

    # Check if already LUKS.
    r = subprocess.run(
        ["cryptsetup", "isLuks", DATA_DEV],
        capture_output=True,
    )
    if r.returncode == 0:
        return []  # Already encrypted — nothing to do.

    if not os.path.exists(keyfile_path):
        errors.append(f"LUKS setup skipped: keyfile {keyfile_path} not found")
        return errors

    # ── Resolve the real block device path NOW ───────────────────────────
    # udev processes the removal of the plain dm alias below and may remove
    # the /dev/disk/by-label/iora-data symlink while it settles.  Resolving
    # the path before any dm teardown ensures cryptsetup always gets the
    # actual block-device path regardless of symlink state.
    real_dev = os.path.realpath(DATA_DEV)

    def _recreate_data_dirs() -> None:
        """Recreate the expected subdirectory tree under /mnt/data/iora.

        Must be called any time /mnt/data is remounted with a fresh filesystem
        so that subsequent setup writes (docker-compose.yml, .env,
        .setup-complete) don't fail with ENOENT.
        """
        for subdir in ("", "config", "media", "backups", "addons",
                       "rauc", "secrets", "db", "mqtt/config", "mqtt/data",
                       "zigbee", "zwave"):
            try:
                os.makedirs(os.path.join(DATA_DIR, subdir), exist_ok=True)
            except OSError as exc:
                # Log but continue — a missing optional subdir is non-fatal.
                print(
                    f"WARNING: could not create {os.path.join(DATA_DIR, subdir)}: {exc}",
                    file=sys.stderr,
                )

    def _fallback_plain_mount() -> None:
        """Re-format real_dev as plain ext4 and mount it at /mnt/data.

        Used when device-mapper is unavailable or luksOpen fails after
        luksFormat.  Ensures /mnt/data is always mountable so the rest of
        setup can write docker-compose.yml, .env, and .setup-complete.
        Appends to ``errors`` on any sub-step failure.
        """
        # Lazy unmount — failure is expected and non-fatal if already unmounted.
        subprocess.run(["umount", "-l", "/mnt/data"], capture_output=True)
        os.sync()
        r = subprocess.run(
            ["mkfs.ext4", "-F", "-L", "iora-data", real_dev],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            errors.append(
                f"mkfs.ext4 fallback failed on {real_dev}: {r.stderr.strip()}"
            )
            return
        os.makedirs("/mnt/data", exist_ok=True)
        r = subprocess.run(
            ["mount", "-t", "ext4", "-o", "defaults,noatime",
             real_dev, "/mnt/data"],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            errors.append(
                f"mount /mnt/data (plain ext4 fallback) failed: {r.stderr.strip()}"
            )
            return
        # Recreate directory tree on the fresh filesystem so all subsequent
        # setup writes succeed (docker-compose.yml, .env, .setup-complete).
        _recreate_data_dirs()

    # ── Early device-mapper availability probe ───────────────────────────
    # luksOpen (and the pass-through dmsetup alias) both require dm_mod.
    # Probe availability HERE — before luksFormat — so we avoid a 7-second
    # destructive format when the kernel simply doesn't have DM support.
    # This happens when CONFIG_BLK_DEV_DM was not compiled in and the module
    # cannot be loaded (the kernel config fix requires a full rebuild).
    subprocess.run(["modprobe", "dm_mod"], capture_output=True)
    subprocess.run(["modprobe", "dm-crypt"], capture_output=True)
    subprocess.run(["udevadm", "settle", "--timeout=5"], capture_output=True)
    os.makedirs("/dev/mapper", exist_ok=True)
    if not os.path.exists("/dev/mapper/control"):
        r = subprocess.run(
            ["mknod", "/dev/mapper/control", "c", "10", "236"],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            # Non-fatal: if dm_mod is truly absent the subsequent dmsetup
            # probe will catch it; log for diagnostics only.
            errors.append(
                f"mknod /dev/mapper/control failed (dm_mod may be absent): "
                f"{r.stderr.strip()}"
            )
    dm_probe = subprocess.run(["dmsetup", "ls"], capture_output=True)
    if dm_probe.returncode != 0:
        # Device-mapper is not usable — skip LUKS entirely.
        # Format the raw partition as plain ext4 and mount it directly so
        # the rest of setup can write its files.
        errors.append(
            "cryptsetup skipped: device-mapper (dm_mod) is not available on "
            "this kernel — data partition will be unencrypted until the OS is "
            "rebuilt with CONFIG_BLK_DEV_DM=y"
        )
        _fallback_plain_mount()
        return errors

    # ── Release the device before luksFormat ────────────────────────────
    # Move the process cwd off /mnt/data so that the setup-server process
    # itself does not hold a kernel reference to the block device.
    try:
        os.chdir("/")
    except Exception:
        pass

    # Flush all pending writes before unmounting.
    os.sync()

    # 1. Attempt a normal unmount first (synchronous — releases the device
    #    immediately once all in-kernel references are dropped).
    subprocess.run(["umount", "/mnt/data"], capture_output=True)

    # 2. Remove the dm-mapper alias BEFORE the lazy unmount.  A lazy unmount
    #    leaves the backing dm node referenced by the still-live superblock;
    #    tearing it down first gives the kernel a chance to drop references
    #    to the raw block device synchronously.
    if os.path.exists("/dev/mapper/iora-data"):
        subprocess.run(["dmsetup", "remove", "--force", "iora-data"],
                       capture_output=True)
        # Also try cryptsetup close in case it's a real LUKS node from a
        # previous encryption attempt.
        subprocess.run(["cryptsetup", "close", "iora-data"],
                       capture_output=True)

    # 3. Sweep any remaining kernel dm holders on the underlying block device.
    try:
        holders_dir = f"/sys/class/block/{os.path.basename(real_dev)}/holders"
        if os.path.isdir(holders_dir):
            for name in os.listdir(holders_dir):
                subprocess.run(["dmsetup", "remove", "--force", name],
                               capture_output=True)
    except Exception:
        pass

    # 4. Lazy unmount as final fallback (detaches the mount-point name even
    #    if the device is still busy; harmless if already unmounted above).
    subprocess.run(["umount", "-l", "/mnt/data"], capture_output=True)

    # 5. Flush again and wait for udev to finish processing any related
    #    events so the kernel reference counts drain before luksFormat.
    os.sync()
    subprocess.run(["udevadm", "settle", "--timeout=5"], capture_output=True)
    time.sleep(0.5)

    # Format as LUKS2 with the generated keyfile.  We set --label iora-data
    # so that udev recreates /dev/disk/by-label/iora-data pointing at the
    # raw device; iora-data-unlock.service uses that path on every subsequent
    # boot to detect and open the LUKS container.
    # Retry once to handle the kernel reference-count race that can persist
    # briefly after lazy unmount.
    def _try_format() -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                "cryptsetup", "luksFormat",
                "--type", "luks2",
                "--label", "iora-data",
                "--batch-mode",
                "--key-file", keyfile_path,
                real_dev,
            ],
            capture_output=True,
            text=True,
        )

    r = _try_format()
    if r.returncode != 0:
        # Wait a little longer and retry once — the lazy-unmount may still
        # be releasing inodes in the background.
        time.sleep(2)
        os.sync()
        r = _try_format()

    if r.returncode != 0:
        errors.append(f"cryptsetup luksFormat failed: {r.stderr.strip()}")
        # Recreate the plain dm passthrough alias so /mnt/data can still be
        # mounted for the remainder of the setup (docker-compose.yml, .env,
        # .setup-complete).  The error is non-fatal: the data partition stays
        # unencrypted and a reboot will restore the normal unlock path.
        try:
            sectors = subprocess.check_output(
                ["blockdev", "--getsz", real_dev],
                stderr=subprocess.DEVNULL, text=True,
            ).strip()
            if sectors:
                subprocess.run(
                    ["dmsetup", "create", "iora-data",
                     "--table", f"0 {sectors} linear {real_dev} 0"],
                    capture_output=True,
                )
        except Exception:
            pass
        os.makedirs("/mnt/data", exist_ok=True)
        subprocess.run(
            ["mount", "-t", "ext4", "-o", "defaults,noatime",
             "/dev/mapper/iora-data", "/mnt/data"],
            capture_output=True,
        )
        _recreate_data_dirs()
        return errors

    # Open the newly formatted LUKS partition.  Use real_dev: the ext4 label
    # on the raw device is gone (LUKS header replaced it) so the by-label
    # symlink no longer exists at this point.
    ro = subprocess.run(
        ["cryptsetup", "luksOpen", real_dev, "iora-data",
         "--key-file", keyfile_path],
        capture_output=True,
        text=True,
    )
    if ro.returncode != 0:
        errors.append(f"cryptsetup luksOpen failed: {ro.stderr.strip()}")
        # luksFormat already destroyed the ext4 header; the device is now a
        # bare LUKS container we cannot open.  Re-format it as plain ext4 so
        # /mnt/data is at least mountable and the rest of setup can proceed.
        _fallback_plain_mount()
        return errors

    # Create a fresh ext4 filesystem inside the LUKS container and remount
    # /mnt/data so that all subsequent setup steps (docker-compose.yml, .env,
    # .setup-complete) are written to the encrypted partition and persist
    # across reboots.
    mf = subprocess.run(
        ["mkfs.ext4", "-F", "/dev/mapper/iora-data"],
        capture_output=True,
        text=True,
    )
    if mf.returncode != 0:
        errors.append(f"mkfs.ext4 on LUKS container failed: {mf.stderr.strip()}")
        return errors

    os.makedirs("/mnt/data", exist_ok=True)
    mr = subprocess.run(
        ["mount", "-t", "ext4", "-o", "defaults,noatime",
         "/dev/mapper/iora-data", "/mnt/data"],
        capture_output=True,
        text=True,
    )
    if mr.returncode != 0:
        errors.append(f"mount /mnt/data failed after LUKS setup: {mr.stderr.strip()}")
    else:
        # Recreate directory tree on the new LUKS-backed filesystem so all
        # subsequent setup writes (docker-compose.yml, .env, .setup-complete)
        # succeed without ENOENT.
        _recreate_data_dirs()
    return errors


def generate_and_store_luks_keyfile() -> str | None:
    """Generate a random 4 KiB LUKS key and write it to DATA_KEYFILE.

    Returns the keyfile path on success, None on failure.
    """
    os.makedirs("/etc/iora", exist_ok=True)
    tmp = DATA_KEYFILE + ".tmp"
    try:
        key_bytes = secrets.token_bytes(32)  # 256-bit key — LUKS2 derives its own master key from this
        with open(tmp, "wb") as f:
            f.write(key_bytes)
        os.chmod(tmp, 0o600)
        os.replace(tmp, DATA_KEYFILE)
        return DATA_KEYFILE
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        return None

# Detect if running on IORA OS or standalone
IS_IORA_OS = os.path.exists(IORA_VERSION_FILE)


def get_system_info():
    """Gather system information for display."""
    info = {}

    # Hostname
    info["hostname"] = socket.gethostname()

    # IP addresses
    info["interfaces"] = []
    try:
        for iface in os.listdir("/sys/class/net"):
            if iface == "lo":
                continue
            addr_path = f"/sys/class/net/{iface}/address"
            state_path = f"/sys/class/net/{iface}/operstate"
            mac = open(addr_path).read().strip() if os.path.exists(addr_path) else ""
            state = open(state_path).read().strip() if os.path.exists(state_path) else "unknown"
            # Get IPv4 via ip command
            ipv4 = ""
            try:
                out = subprocess.check_output(
                    ["ip", "-4", "addr", "show", iface],
                    stderr=subprocess.DEVNULL, text=True
                )
                for line in out.splitlines():
                    line = line.strip()
                    if line.startswith("inet "):
                        ipv4 = line.split()[1].split("/")[0]
                        break
            except Exception:
                pass
            info["interfaces"].append({
                "name": iface, "mac": mac, "state": state, "ipv4": ipv4
            })
    except Exception:
        pass

    # OS version
    if os.path.exists(IORA_VERSION_FILE):
        info["version"] = open(IORA_VERSION_FILE).read().strip()
    else:
        info["version"] = "Standalone"

    info["is_iora_os"] = IS_IORA_OS

    # Docker status
    try:
        subprocess.check_output(["docker", "info"], stderr=subprocess.DEVNULL)
        info["docker"] = True
    except Exception:
        info["docker"] = False

    # Disk usage
    try:
        st = os.statvfs("/mnt/data" if IS_IORA_OS else "/")
        total_gb = (st.f_blocks * st.f_frsize) / (1024 ** 3)
        free_gb = (st.f_bavail * st.f_frsize) / (1024 ** 3)
        info["disk_total_gb"] = round(total_gb, 1)
        info["disk_free_gb"] = round(free_gb, 1)
    except Exception:
        info["disk_total_gb"] = 0
        info["disk_free_gb"] = 0

    # Memory
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    info["memory_mb"] = int(line.split()[1]) // 1024
                    break
    except Exception:
        info["memory_mb"] = 0

    # Update server info
    info["update_server"] = UPDATE_SERVER
    info["download_server"] = DOWNLOAD_SERVER

    return info


def fetch_available_packages():
    """Fetch available IORA packages from the update server."""
    try:
        import urllib.request
        url = f"{UPDATE_SERVER}/v1/iora/packages"
        req = urllib.request.Request(url, headers={"User-Agent": "iora-setup/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        # Return built-in defaults if server unreachable
        return []


def check_os_update():
    """Check if an OS update is available."""
    try:
        import urllib.request
        version = "unknown"
        if os.path.exists(IORA_VERSION_FILE):
            version = open(IORA_VERSION_FILE).read().strip().split()[-1]
        url = f"{UPDATE_SERVER}/v1/iora/os/check?version={version}&channel=stable&arch=x86_64"
        req = urllib.request.Request(url, headers={"User-Agent": "iora-setup/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return {"update_available": False, "current_version": "unknown"}


def save_config(config):
    """Save setup configuration."""
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def apply_config(config):
    """Apply the setup configuration to the system.

    Returns a tuple (errors: list[str], recovery_pin: str | None).
    ``recovery_pin`` is the plaintext 16-digit PIN generated during this
    setup run. It is returned to the web UI so the user can write it down.
    It is NEVER stored on the device in plaintext.
    """
    errors = []
    recovery_pin = None  # set below if on IORA OS

    PROGRESS.start()

    # Create data directory structure
    PROGRESS.set_phase("init")
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "config"), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "media"), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "backups"), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "addons"), exist_ok=True)

    # ── Security: Recovery PIN + LUKS ─────────────────────────────────────
    if IS_IORA_OS:
        # 1. Generate a 16-digit Recovery PIN and store its hash.
        PROGRESS.set_phase("recovery_pin")
        if not os.path.exists(RECOVERY_PIN_HASH_FILE):
            recovery_pin = generate_recovery_pin()
            pin_hash = hash_recovery_pin(recovery_pin)
            try:
                store_recovery_pin_hash(pin_hash)
                PROGRESS.set_recovery_pin(recovery_pin)
            except Exception as e:
                msg = f"Failed to store Recovery PIN hash: {e}"
                errors.append(msg)
                PROGRESS.add_error(msg)
                recovery_pin = None
        # If a hash already exists (re-run of setup), do not overwrite it.

        # 2. Generate LUKS keyfile and encrypt data partition if not yet done.
        PROGRESS.set_phase("luks")
        if not os.path.exists(DATA_KEYFILE):
            keyfile = generate_and_store_luks_keyfile()
            if keyfile:
                luks_errors = setup_luks_data_partition(keyfile)
                for e in luks_errors:
                    PROGRESS.add_error(e)
                errors.extend(luks_errors)
            else:
                msg = "Failed to generate LUKS keyfile — data partition will remain unencrypted"
                errors.append(msg)
                PROGRESS.add_error(msg)
    # ── End security setup ─────────────────────────────────────────────────

    # Generate docker-compose.yml
    PROGRESS.set_phase("compose")
    compose = generate_compose(config)
    compose_path = os.path.join(DATA_DIR, "docker-compose.yml")
    try:
        with open(compose_path, "w") as f:
            f.write(compose)
    except Exception as e:
        msg = f"Failed to write docker-compose.yml: {e}"
        errors.append(msg)
        PROGRESS.add_error(msg)

    # ── Native PostgreSQL — generate credentials and update service envs ───
    # On IORA OS the database is a native postgresql.service.  The
    # iora-db-init.service reads /etc/iora/db.password, creates the iora
    # role, and sets up the four application databases.  We generate a strong
    # random password here (once) and patch all EnvironmentFile skeletons so
    # services can connect immediately after iora-db-init runs.
    PROGRESS.set_phase("database")
    DB_PASSWORD_FILE = "/etc/iora/db.password"
    DB_SENTINEL     = "/etc/iora/.db-initialised"
    if IS_IORA_OS:
        try:
            # Generate once; preserve if setup is re-run.
            if not os.path.exists(DB_PASSWORD_FILE):
                db_pass = secrets.token_urlsafe(32)
                os.makedirs("/etc/iora", exist_ok=True)
                with open(DB_PASSWORD_FILE, "w") as f:
                    f.write(db_pass)
                os.chmod(DB_PASSWORD_FILE, 0o600)
                PROGRESS.log(f"Generated database password → {DB_PASSWORD_FILE}")
            else:
                with open(DB_PASSWORD_FILE) as f:
                    db_pass = f.read().strip()
                PROGRESS.log("Re-using existing database password")

            # Update env files that contain a DATABASE_URL placeholder.
            db_envs = {
                "/etc/iora/iora-core.env":     "iora_core",
                "/etc/iora/iora-home.env":     "iora_home",
                "/etc/iora/iora-secrets.env":  "iora_secrets",
                "/etc/iora/iora-security.env": "iora_security",
            }
            for env_file, db_name in db_envs.items():
                if not os.path.exists(env_file):
                    continue
                # URL-encode the password so special chars don't break URL parsing.
                db_pass_enc = urllib.parse.quote(db_pass, safe="")
                db_url = f"postgres://iora:{db_pass_enc}@localhost:5432/{db_name}"
                lines = []
                with open(env_file) as f:
                    for line in f:
                        if line.startswith("DATABASE_URL="):
                            lines.append(f"DATABASE_URL={db_url}\n")
                        else:
                            lines.append(line)
                with open(env_file, "w") as f:
                    f.writelines(lines)
                # Owner-read-only: these files contain the DB password.
                os.chmod(env_file, 0o600)
            PROGRESS.log("Updated DATABASE_URL in all IORA service env files")

            # Delete the iora-db-init sentinel so the service re-runs and
            # applies/verifies the role password on the next service start.
            if os.path.exists(DB_SENTINEL):
                os.remove(DB_SENTINEL)

            # Trigger iora-db-init.service NOW.
            #
            # IMPORTANT: must be `restart`, not `start`. The unit is
            # `Type=oneshot RemainAfterExit=yes`, so after its initial boot
            # invocation (which exits 0 because the password file didn't
            # exist yet) it stays in `active (exited)` state — and
            # `systemctl start` on an already-active unit is a no-op. Using
            # `restart` forces the script to actually run again with the
            # freshly-written password, creating the iora role + databases.
            PROGRESS.log("Restarting iora-db-init.service…")
            # Clear any stale failed state from prior boots.
            subprocess.run(
                ["systemctl", "reset-failed", "iora-db-init.service"],
                capture_output=True, text=True, timeout=10,
            )
            cp = subprocess.run(
                ["systemctl", "restart", "iora-db-init.service"],
                capture_output=True, text=True, timeout=120,
            )
            if cp.returncode != 0:
                msg = (
                    f"iora-db-init.service did not complete cleanly: "
                    f"{(cp.stderr or cp.stdout or '').strip()[:300]}"
                )
                PROGRESS.add_error(msg)
                errors.append(msg)
            else:
                # Verify the sentinel exists — it's the only proof the
                # script actually finished its work.
                if os.path.exists(DB_SENTINEL):
                    PROGRESS.log("iora-db-init.service finished OK (role + databases ready)")
                else:
                    msg = (
                        "iora-db-init.service exited 0 but did NOT create "
                        "/etc/iora/.db-initialised — role/databases may be "
                        "missing. Check: journalctl -u iora-db-init -n 80"
                    )
                    PROGRESS.add_error(msg)
                    errors.append(msg)
        except Exception as e:
            msg = f"Failed to configure native PostgreSQL: {e}"
            errors.append(msg)
            PROGRESS.add_error(msg)


    PROGRESS.set_phase("hostname")
    if IS_IORA_OS and config.get("hostname"):
        try:
            subprocess.run(
                ["hostnamectl", "set-hostname", config["hostname"]],
                check=False, capture_output=True
            )
        except Exception:
            pass

    # Set timezone if on IORA OS
    if IS_IORA_OS and config.get("timezone"):
        try:
            subprocess.run(
                ["timedatectl", "set-timezone", config["timezone"]],
                check=False, capture_output=True
            )
        except Exception:
            pass

    # Write .env file for docker-compose
    PROGRESS.set_phase("env")
    env_path = os.path.join(DATA_DIR, ".env")
    try:
        env_lines = [
            f"IORA_HOSTNAME={config.get('hostname', 'iora')}",
            f"IORA_TIMEZONE={config.get('timezone', 'Europe/Berlin')}",
            f"IORA_LANGUAGE={config.get('language', 'de')}",
            f"IORA_COUNTRY={config.get('country', 'DE')}",
            f"IORA_UNIT_SYSTEM={config.get('unit_system', 'metric')}",
            f"IORA_DATA_DIR={DATA_DIR}",
            f"COMPOSE_PROJECT_NAME=iora",
        ]
        with open(env_path, "w") as f:
            f.write("\n".join(env_lines) + "\n")
    except Exception as e:
        msg = f"Failed to write .env: {e}"
        errors.append(msg)
        PROGRESS.add_error(msg)

    # Seed the IORA Home web-admin user.
    #
    # We deliver the credentials to iora-home via its existing
    # /etc/iora/iora-home.env file (already root-owned 0600 and loaded
    # by systemd via EnvironmentFile= before privilege drop, so the
    # iora-home process inherits the variables without needing FS
    # access). iora-home's bootstrap_admin_user() reads them from
    # IORA_BOOTSTRAP_ADMIN_{USER,PASSWORD,DISPLAY_NAME} on startup.
    #
    # We deliberately do NOT use the legacy /mnt/data/iora/...json
    # path anymore: that file would be 0600 root-owned and the
    # iora-home service runs as a non-root user, so it could not
    # read it ("Permission denied").
    admin_user = (config.get("admin_username") or "").strip()
    admin_pass = config.get("admin_password") or ""
    if admin_user and len(admin_pass) >= 8:
        env_path = "/etc/iora/iora-home.env"
        try:
            # Read existing content (it was just written above with the
            # DATABASE_URL); strip any prior IORA_BOOTSTRAP_* lines so
            # we don't accumulate stale ones if setup is re-run.
            try:
                with open(env_path) as f:
                    existing_lines = f.readlines()
            except FileNotFoundError:
                existing_lines = []
            kept = [
                ln for ln in existing_lines
                if not ln.startswith("IORA_BOOTSTRAP_ADMIN_")
            ]
            # Escape any embedded double-quotes in the password so the
            # systemd EnvironmentFile parser doesn't terminate early.
            esc_user = admin_user.replace("\\", "\\\\").replace('"', '\\"')
            esc_pass = admin_pass.replace("\\", "\\\\").replace('"', '\\"')
            kept.append(f'IORA_BOOTSTRAP_ADMIN_USER="{esc_user}"\n')
            kept.append(f'IORA_BOOTSTRAP_ADMIN_PASSWORD="{esc_pass}"\n')
            kept.append(f'IORA_BOOTSTRAP_ADMIN_DISPLAY_NAME="{esc_user}"\n')
            with open(env_path, "w") as f:
                f.writelines(kept)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(env_path, 0o600)
            PROGRESS.log(f"Appended bootstrap admin credentials to {env_path}")
        except Exception as e:
            msg = f"Failed to write web-admin bootstrap env vars: {e}"
            errors.append(msg)
            PROGRESS.add_error(msg)

        # Also remove any stale legacy JSON file that previous versions
        # of the wizard may have left behind (it would just produce
        # 'Permission denied' warnings in iora-home).
        legacy_json = os.path.join(DATA_DIR, "iora-home-bootstrap.json")
        try:
            if os.path.exists(legacy_json):
                os.remove(legacy_json)
                PROGRESS.log(f"Removed legacy bootstrap file {legacy_json}")
        except Exception:
            pass

        # Drop the bootstrap-applied sentinel so iora-home re-applies the
        # newly-supplied credentials on its next start. Without this a
        # re-run of the wizard with a different password would be
        # silently ignored (sentinel hash check would short-circuit).
        sentinel = os.path.join(DATA_DIR, ".iora-home-bootstrap-applied")
        try:
            if os.path.exists(sentinel):
                os.remove(sentinel)
                PROGRESS.log("Cleared bootstrap-applied sentinel — credentials will be re-applied on next iora-home start")
        except Exception:
            pass
    else:
        PROGRESS.log("Web-Admin credentials missing or password too short — skipping bootstrap (you can register from the UI)", level="warn")

    # Mark setup as complete
    PROGRESS.set_phase("flag")
    try:
        with open(SETUP_DONE_FLAG, "w") as f:
            f.write("1\n")
            f.flush()
            os.fsync(f.fileno())  # guarantee on-disk before any reboot/reset
        # Also fsync the parent directory so the directory entry is durable.
        parent_fd = os.open(os.path.dirname(SETUP_DONE_FLAG), os.O_RDONLY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    except Exception as e:
        msg = f"Failed to write setup flag: {e}"
        errors.append(msg)
        PROGRESS.add_error(msg)

    # Disable setup service if on IORA OS
    PROGRESS.set_phase("disable_setup")
    if IS_IORA_OS:
        try:
            subprocess.run(
                ["systemctl", "disable", "iora-setup.service"],
                check=False, capture_output=True
            )
        except Exception:
            pass

    # Start the user-app Docker stack (MQTT broker and optional adapters).
    # iora-stack.service manages user-app containers only — IORA system
    # services (including iora-home on port 8126) run natively and are
    # already up at this point. A failure here is a warning, not fatal:
    # the dashboard is still reachable even if the stack hasn't started yet.
    PROGRESS.set_phase("stack")
    if config.get("auto_start", True):
        try:
            if IS_IORA_OS:
                # Pre-check: if docker is not installed or the daemon is not
                # running, we can give a clear message immediately instead of
                # waiting the full 240-second timeout for iora-stack.service.
                docker_available = os.path.isfile("/usr/bin/docker") or \
                                   os.path.isfile("/usr/local/bin/docker")
                if not docker_available:
                    PROGRESS.add_error(
                        "iora-stack.service skipped — Docker is not installed "
                        "on this image. User-app containers (MQTT, etc.) will "
                        "not start until Docker is available."
                    )
                else:
                    PROGRESS.log("systemctl restart iora-stack.service (up to 240s)")
                    cp = subprocess.run(
                        ["systemctl", "restart", "iora-stack.service"],
                        capture_output=True, text=True, timeout=240,
                    )
                    if cp.returncode != 0:
                        # Non-fatal: dashboard (iora-home, port 8126) runs natively
                        # and is unaffected by the Docker stack status.
                        msg = (
                            f"iora-stack.service failed to start — "
                            f"user-app containers (MQTT etc.) may not be running yet: "
                            f"{(cp.stderr or cp.stdout or '').strip()[:300]}"
                        )
                        PROGRESS.add_error(msg)
            else:
                PROGRESS.log("docker compose up -d --remove-orphans (up to 300s)")
                cp = subprocess.run(
                    ["docker", "compose", "up", "-d", "--remove-orphans"],
                    cwd=DATA_DIR,
                    capture_output=True, text=True, timeout=300,
                )
                if cp.returncode != 0:
                    msg = (
                        f"docker compose up failed: "
                        f"{(cp.stderr or cp.stdout or '').strip()[:400]}"
                    )
                    PROGRESS.add_error(msg)
        except Exception as e:
            PROGRESS.add_error(f"Failed to start user-app stack: {e}")

    # ── Start native IORA services and verify iora-home is reachable ──────
    # Native services (iora-core, iora-home, …) are systemd units controlled
    # by multi-user.target.  They depend on iora-db-init completing and their
    # binary existing at /opt/iora/build/<svc>/bin/<svc>.  We explicitly
    # start them here so the user doesn't have to wait for a reboot, and we
    # check that iora-home is actually listening on :8126 before the wizard
    # redirects there.
    if IS_IORA_OS:
        NATIVE_SERVICES = [
            "iora-core.service",
            "iora-home.service",
            "iora-secrets.service",
            "iora-security.service",
            "iora-watchdog.service",
        ]

        # Pre-flight: check whether the native service binaries actually exist
        # and are executable.  On a freshly-dd'd image the placeholder .keep
        # files are NOT executables, so the ConditionPathExists guards inside
        # the units will cause them to silently skip (exit 0 / condition failed)
        # rather than actually starting anything.  Detect this upfront so we
        # can show one clear message instead of a confusing 20-second timeout.
        def _binary_is_executable(svc_name: str) -> bool:
            bin_path = f"/opt/iora/build/{svc_name}/bin/{svc_name}"
            return os.path.isfile(bin_path) and os.access(bin_path, os.X_OK)

        native_binaries_present = _binary_is_executable("iora-home")
        if not native_binaries_present:
            PROGRESS.add_error(
                "Native IORA service binaries are not present in this image "
                "(placeholder .keep files found at /opt/iora/build/*/bin/). "
                "The OS image must be rebuilt with the compiled service binaries "
                "before the dashboard on port 8126 will be available. "
                "Setup configuration has been saved — re-flash a complete image "
                "and the dashboard will start automatically after boot."
            )
        else:
            for svc in NATIVE_SERVICES:
                svc_name = svc.removesuffix(".service")
                if not _binary_is_executable(svc_name):
                    PROGRESS.add_error(
                        f"{svc} skipped — binary not found or not executable at "
                        f"/opt/iora/build/{svc_name}/bin/{svc_name}"
                    )
                    continue
                try:
                    PROGRESS.log(f"systemctl start {svc}")
                    cp = subprocess.run(
                        ["systemctl", "start", svc],
                        capture_output=True, text=True, timeout=60,
                    )
                    if cp.returncode != 0:
                        stderr = (cp.stderr or cp.stdout or "").strip()
                        # ConditionPathExists failure → binary missing or
                        # some other condition not met — not fatal.
                        if "condition" in stderr.lower() or cp.returncode == 1:
                            msg = (
                                f"{svc} did not start — condition not met "
                                f"(binary or dependency missing): {stderr[:200]}"
                            )
                        else:
                            msg = f"{svc} failed to start: {stderr[:200]}"
                        PROGRESS.add_error(msg)
                except subprocess.TimeoutExpired:
                    PROGRESS.add_error(f"{svc} start timed out after 60s")
                except Exception as e:
                    PROGRESS.add_error(f"Failed to start {svc}: {e}")

            # Wait for iora-home to accept connections on port 8126.
            # First-boot can take a while: postgres warm-up + db migrations
            # inside iora-home itself can run 30–90 s on slow hardware.
            # Override via $IORA_HOME_WAIT_SECONDS for QA.
            import time as _time
            wait_seconds = int(os.environ.get("IORA_HOME_WAIT_SECONDS", "180"))
            PROGRESS.log(
                f"Waiting for iora-home to come up on :8126 (up to {wait_seconds}s)…"
            )
            home_up = False
            last_log = 0
            for _attempt in range(wait_seconds):
                try:
                    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _s:
                        _s.settimeout(1)
                        _s.connect(("127.0.0.1", 8126))
                        home_up = True
                        break
                except (OSError, ConnectionRefusedError):
                    # Log a heartbeat every 15 s so the wizard's UI shows
                    # progress instead of a frozen "waiting…" line.
                    if _attempt - last_log >= 15:
                        PROGRESS.log(
                            f"  …still waiting for iora-home ({_attempt}s/{wait_seconds}s)"
                        )
                        last_log = _attempt
                    _time.sleep(1)
            if home_up:
                PROGRESS.log("iora-home is up and accepting connections on :8126")
            else:
                # Soft-fail: do NOT block setup completion. The dashboard
                # may simply still be initialising its database. The user
                # gets a clear hint instead of a hard error.
                PROGRESS.log(
                    "iora-home is not yet listening on :8126 — it will keep "
                    "retrying in the background. The dashboard usually "
                    "appears within 1–3 min after setup completes."
                )
                PROGRESS.add_error(
                    "Dashboard (port 8126) is not up yet — give it a minute "
                    "and reload http://<device-ip>:8126. If it never appears: "
                    "ssh in and run  systemctl status iora-home  /  "
                    "journalctl -u iora-home -n 80"
                )

    PROGRESS.set_phase("done")
    return errors, recovery_pin



def generate_compose(config):
    """Generate a docker-compose.yml for USER APPS only.

    IORA OS system services (iora-core, iora-home, iora-control, iora-assist,
    iora-secrets, iora-watchdog, iora-security, iora-gateway, iora-supervisor)
    run as native systemd units on the host — they are NOT in this compose
    file.  PostgreSQL also runs natively as postgresql.service.

    This file manages only the supporting user-app infrastructure that does
    NOT have a native counterpart: MQTT broker and optionally Zigbee2MQTT /
    Z-Wave JS UI when the user enables those adapters.
    """
    tz = config.get("timezone", "Europe/Berlin")

    compose = f"""# IORA Home — Docker Compose Configuration
# Generated by IORA Setup Wizard
# https://iora.home
#
# NOTE: IORA system services (iora-core, iora-home, etc.) and PostgreSQL run
# as native systemd units — they are NOT listed here.  Only user-app
# infrastructure that has no native counterpart belongs in this file.

version: "3.8"

services:
  # ── Mosquitto MQTT broker (official image) ────────────────────────────────
  iora-mqtt:
    image: eclipse-mosquitto:2
    container_name: iora-mqtt
    restart: unless-stopped
    volumes:
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/mqtt/config:/mosquitto/config
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/mqtt/data:/mosquitto/data
    networks:
      - iora-network
    ports:
      - "1883:1883"
    labels:
      iora.managed: "true"
      iora.service: "mqtt"
"""

    if config.get("enable_zigbee"):
        compose += """
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:latest
    container_name: iora-zigbee
    restart: unless-stopped
    environment:
      - TZ=${TZ}
    volumes:
      - ${IORA_DATA_DIR:-/mnt/data/iora}/zigbee:/app/data
    devices:
      - ${IORA_ZIGBEE_DEVICE:-/dev/ttyUSB0}:/dev/ttyACM0
    networks:
      - iora-network
    ports:
      - "8082:8080"
    labels:
      iora.managed: "true"
      iora.service: "zigbee2mqtt"
"""

    if config.get("enable_zwave"):
        compose += """
  zwave:
    image: zwave-js/zwave-js-ui:latest
    container_name: iora-zwave
    restart: unless-stopped
    environment:
      - TZ=${TZ}
    volumes:
      - ${IORA_DATA_DIR:-/mnt/data/iora}/zwave:/usr/src/app/store
    devices:
      - ${IORA_ZWAVE_DEVICE:-/dev/ttyUSB1}:/dev/zwave
    networks:
      - iora-network
    ports:
      - "8091:8091"
      - "3000:3000"
    labels:
      iora.managed: "true"
      iora.service: "zwave"
"""

    # networks: block must come AFTER all services.
    compose += """
networks:
  iora-network:
    driver: bridge
"""

    return compose


# ── HTML Templates ─────────────────────────────────────────────────

SETUP_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IORA OS Setup</title>
<style>
:root {
  /* IORA Home design tokens — keep in sync with backend/iora-home UI */
  --bg: #0a0a0a;
  --bg-elev: #0e0e0e;
  --surface: #161616;
  --surface2: #1f1f1f;
  --border: #2a2a2a;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-light: #3b82f6;
  --success: #22c55e;
  --warn: #f59e0b;
  --danger: #ef4444;
  --text: #e5e7eb;
  --text2: #9ca3af;
  --text3: #6b7280;
  --radius: 12px;
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}
.container {
  max-width: 680px;
  margin: 0 auto;
  padding: 24px 20px;
}
.logo {
  text-align: center;
  padding: 40px 0 20px;
}
.logo h1 {
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.logo h1 span { color: var(--primary); }
.logo p {
  color: var(--text2);
  margin-top: 6px;
  font-size: 0.95rem;
}

/* Warning banner — shown above everything on the landing page so the user
   understands IORA OS is NOT functional until setup completes. */
.warning-banner {
  background: linear-gradient(90deg, #7c2d12 0%, #9a3412 100%);
  border: 1px solid #c2410c;
  color: #fed7aa;
  padding: 14px 16px;
  border-radius: 10px;
  margin: 16px 0 8px;
  font-size: 0.9rem;
  line-height: 1.4;
}
.warning-banner strong { color: #fff; }
.warning-banner.in-progress {
  background: linear-gradient(90deg, #1e3a8a 0%, #1e40af 100%);
  border-color: #3b82f6;
  color: #dbeafe;
}

/* Apply-phase progress (percentage + bar + phase label + live log) */
.apply-progress {
  text-align: left;
  margin-top: 24px;
}
.apply-progress .pct-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.apply-progress .pct {
  font-size: 2.2rem;
  font-weight: 700;
  color: var(--primary);
}
.apply-progress .phase-label {
  color: var(--text2);
  font-size: 0.95rem;
}
.apply-progress .pct-bar {
  height: 10px;
  background: var(--surface2);
  border-radius: 5px;
  overflow: hidden;
  margin: 6px 0 16px;
}
.apply-progress .pct-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary) 0%, #22d3ee 100%);
  width: 0%;
  transition: width 0.4s ease;
}
.apply-progress .log-pane {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  color: #cbd5e1;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
}
.apply-progress .log-pane .err { color: #fca5a5; }

/* Progress bar */
.progress-bar {
  display: flex;
  gap: 4px;
  margin: 24px 0 32px;
}
.progress-bar .step {
  flex: 1;
  height: 4px;
  background: var(--surface2);
  border-radius: 2px;
  transition: background 0.3s;
}
.progress-bar .step.done { background: var(--primary); }
.progress-bar .step.active { background: var(--primary); animation: pulse 1.5s infinite; }
@keyframes pulse {
  0%,100% { opacity:1; } 50% { opacity:0.5; }
}

/* Cards */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px;
  margin-bottom: 20px;
}
.card h2 {
  font-size: 1.3rem;
  margin-bottom: 4px;
}
.card .subtitle {
  color: var(--text2);
  font-size: 0.9rem;
  margin-bottom: 20px;
}

/* Form elements */
.form-group {
  margin-bottom: 18px;
}
.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text2);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.form-group input, .form-group select {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: border 0.2s;
}
.form-group input:focus, .form-group select:focus {
  border-color: var(--primary);
}
.form-group select option { background: var(--bg); }

/* Toggles */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--surface2);
}
.toggle-row:last-child { border-bottom: none; }
.toggle-row .info h3 {
  font-size: 0.95rem;
  font-weight: 500;
}
.toggle-row .info p {
  font-size: 0.8rem;
  color: var(--text3);
  margin-top: 2px;
}
.toggle {
  position: relative;
  width: 48px;
  height: 26px;
  flex-shrink: 0;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle .slider {
  position: absolute;
  inset: 0;
  background: var(--surface2);
  border-radius: 13px;
  cursor: pointer;
  transition: background 0.2s;
}
.toggle .slider:before {
  content: "";
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  bottom: 3px;
  background: var(--text);
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .slider { background: var(--primary); }
.toggle input:checked + .slider:before { transform: translateX(22px); }

/* Buttons */
.btn-row {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.btn {
  flex: 1;
  padding: 12px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}
.btn:active { transform: scale(0.98); }
.btn-primary {
  background: var(--primary);
  color: #fff;
}
.btn-primary:hover { background: var(--primary-hover); }
.btn-secondary {
  background: var(--surface2);
  color: var(--text);
}
.btn-secondary:hover { background: var(--border); }

/* System info grid */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.info-item {
  background: var(--bg);
  padding: 14px;
  border-radius: 8px;
  border: 1px solid var(--surface2);
}
.info-item .label {
  font-size: 0.75rem;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.info-item .value {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 4px;
}
.info-item .value.ok { color: var(--success); }
.info-item .value.warn { color: var(--warn); }

/* Status indicator */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.status-dot.green { background: var(--success); }
.status-dot.red { background: var(--danger); }
.status-dot.yellow { background: var(--warn); }

/* Finish screen */
.finish-box {
  text-align: center;
  padding: 20px 0;
}
.finish-box .icon {
  font-size: 4rem;
  margin-bottom: 16px;
}
.finish-box h2 {
  font-size: 1.5rem;
  margin-bottom: 8px;
}
.finish-box .url {
  display: inline-block;
  background: var(--bg);
  border: 1px solid var(--primary);
  border-radius: 8px;
  padding: 12px 24px;
  margin: 16px 0;
  font-size: 1.1rem;
  font-family: monospace;
  color: var(--primary);
}

/* Loading spinner */
.spinner {
  border: 3px solid var(--surface2);
  border-top: 3px solid var(--primary);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 20px auto;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Hide steps */
.step-page { display: none; }
.step-page.active { display: block; }

/* Responsive */
@media (max-width: 600px) {
  .info-grid { grid-template-columns: 1fr; }
  .logo h1 { font-size: 1.6rem; }
}
</style>
</head>
<body>
<div class="container">

<div class="logo">
  <h1><span>IORA</span> OS</h1>
  <p>First-Boot Setup Wizard</p>
</div>

<div class="warning-banner" id="preSetupBanner">
  <strong>⚠ IORA OS is not yet operational.</strong>
  Native services (iora-core, iora-home, Control Center, dashboard, Docker
  stack, …) only start <strong>after</strong> this setup finishes successfully.
  Until then no other port is listening — <strong>please keep this tab open
  until you see the "Setup Complete" screen.</strong>
</div>

<div class="progress-bar" id="progressBar">
  <div class="step active" id="prog-0"></div>
  <div class="step" id="prog-1"></div>
  <div class="step" id="prog-2"></div>
  <div class="step" id="prog-3"></div>
  <div class="step" id="prog-4"></div>
</div>

<!-- Step 0: System Info -->
<div class="step-page active" id="step-0">
<div class="card">
  <h2>System Overview</h2>
  <p class="subtitle">Your system at a glance</p>
  <div class="info-grid" id="sysInfoGrid">
    <div class="info-item">
      <div class="label">Hostname</div>
      <div class="value" id="si-hostname">--</div>
    </div>
    <div class="info-item">
      <div class="label">Version</div>
      <div class="value" id="si-version">--</div>
    </div>
    <div class="info-item">
      <div class="label">Memory</div>
      <div class="value" id="si-memory">--</div>
    </div>
    <div class="info-item">
      <div class="label">Disk Free</div>
      <div class="value" id="si-disk">--</div>
    </div>
    <div class="info-item">
      <div class="label">Docker</div>
      <div class="value" id="si-docker">--</div>
    </div>
    <div class="info-item">
      <div class="label">Network</div>
      <div class="value" id="si-network">--</div>
    </div>
  </div>
  <div class="btn-row">
    <button class="btn btn-primary" onclick="goStep(1)">Start Setup</button>
  </div>
</div>
</div>

<!-- Step 1: General -->
<div class="step-page" id="step-1">
<div class="card">
  <h2>General Settings</h2>
  <p class="subtitle">Configure your IORA Home instance</p>
  <div class="form-group">
    <label>Instance Name</label>
    <input type="text" id="cfg-hostname" value="iora" placeholder="iora">
  </div>
  <div class="form-group">
    <label>Language</label>
    <select id="cfg-language">
      <option value="de" selected>Deutsch</option>
      <option value="en">English</option>
      <option value="fr">Francais</option>
      <option value="es">Espanol</option>
      <option value="it">Italiano</option>
      <option value="nl">Nederlands</option>
    </select>
  </div>
  <div class="form-group">
    <label>Country</label>
    <select id="cfg-country">
      <option value="DE" selected>Deutschland</option>
      <option value="AT">Oesterreich</option>
      <option value="CH">Schweiz</option>
      <option value="GB">United Kingdom</option>
      <option value="FR">France</option>
      <option value="US">United States</option>
      <option value="NL">Nederland</option>
      <option value="IT">Italia</option>
      <option value="ES">Espana</option>
    </select>
  </div>
  <div class="form-group">
    <label>Timezone</label>
    <select id="cfg-timezone">
      <option value="Europe/Berlin" selected>Europe/Berlin</option>
      <option value="Europe/Vienna">Europe/Vienna</option>
      <option value="Europe/Zurich">Europe/Zurich</option>
      <option value="Europe/London">Europe/London</option>
      <option value="Europe/Paris">Europe/Paris</option>
      <option value="Europe/Amsterdam">Europe/Amsterdam</option>
      <option value="Europe/Rome">Europe/Rome</option>
      <option value="Europe/Madrid">Europe/Madrid</option>
      <option value="US/Eastern">US/Eastern</option>
      <option value="US/Pacific">US/Pacific</option>
      <option value="UTC">UTC</option>
    </select>
  </div>
  <div class="form-group">
    <label>Unit System</label>
    <select id="cfg-unit">
      <option value="metric" selected>Metric (C, km, kg)</option>
      <option value="imperial">Imperial (F, mi, lb)</option>
    </select>
  </div>

  <h2 style="margin-top:24px">IORA Home Web-Admin</h2>
  <p class="subtitle">Dieser Benutzer erhält automatisch Admin-Rechte und meldet sich an der IORA Home Web-Oberfläche (Port 8126) an.</p>
  <div class="form-group">
    <label>Benutzername</label>
    <input type="text" id="cfg-admin-user" value="admin" placeholder="admin" autocomplete="username">
  </div>
  <div class="form-group">
    <label>Passwort (mind. 8 Zeichen)</label>
    <input type="password" id="cfg-admin-pass" placeholder="••••••••" autocomplete="new-password">
  </div>
  <div class="form-group">
    <label>Passwort wiederholen</label>
    <input type="password" id="cfg-admin-pass2" placeholder="••••••••" autocomplete="new-password">
  </div>

  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(0)">Back</button>
    <button class="btn btn-primary" onclick="goStep(2)">Next</button>
  </div>
</div>
</div>

<!-- Step 2: Integrations -->
<div class="step-page" id="step-2">
<div class="card">
  <h2>Integrations</h2>
  <p class="subtitle">Enable smart home protocols</p>
  <div class="toggle-row">
    <div class="info">
      <h3>MQTT Broker</h3>
      <p>Message bus for IoT devices (Mosquitto)</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-mqtt" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Zigbee (Zigbee2MQTT)</h3>
      <p>Control Zigbee devices via USB adapter</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-zigbee">
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Z-Wave</h3>
      <p>Control Z-Wave devices via USB adapter</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-zwave">
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Database (PostgreSQL)</h3>
      <p>Persistent storage for history and events</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-db" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(1)">Back</button>
    <button class="btn btn-primary" onclick="goStep(3)">Next</button>
  </div>
</div>
</div>

<!-- Step 3: Network / Advanced -->
<div class="step-page" id="step-3">
<div class="card">
  <h2>Advanced Settings</h2>
  <p class="subtitle">Optional configuration</p>
  <div class="toggle-row">
    <div class="info">
      <h3>Auto-start services</h3>
      <p>Start IORA containers on boot</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-autostart" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Automatic updates</h3>
      <p>Keep containers up to date (via Watchtower)</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-autoupdate" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>SSH Access</h3>
      <p>Remote terminal access (already enabled)</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-ssh" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(2)">Back</button>
    <button class="btn btn-primary" onclick="doInstall()">Finish Setup</button>
  </div>
</div>
</div>

<!-- Step 4: Applying -->
<div class="step-page" id="step-4">
<div class="card">
  <div class="finish-box" id="applyingBox">
    <div class="spinner"></div>
    <h2>Applying Configuration…</h2>
    <p class="subtitle">Setting up your IORA OS instance. This can take a few minutes — Docker images are being pulled.</p>

    <div class="warning-banner in-progress" style="margin:18px 0 8px">
      <strong>Do NOT close this tab</strong> and do not power off the device.
      Progress is persisted, so opening another tab or reloading will resume
      where you left off.
    </div>

    <div class="apply-progress">
      <div class="pct-row">
        <div class="pct" id="applyPct">0%</div>
        <div class="phase-label" id="applyPhase">Preparing…</div>
      </div>
      <div class="pct-bar"><div class="pct-bar-fill" id="applyBar"></div></div>
      <div class="log-pane" id="applyLog"></div>
    </div>
  </div>
  <div class="finish-box" id="doneBox" style="display:none">
    <div class="icon">&#10003;</div>
    <h2>Setup Complete!</h2>
    <p class="subtitle">Your IORA OS instance is ready.</p>

    <!-- Recovery PIN — shown exactly once. MUST be stored by the user. -->
    <div id="recoveryPinBox" style="display:none;margin:20px 0;padding:18px;
         background:#1a1a2e;border:2px solid #ff6b35;border-radius:8px;text-align:left">
      <h3 style="color:#ff6b35;margin-top:0">&#128274; Recovery PIN — Write This Down!</h3>
      <p style="color:#ccc;margin:4px 0 12px">
        This 16-digit Recovery PIN is your <strong>only</strong> way to access your data
        if something goes wrong. It is shown here <strong>exactly once</strong> and is
        never stored on the device.
      </p>
      <div id="recoveryPinValue" style="font-family:monospace;font-size:2em;
           letter-spacing:4px;color:#fff;text-align:center;padding:12px;
           background:#0d0d1a;border-radius:4px;margin:10px 0"></div>
      <p style="color:#aaa;font-size:0.85em;margin:8px 0 0">
        Store it in a safe place (password manager, printed paper in a secure location).<br>
        You will need it to access your data in Recovery Mode.
      </p>
      <button class="btn btn-primary" onclick="acknowledgePin()" style="margin-top:12px">
        I have written the PIN down
      </button>
    </div>

    <div id="redirectBox">
      <div class="url" id="finalUrl"></div>
      <p class="subtitle" style="margin-top:16px">
        Redirecting automatically in <span id="redirectCountdown">3</span> seconds…
      </p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn btn-primary" onclick="openDashboard()" style="flex:none;padding:12px 40px">
          Open Dashboard Now
        </button>
      </div>
    </div>
  </div>
</div>
</div>

</div>

<script>
let currentStep = 0;
let sysInfo = {};

async function loadSysInfo() {
  try {
    const r = await fetch('/api/sysinfo');
    sysInfo = await r.json();
    document.getElementById('si-hostname').textContent = sysInfo.hostname || '--';
    document.getElementById('si-version').textContent = sysInfo.version || '--';
    document.getElementById('si-memory').textContent = sysInfo.memory_mb ? sysInfo.memory_mb + ' MB' : '--';
    document.getElementById('si-disk').textContent = sysInfo.disk_free_gb
      ? sysInfo.disk_free_gb + ' / ' + sysInfo.disk_total_gb + ' GB'
      : '--';

    const dockerEl = document.getElementById('si-docker');
    if (sysInfo.docker) {
      dockerEl.innerHTML = '<span class="status-dot green"></span>Running';
      dockerEl.className = 'value ok';
    } else {
      dockerEl.innerHTML = '<span class="status-dot red"></span>Not found';
      dockerEl.className = 'value warn';
    }

    const netEl = document.getElementById('si-network');
    if (sysInfo.interfaces && sysInfo.interfaces.length > 0) {
      const active = sysInfo.interfaces.find(i => i.ipv4);
      if (active) {
        netEl.innerHTML = '<span class="status-dot green"></span>' + active.ipv4;
        netEl.className = 'value ok';
      } else {
        netEl.innerHTML = '<span class="status-dot yellow"></span>No IP';
        netEl.className = 'value warn';
      }
    } else {
      netEl.textContent = 'N/A';
    }

    // Pre-fill hostname
    if (sysInfo.hostname) {
      document.getElementById('cfg-hostname').value = sysInfo.hostname;
    }
  } catch(e) {
    console.error('Failed to load system info:', e);
  }
}

function goStep(n) {
  document.getElementById('step-' + currentStep).classList.remove('active');
  document.getElementById('step-' + n).classList.add('active');
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById('prog-' + i);
    el.classList.remove('done', 'active');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
  currentStep = n;
  window.scrollTo(0, 0);
}

function gatherConfig() {
  return {
    hostname:       document.getElementById('cfg-hostname').value || 'iora',
    language:       document.getElementById('cfg-language').value,
    country:        document.getElementById('cfg-country').value,
    timezone:       document.getElementById('cfg-timezone').value,
    unit_system:    document.getElementById('cfg-unit').value,
    enable_mqtt:    document.getElementById('cfg-mqtt').checked,
    enable_zigbee:  document.getElementById('cfg-zigbee').checked,
    enable_zwave:   document.getElementById('cfg-zwave').checked,
    enable_db:      document.getElementById('cfg-db').checked,
    auto_start:     document.getElementById('cfg-autostart').checked,
    auto_update:    document.getElementById('cfg-autoupdate').checked,
    enable_ssh:     document.getElementById('cfg-ssh').checked,
    admin_username: (document.getElementById('cfg-admin-user').value || '').trim(),
    admin_password: document.getElementById('cfg-admin-pass').value || '',
  };
}

async function doInstall() {
  // Validate the web-admin credentials BEFORE switching to the install
  // step — prevents the user from being stranded on the progress page
  // with a setup that finished without seeding the admin user.
  const u  = (document.getElementById('cfg-admin-user').value || '').trim();
  const p1 = document.getElementById('cfg-admin-pass').value || '';
  const p2 = document.getElementById('cfg-admin-pass2').value || '';
  if (u.length < 3 || u.length > 32 || !/^[a-zA-Z0-9._-]+$/.test(u)) {
    alert('Bitte einen Benutzernamen mit 3–32 Zeichen (a-z, A-Z, 0-9, . _ -) angeben.');
    return;
  }
  if (p1.length < 8) {
    alert('Passwort muss mindestens 8 Zeichen lang sein.');
    return;
  }
  if (p1 !== p2) {
    alert('Die beiden Passwörter stimmen nicht überein.');
    return;
  }
  goStep(4);
  const config = gatherConfig();
  try {
    await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    // Response is immediate now; progress is streamed via /api/events
    // (and polled via /api/state as a fallback).
    beginProgressStream();
  } catch(e) {
    alert('Setup failed to start: ' + e);
  }
}

// ── Live progress rendering ──────────────────────────────────────────────
// Subscribe to /api/events (SSE) and fall back to polling /api/state. The
// server persists state so opening a second tab or reloading the page
// picks up where we left off.
let __iora_stream = null;
let __iora_pollTimer = null;
let __iora_lastLogTs = 0;

function beginProgressStream() {
  if (!window.__iora_beforeunload_bound) {
    window.addEventListener('beforeunload', (e) => {
      const applying = document.getElementById('applyingBox');
      if (currentStep === 4 && applying && applying.style.display !== 'none') {
        e.preventDefault();
        e.returnValue = 'Setup is still running. Leaving will not cancel it, but you will lose the Recovery PIN.';
        return e.returnValue;
      }
    });
    window.__iora_beforeunload_bound = true;
  }

  if (__iora_stream) { try { __iora_stream.close(); } catch(_){} __iora_stream = null; }

  try {
    __iora_stream = new EventSource('/api/events');
    __iora_stream.onmessage = (ev) => {
      try { renderState(JSON.parse(ev.data)); } catch(_) {}
    };
  } catch(_) {}
  // Belt-and-braces polling every 2 s — also the primary source when
  // EventSource is unavailable or a proxy buffers SSE.
  startPolling();
}

function startPolling() {
  if (__iora_pollTimer) return;
  const tick = async () => {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      renderState(await r.json());
    } catch(_) {}
  };
  tick();
  __iora_pollTimer = setInterval(tick, 2000);
}

function renderState(state) {
  if (!state) return;

  // Resume view on reload / cross-tab sync.
  if (state.status && state.status !== 'pending' && currentStep !== 4) {
    goStep(4);
  }

  const pct = Math.max(0, Math.min(100, state.percent || 0));
  const pctEl = document.getElementById('applyPct');
  const barEl = document.getElementById('applyBar');
  const phaseEl = document.getElementById('applyPhase');
  if (pctEl) pctEl.textContent = pct + '%';
  if (barEl) barEl.style.width = pct + '%';
  if (phaseEl) phaseEl.textContent = state.phase_label || 'Preparing…';

  if (Array.isArray(state.log)) {
    const pane = document.getElementById('applyLog');
    if (pane) {
      const fresh = state.log.filter(e => (e.ts || 0) > __iora_lastLogTs);
      for (const e of fresh) {
        const line = document.createElement('div');
        if (e.level === 'error') line.className = 'err';
        const dt = new Date((e.ts || 0) * 1000);
        const hh = String(dt.getHours()).padStart(2,'0');
        const mm = String(dt.getMinutes()).padStart(2,'0');
        const ss = String(dt.getSeconds()).padStart(2,'0');
        line.textContent = `${hh}:${mm}:${ss}  ${e.msg}`;
        pane.appendChild(line);
        __iora_lastLogTs = Math.max(__iora_lastLogTs, e.ts || 0);
      }
      pane.scrollTop = pane.scrollHeight;
    }
  }

  if (state.status === 'done' || state.status === 'failed') {
    showDoneBox(state);
  }
}

function showDoneBox(state) {
  const applying = document.getElementById('applyingBox');
  const doneBox = document.getElementById('doneBox');
  if (applying) applying.style.display = 'none';
  if (doneBox) doneBox.style.display = 'block';

  const pin = state.recovery_pin;
  const pinNeedsAck = pin && !state.pin_acknowledged;
  if (pinNeedsAck) {
    const pinBox = document.getElementById('recoveryPinBox');
    const pinVal = document.getElementById('recoveryPinValue');
    if (pinBox && pinVal) {
      pinVal.textContent =
        pin.slice(0,4) + ' ' + pin.slice(4,8) + ' ' +
        pin.slice(8,12) + ' ' + pin.slice(12,16);
      pinBox.style.display = 'block';
    }
  }

  const finalEl = document.getElementById('finalUrl');
  const redirectBox = document.getElementById('redirectBox');
  if (state.finish_url) {
    if (finalEl) finalEl.textContent = state.finish_url;
    if (redirectBox) redirectBox.style.display = 'block';
  } else {
    // iora-home did not come up — suppress redirect, show diagnostic.
    if (redirectBox) redirectBox.style.display = 'none';
    const box = document.getElementById('doneBox');
    if (box && !box.dataset.homeDownShown) {
      const warn = document.createElement('div');
      warn.className = 'subtitle';
      warn.style.cssText = 'margin-top:16px;color:#c94f4f;white-space:pre-wrap;text-align:left;font-family:monospace;font-size:12px;background:#2a1a1a;padding:12px;border-radius:6px;';
      // Check if the error message already explains missing binaries
      const hasBinaryError = state.errors && state.errors.some(
        e => e.includes('not present in this image') || e.includes('not executable')
      );
      if (hasBinaryError) {
        warn.textContent =
          '⚠ Dashboard nicht verfügbar: native Dienst-Binaries fehlen.\n\n' +
          'Das IORA OS Image enthält keine kompilierten Binaries für\n' +
          'iora-home und andere native Dienste.\n\n' +
          'Lösung:\n' +
          '  1. Komplettes IORA OS Image mit kompilierten Binaries erstellen.\n' +
          '  2. Image auf das Gerät flashen.\n' +
          '  3. Setup-Konfiguration ist gespeichert — nur neu flashen nötig.\n\n' +
          'Pfad der Binaries: /opt/iora/build/iora-home/bin/iora-home';
      } else {
        warn.textContent =
          '⚠ Dashboard (port 8126) konnte nicht gestartet werden.\n\n' +
          'Diagnose auf dem IORA-Gerät (SSH oder Konsole):\n' +
          '  systemctl status iora-home.service\n' +
          '  journalctl -u iora-home.service -n 50\n' +
          '  ls /opt/iora/build/iora-home/bin/';
      }
      box.appendChild(warn);
      box.dataset.homeDownShown = '1';
    }
  }

  if (state.errors && state.errors.length) {
    const box = document.getElementById('doneBox');
    if (box && !box.dataset.errorsShown) {
      const warn = document.createElement('div');
      warn.className = 'subtitle';
      warn.style.cssText = 'margin-top:16px;color:#c94f4f;white-space:pre-wrap;text-align:left;font-family:monospace;font-size:12px;background:#2a1a1a;padding:12px;border-radius:6px;max-height:200px;overflow:auto';
      warn.textContent = 'Warnings:\n' + state.errors.join('\n');
      box.appendChild(warn);
      box.dataset.errorsShown = '1';
    }
  }

  // Auto-redirect on success: only when iora-home is confirmed reachable
  // (finish_url will be set). If finish_url is null the service didn't start
  // and we stay on this page to show the diagnostic.
  if (state.status === 'done' && state.finish_url) {
    if (!pinNeedsAck) {
      _scheduleRedirect(3000);
    }
    // If PIN needs ack, _scheduleRedirect() is called by acknowledgePin().
  }
}

let __iora_redirectTimer = null;
function _scheduleRedirect(delayMs) {
  if (__iora_redirectTimer !== null) return;  // only schedule once
  const el = document.getElementById('finalUrl');
  const url = el ? el.textContent.trim() : '';
  if (!url) return;  // iora-home not up — no redirect
  const cntEl = document.getElementById('redirectCountdown');
  let remaining = Math.round(delayMs / 1000);
  if (cntEl) cntEl.textContent = remaining;
  __iora_redirectTimer = setInterval(() => {
    remaining -= 1;
    if (cntEl) cntEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(__iora_redirectTimer);
      window.location.href = url;
    }
  }, 1000);
}

async function acknowledgePin() {
  try { await fetch('/api/ack-pin', { method: 'POST' }); } catch(_) {}
  const pinBox = document.getElementById('recoveryPinBox');
  if (pinBox) pinBox.style.display = 'none';
  // Only redirect if finish_url was set (iora-home is up).
  const el = document.getElementById('finalUrl');
  if (el && el.textContent.trim()) _scheduleRedirect(3000);
}

function openDashboard() {
  if (__iora_redirectTimer !== null) clearInterval(__iora_redirectTimer);
  const el = document.getElementById('finalUrl');
  const url = el ? el.textContent.trim() : '';
  if (url) window.location.href = url;
}

// Init
loadSysInfo();
// Resume live view if an apply is already in progress or finished.
(async function resumeIfRunning() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const s = await r.json();
    if (s && s.status && s.status !== 'pending') {
      beginProgressStream();
    }
  } catch(_) {}
})();
</script>
</body>
</html>"""


class SetupHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for the setup wizard."""

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_html(self, html, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(html.encode())

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/" or path == "/setup":
            self._send_html(SETUP_HTML)
        elif path == "/api/sysinfo":
            self._send_json(get_system_info())
        elif path == "/api/status":
            done = os.path.exists(SETUP_DONE_FLAG)
            self._send_json({"setup_complete": done})
        elif path == "/api/state":
            # Persistent apply-progress snapshot. The UI polls this every
            # second as a fallback for browsers that can't use SSE, and on
            # initial page load so a refresh picks up the live state.
            self._send_json(PROGRESS.snapshot())
        elif path == "/api/events":
            # Server-Sent Events stream of progress updates.
            self._serve_events()
        elif path == "/api/packages":
            self._send_json(fetch_available_packages())
        elif path == "/api/os-update":
            self._send_json(check_os_update())
        elif path == "/api/network":
            # Read current network config via iora-netctl.
            self._send_json(self._call_netctl(["status"]))
        else:
            self.send_error(404)

    def _serve_events(self):
        """Stream progress updates as Server-Sent Events (SSE).

        The handler subscribes to PROGRESS, flushes the current state, and
        then forwards every subsequent update to the client. Heartbeat
        comments are sent every 15 s to keep intermediaries from dropping
        the connection. The stream is closed once status becomes done or
        failed AND the client has acknowledged the recovery PIN (or there
        is none) — otherwise it remains open to re-deliver state to late
        subscribers.
        """
        import time as _time
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        # Disable any proxy buffering so updates arrive immediately.
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = PROGRESS.subscribe()
        last_heartbeat = _time.time()
        try:
            while True:
                try:
                    state = q.get(timeout=5.0)
                    payload = json.dumps(state, default=str)
                    self.wfile.write(f"data: {payload}\n\n".encode())
                    self.wfile.flush()
                except queue.Empty:
                    pass
                now = _time.time()
                if now - last_heartbeat > 15:
                    try:
                        self.wfile.write(b": heartbeat\n\n")
                        self.wfile.flush()
                    except BrokenPipeError:
                        return
                    last_heartbeat = now
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            PROGRESS.unsubscribe(q)

    def _call_netctl(self, args, body=None):
        """Shell out to /usr/bin/iora-netctl — the canonical network
        configurator. Returns the parsed JSON dict on success, or a dict
        with {ok: False, error: …} on failure. Keeping this as a CLI hop
        means the Control Center (which runs in a container) can use the
        exact same interface via `docker exec`, SSH, or an HTTP proxy.
        """
        try:
            cmd = ["/usr/bin/iora-netctl"] + list(args)
            input_bytes = body.encode("utf-8") if body else None
            r = subprocess.run(cmd, input=input_bytes, capture_output=True,
                               timeout=60)
            try:
                return json.loads(r.stdout or r.stderr or b"{}")
            except Exception:
                return {"ok": r.returncode == 0,
                        "stdout": r.stdout.decode("utf-8", "replace"),
                        "stderr": r.stderr.decode("utf-8", "replace")}
        except FileNotFoundError:
            return {"ok": False, "error": "iora-netctl not installed"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "iora-netctl timed out"}

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/network":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8", "replace")
            result = self._call_netctl(["set", "-"], body=body)
            status = 200 if result.get("ok") else 400
            self._send_json(result, status)
            return

        if path == "/api/network/rollback":
            self._send_json(self._call_netctl(["rollback"]))
            return

        if path == "/api/apply":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                config = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "Invalid JSON"}, 400)
                return

            # Idempotent: if a run is already in progress, just return the
            # current state instead of kicking off a second concurrent apply.
            snap = PROGRESS.snapshot()
            if snap["status"] == "running":
                self._send_json({"ok": True, "status": "running",
                                 "state": snap})
                return
            if snap["status"] == "done":
                self._send_json({"ok": True, "status": "done",
                                 "state": snap})
                return

            save_config(config)

            def runner():
                try:
                    errors, recovery_pin = apply_config(config)
                    status = "failed" if errors else "done"
                    # Only redirect to :8126 if iora-home is actually listening.
                    # If the binary is missing or the service failed, stay on
                    # the setup page and show the diagnostics instead of a blank
                    # browser tab.
                    finish_url = None
                    try:
                        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _s:
                            _s.settimeout(2)
                            _s.connect(("127.0.0.1", 8126))
                            finish_url = f"http://{get_local_ip()}:8126"
                    except (OSError, ConnectionRefusedError):
                        pass  # redirect suppressed; UI will show errors
                    PROGRESS.finish(status, finish_url=finish_url)
                    # Schedule shutdown after the user had time to read the
                    # PIN + any error messages. Only on success — on failure
                    # keep the server alive so the user can retry.
                    if status == "done" and not recovery_pin:
                        _schedule_shutdown(30)
                except Exception as exc:  # noqa: BLE001
                    PROGRESS.add_error(f"Apply crashed: {exc}")
                    PROGRESS.finish("failed")

            threading.Thread(target=runner, daemon=True).start()

            # Return immediately so the UI can switch to the progress view
            # and subscribe to /api/events.
            self._send_json({"ok": True, "status": "running"})
            return

        if path == "/api/ack-pin":
            PROGRESS.acknowledge_pin()
            self._send_json({"ok": True})
            # Once the user has copied the PIN we can schedule the setup
            # server shutdown.
            snap = PROGRESS.snapshot()
            if snap["status"] in ("done", "failed"):
                _schedule_shutdown(15)
            return

        self.send_error(404)


def _schedule_shutdown(delay_sec: int) -> None:
    """Schedule an os._exit() after the given delay.

    Stops the setup server so systemd can run the next unit in the boot
    chain. Also disables iora-setup.service so a reboot doesn't relaunch
    the wizard.
    """
    def shutdown_later():
        import time
        time.sleep(delay_sec)
        print(f"Setup complete. Shutting down setup server after {delay_sec}s.")
        # Flush all kernel dirty buffers to disk so the .setup-complete flag
        # and config files survive a hard reset immediately after shutdown.
        try:
            subprocess.run(["sync"], timeout=10, check=False)
        except Exception:
            pass
        os._exit(0)
    threading.Thread(target=shutdown_later, daemon=True).start()


def main():
    # Check if setup is already complete
    if os.path.exists(SETUP_DONE_FLAG):
        print(f"Setup already completed. Remove {SETUP_DONE_FLAG} to re-run.")
        sys.exit(0)

    # Ensure DATA_DIR exists. On a freshly-dd'd image or when the iora-data
    # partition could not be mounted, /mnt/data/iora may be missing; create
    # it on whatever filesystem currently backs /mnt/data (rootfs if the
    # data partition is absent) so the wizard can still write setup.json.
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except OSError as exc:
        print(f"WARNING: could not create {DATA_DIR}: {exc}", file=sys.stderr)

    server = http.server.ThreadingHTTPServer(("0.0.0.0", SETUP_PORT), SetupHandler)
    hostname = socket.gethostname()

    # Get first IP
    ip = "0.0.0.0"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print(f"IORA OS Setup Wizard")
    print(f"  http://{ip}:{SETUP_PORT}")
    print(f"  http://{hostname}:{SETUP_PORT}")
    print()
    print("Waiting for setup to be completed via web browser...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSetup server stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
