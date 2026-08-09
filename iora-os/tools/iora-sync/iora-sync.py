"""
iora-sync.py — 100 % dev-sync watcher (local → QEMU dev VM).

Scans the repository every few seconds, streams changed files to the VM in a
single tar over SSH, rebuilds + restarts backend services when Rust sources
changed, and reports every action/error into `iora-os/.cache/dev-local.log`
(which the IORA Dev Manager streams into its web dashboard) and
`iora-os/.cache/sync-status.json`.

Usage:
    python iora-sync.py            # run in the foreground
    pythonw iora-sync.py           # run detached (no console)
"""

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(r"C:\tmp\home-assistant-dashb")
OS_ROOT = REPO / "iora-os"
KEY = OS_ROOT / ".cache" / "iora-dev-key"
REMOTE = "/home/iora/iora"
SSH_PORT = "2222"
SSH_HOST = "127.0.0.1"

LOG_FILE = OS_ROOT / ".cache" / "dev-local.log"      # streamed by the dev manager
STATUS_FILE = OS_ROOT / ".cache" / "sync-status.json"

SKIP_DIRS = {".git", "node_modules", "target", ".cache", "dist", "dist_new", "src_new", ".venv", "__pycache__"}
WATCH_ROOTS = ["frontend", "iora-os/backend/services", "iora-os/backend/shared",
               "iora-os/backend/tools", "custom_components", "desktop", "sdks"]
EXTENSIONS = {".ts", ".tsx", ".css", ".rs", ".sql", ".json", ".html", ".js", ".yaml", ".yml"}
SPECIAL_NAMES = {"vite.config.ts", "vite.config.js", "package.json", "index.html",
                 "Cargo.toml", "manifest.yaml"}

SSH_BASE = [
    "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=NUL",
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ConnectionAttempts=2",
    "-i", str(KEY), "-p", SSH_PORT, f"root@{SSH_HOST}",
]


def log(message: str, kind: str = "sync"):
    line = f"[{kind}] {message}"
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    print(line, flush=True)


def write_status(state: dict):
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as fh:
            json.dump(state, fh, indent=2)
    except OSError:
        pass


def relevant_files() -> list:
    files = []
    for root in WATCH_ROOTS:
        base = REPO / root
        if not base.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                path = Path(dirpath) / name
                if path.suffix in EXTENSIONS or name in SPECIAL_NAMES:
                    rel = path.relative_to(REPO).as_posix()
                    files.append((rel, path.stat().st_mtime_ns))
    return files


def scan() -> dict:
    return {rel: mtime for rel, mtime in relevant_files()}


def remote_timestamps() -> dict:
    """Guest mtimes for the same file set (one SSH call)."""
    cmd = SSH_BASE + [
        "cd /home/iora/iora && find frontend iora-os/backend/services iora-os/backend/shared "
        "iora-os/backend/tools custom_components -type f \\("
        " -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.rs' -o -name '*.sql'"
        " -o -name '*.json' -o -name '*.html' -o -name '*.js' -o -name '*.yaml' -o -name '*.yml'"
        " -o -name 'Cargo.toml' -o -name 'vite.config.ts' -o -name 'vite.config.js'"
        " \\) -printf '%T@ %p\\n' 2>/dev/null"
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout
    except Exception as exc:
        log(f"remote scan failed: {exc}", "error")
        return {}
    result = {}
    for line in out.splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2 and parts[1].startswith("frontend/"):
            try:
                result[parts[1].strip()] = float(parts[0])
            except ValueError:
                pass
    return result


def bulk_sync(rel_paths: list) -> bool:
    """Stream the given files in one tar over SSH; returns success."""
    tar = subprocess.Popen(
        ["tar", "-cf", "-", "-C", str(REPO), "--no-recursion", "--files-from", "-"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
    )
    try:
        tar.stdin.write("\n".join(rel_paths).encode("utf-8"))
        tar.stdin.close()
    except BrokenPipeError:
        pass
    ssh = subprocess.run(
        SSH_BASE + ["tar -xf - -C /home/iora/iora && chown -R iora:iora "
                    "/home/iora/iora/frontend /home/iora/iora/iora-os/backend "
                    "/home/iora/iora/custom_components && "
                    "find /home/iora/iora/frontend /home/iora/iora/iora-os/backend "
                    "/home/iora/iora/custom_components -mmin -2 -exec touch -m {{}} + 2>/dev/null"],
        stdin=tar.stdout, timeout=120,
    )
    tar.stdout.close()
    tar.wait(timeout=30)
    return ssh.returncode == 0 and tar.returncode == 0


def rebuild(rel_paths: list):
    """Rebuild + restart backend crates touched by the changed files."""
    crates = set()
    for rel in rel_paths:
        if rel.startswith("iora-os/backend/services/iora-files"):
            crates.add("iora-files")
        elif rel.startswith("iora-os/backend/services/iora-home"):
            crates.add("iora-home")
    if not crates:
        return
    for crate in sorted(crates):
        log(f"building {crate}…", "build")
        cmd = SSH_BASE + [
            f"cd /home/iora/iora/iora-os/backend && "
            f"sudo -u iora bash -c 'cd /home/iora/iora/iora-os/backend && "
            f"HOME=/home/iora /home/iora/.cargo/bin/cargo build -p {crate} --offline' "
            f"&& systemctl restart {crate} && systemctl is-active --quiet {crate}"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if result.returncode == 0:
            log(f"{crate} rebuilt + restarted (healthy)", "ok")
        else:
            log(f"{crate} build/restart FAILED: {result.stderr.strip()[-400:]}", "error")
            write_status({"error": f"{crate} build failed", "stderr": result.stderr[-600:]})


def main():
    log("iora-sync watcher started (scan interval 4s)", "status")
    write_status({"running": True, "last": None, "error": None})
    local = scan()
    while True:
        time.sleep(4)
        try:
            changed = scan()
        except Exception as exc:
            log(f"scan failed: {exc}", "error")
            continue
        drifted = [rel for rel, mtime in changed.items()
                   if rel not in local or local[rel] != mtime]
        if not drifted:
            continue
        # Debounce: wait for the editor to finish writing.
        time.sleep(1.5)
        changed = scan()
        drifted = [rel for rel, mtime in changed.items()
                   if rel not in local or local[rel] != mtime]
        if not drifted:
            continue
        local = changed
        log(f"synchronizing {len(drifted)} file(s)…")
        if bulk_sync(drifted):
            log(f"{len(drifted)} file(s) synced to the VM", "ok")
            write_status({"running": True, "last": len(drifted), "error": None,
                          "at": time.strftime("%H:%M:%S")})
        else:
            log("tar sync FAILED — will retry on next change", "error")
            write_status({"running": True, "error": "tar sync failed"})
            continue
        rust = [rel for rel in drifted if rel.endswith((".rs", ".sql")) or rel.endswith("Cargo.toml")]
        if rust:
            rebuild(rust)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("watcher stopped", "status")
        write_status({"running": False})
