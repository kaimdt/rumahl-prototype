#!/usr/bin/env bash
# ============================================================================
# dev-sync.sh – IORA Dev VM 1:1 Mirror Sync (once or live watch)
# ============================================================================
# Mirrors the host repository into the dev VM (/home/iora/iora) with
# `rsync --delete` – a true 1:1 copy of all source files (build artifacts
# like target/ and node_modules/ are intentionally excluded and stay in
# their place on each side).
#
# In --watch mode the mirror is kept in sync CONTINUOUSLY (fswatch on macOS,
# inotifywait on Linux/WSL2, polling fallback), so the VM always sees your
# latest edits within ~1s – no manual re-sync, no waiting.
#
# Usage:
#   ./dev-sync.sh --once           Full mirror now, then exit
#   ./dev-sync.sh --watch          Full mirror + keep watching (default)
#   ./dev-sync.sh --vm-port 2222   SSH port (default 2222)
#   ./dev-sync.sh --ssh-key PATH   SSH key (default: ./.cache/iora-dev-key)
#   ./dev-sync.sh --with-binaries  Also mirror .iora-dev/binaries (build mode)
#   ./dev-sync.sh --no-delete      Keep VM files that were deleted on the host
#   ./dev-sync.sh --quiet          No per-sync logging
#   ./dev-sync.sh --help
#
# Windows/WSL2: run inside WSL –  wsl bash dev-sync.sh --watch
# (the repo is reached via /mnt/c/...; the SSH key is copied to ~/.ssh
#  automatically because drvfs permissions would make ssh refuse it)
# ============================================================================
# shellcheck disable=SC2155,SC2034,SC2086

set -uo pipefail

# ── Colors & logging ────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C=$'\033[0;36m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; R=$'\033[0;31m'; D=$'\033[2m'; N=$'\033[0m'
else
    C=''; G=''; Y=''; R=''; D=''; N=''
fi
log()  { printf '%s[*]%s %s\n' "$C" "$N" "$*"; }
ok()   { printf '%s[+]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*" >&2; }
err()  { printf '%s[X]%s %s\n' "$R" "$N" "$*" >&2; }
die()  { err "$*"; exit 1; }

# ── Args ────────────────────────────────────────────────────────────────────
WATCH=false
ONCE=false
VM_PORT=2222
SSH_KEY=""
WITH_BINARIES=false
NO_DELETE=false
QUIET=false

usage() { sed -n '4,30p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
    case "$1" in
        --watch)          WATCH=true; shift ;;
        --once)           ONCE=true; shift ;;
        --vm-port)        VM_PORT="$2"; shift 2 ;;
        --ssh-key)        SSH_KEY="$2"; shift 2 ;;
        --with-binaries)  WITH_BINARIES=true; shift ;;
        --no-delete)      NO_DELETE=true; shift ;;
        --quiet)          QUIET=true; shift ;;
        -h|--help)        usage; exit 0 ;;
        *) die "Unknown argument: $1 (try --help)" ;;
    esac
done

# ── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE="$SCRIPT_DIR/.cache"
mkdir -p "$CACHE"
[ -n "$SSH_KEY" ] || SSH_KEY="$CACHE/iora-dev-key"
[ -f "$SSH_KEY" ] || die "SSH key not found: $SSH_KEY (start the VM first: ./dev-local.sh)"

# WSL: drvfs keys have loose permissions that ssh refuses – copy to ~/.ssh
IS_WSL=false
grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null && IS_WSL=true
SYNC_KEY="$SSH_KEY"
if $IS_WSL; then
    mkdir -p "$HOME/.ssh"
    if install -m 600 "$SSH_KEY" "$HOME/.ssh/iora-dev-key" 2>/dev/null; then
        SYNC_KEY="$HOME/.ssh/iora-dev-key"
    fi
fi

# ── SSH + rsync (ControlMaster: one TCP connection reused across syncs) ─────
SSH_SOCK_DIR="$CACHE/ssh-socks"
mkdir -p "$SSH_SOCK_DIR"
SSH_OPTS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o ConnectTimeout=5
    -o ServerAliveInterval=15
    -o AddressFamily=inet
    -o ControlMaster=auto
    -o "ControlPath=$SSH_SOCK_DIR/cm-%C"
    -o ControlPersist=600
    -o LogLevel=ERROR
    -i "$SYNC_KEY"
    -p "$VM_PORT"
)

EXCLUDES=(
    --exclude='.git/'
    --exclude='target/'
    --exclude='node_modules/'
    --exclude='.cache/'
    --exclude='buildroot-*'
    --exclude='releases/'
    --exclude='*.img'
    --exclude='*.qcow2'
    --exclude='*.iso'
    --exclude='*.tar.gz'
    --exclude='.iora-dev/'
    --exclude='.DS_Store'
)
$NO_DELETE || EXCLUDES+=(--delete)

# ── The mirror operation (incremental: only changed files are transferred) ──
sync_now() {
    local rc=0
    $QUIET || log "Syncing mirror -> VM (incremental)..."
    rsync -az "${EXCLUDES[@]}" \
        -e "ssh ${SSH_OPTS[*]}" \
        "$REPO_ROOT/" "root@127.0.0.1:/home/iora/iora/" || rc=1

    if $WITH_BINARIES && [ -d "$REPO_ROOT/.iora-dev/binaries" ]; then
        # Build-mode artifacts live INSIDE the mirror under .iora-dev/binaries
        rsync -az --delete \
            -e "ssh ${SSH_OPTS[*]}" \
            "$REPO_ROOT/.iora-dev/binaries/" "root@127.0.0.1:/home/iora/iora/.iora-dev/binaries/" || rc=1
    fi

    # Keep the tree owned by the iora user (cargo run / vite need write access)
    ssh "${SSH_OPTS[@]}" root@127.0.0.1 "chown -R iora:iora /home/iora/iora 2>/dev/null || true" >/dev/null 2>&1 || true

    if [ "$rc" -eq 0 ]; then
        $QUIET || ok "Mirror in sync ($(date +%H:%M:%S))"
    else
        warn "rsync failed – retrying in 5s..."
        sleep 5
        rsync -az "${EXCLUDES[@]}" -e "ssh ${SSH_OPTS[*]}" \
            "$REPO_ROOT/" "root@127.0.0.1:/home/iora/iora/" \
            && ssh "${SSH_OPTS[@]}" root@127.0.0.1 "chown -R iora:iora /home/iora/iora 2>/dev/null || true" >/dev/null 2>&1 || true
    fi
    return 0
}

# ── Watch loops (event -> 1s debounce -> incremental sync) ──────────────────
watch_fswatch() {
    fswatch -r -E \
        --exclude '\.git$' --exclude '/target/' --exclude '/node_modules/' \
        --exclude '/\.cache/' --exclude '\.iora-dev' --exclude '\.DS_Store$' \
        "$REPO_ROOT" 2>/dev/null | while IFS= read -r _; do
            sleep 1
            sync_now
        done
}

watch_inotify() {
    inotifywait -m -r -q \
        -e modify -e create -e delete -e move \
        --exclude '(\.git/|/target/|/node_modules/|/\.cache/|\.iora-dev/|\.DS_Store)' \
        "$REPO_ROOT" 2>/dev/null | while IFS= read -r _; do
            sleep 1
            sync_now
        done
}

watch_poll() {
    local stamp="$CACHE/.sync-stamp"
    touch "$stamp"
    warn "No fswatch/inotifywait found – using 5s polling fallback."
    while true; do
        sleep 5
        if find "$REPO_ROOT" -newer "$stamp" \
            -not -path '*/.git/*' -not -path '*/target/*' \
            -not -path '*/node_modules/*' -not -path '*/.cache/*' \
            2>/dev/null | grep -q .; then
            sync_now
            touch "$stamp"
        fi
    done
}

# ── Main ────────────────────────────────────────────────────────────────────
sync_now

if $ONCE; then
    ok "1:1 mirror complete. Use --watch to keep it in sync automatically."
    exit 0
fi

log "Watching for changes (Ctrl+C to stop)..."
$QUIET || dim "  Debounce: 1s | Mirror: /home/iora/iora | SSH port: $VM_PORT"
if command -v fswatch >/dev/null 2>&1; then
    watch_fswatch
elif command -v inotifywait >/dev/null 2>&1; then
    watch_inotify
else
    watch_poll
fi
