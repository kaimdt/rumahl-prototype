#!/usr/bin/env bash
# ============================================================================
# iora-dev-hot-reload.sh – IORA Dev VM Hot-Reload Daemon
# ============================================================================
# Runs INSIDE the dev VM (systemd: iora-hot-reload.service). Watches the 1:1
# source mirror (/home/iora/iora) that the host keeps in sync (dev-sync.sh)
# and keeps the running services up to date automatically:
#
#   Source mode (default, marker /etc/iora/dev-run-mode = "source"):
#     - change under backend/services/<svc>/*.rs|Cargo.toml  -> restart <svc>
#       (cargo run recompiles only the affected crate, incrementally)
#     - change under backend/shared/, backend/Cargo.toml     -> restart ALL
#     - frontend/package.json or package-lock.json           -> restart
#       iora-frontend-dev (Vite picks up new dependencies)
#     - other frontend changes need NO restart (Vite HMR)
#
#   Build mode (marker = "build"):
#     - a new binary in .iora-dev/binaries/<svc> is deployed to
#       /usr/bin/iora-<svc> and the service restarted (host-built binaries
#       that travel inside the mirror)
#
# Logs go to journald:  journalctl -u iora-hot-reload -f
# ============================================================================
# shellcheck disable=SC2155

set -uo pipefail

MIRROR="/home/iora/iora"
BACKEND="$MIRROR/iora-os/backend"
BIN_SRC="$MIRROR/.iora-dev/binaries"
HASH_DIR="/var/lib/iora/dev-binary-hashes"
LOG_TAG="iora-hot-reload"
MAX_WAIT=60

log()  { echo "[$(date -Iseconds)] $LOG_TAG: $*"; }
warn() { echo "[$(date -Iseconds)] $LOG_TAG [WARN]: $*"; }

# ── Run mode (source = cargo run, build = deployed binaries) ───────────────
RUN_MODE="source"
[ -f /etc/iora/dev-run-mode ] && RUN_MODE=$(cat /etc/iora/dev-run-mode)

# Wait until the mirror is actually mounted/synced (first boot)
for _ in $(seq 1 $MAX_WAIT); do
    [ -d "$BACKEND" ] && [ -f "$BACKEND/Cargo.toml" ] && break
    sleep 1
done
[ -d "$BACKEND" ] || { log "Mirror $BACKEND not available after ${MAX_WAIT}s – giving up."; exit 1; }

# ── Helpers ────────────────────────────────────────────────────────────────
all_iora_services() {
    systemctl list-unit-files --type=service 'iora-*.service' --no-legend 2>/dev/null \
        | awk '{print $1}' | sed 's/\.service$//' | grep -v 'iora-hot-reload'
}

restart_service() {
    local svc="$1"
    # Source mode runs the prebuilt binaries directly (see
    # iora-dev-services.sh) - rebuild the affected crate before the restart
    # so source changes are picked up. Incremental, so this is fast.
    if [ "$RUN_MODE" = "source" ]; then
        su - iora -c "cd $BACKEND && /home/iora/.cargo/bin/cargo build -p ${svc#iora-} -q" \
            >/dev/null 2>&1 || warn "build failed for $svc"
    fi
    systemctl reset-failed "$svc" 2>/dev/null
    systemctl restart "$svc" 2>/dev/null \
        || systemctl start "$svc" 2>/dev/null \
        || warn "could not restart $svc"
    log "restarted $svc"
}

restart_all() {
    local svcs
    svcs=$(all_iora_services)
    log "shared/workspace change – restarting all services"
    for svc in $svcs; do
        restart_service "$svc"
    done
}

# Map a changed path to the affected service(s); returns via $AFFECTED
# (comma-separated) or "ALL"
map_path() {
    local path="$1"
    AFFECTED=""
    case "$path" in
        "$BACKEND/shared/"*|"$BACKEND/Cargo.toml"|"$BACKEND/Cargo.lock")
            AFFECTED="ALL" ;;
        "$BACKEND/services/"*)
            case "$path" in
                *.rs|*/Cargo.toml|*/Cargo.lock)
                    local svc
                    svc=$(printf '%s' "$path" | sed -n 's#^.*/services/\([^/]*\)/.*$#\1#p')
                    [ -n "$svc" ] && AFFECTED="$svc" ;;
            esac ;;
        "$MIRROR/frontend/package.json"|"$MIRROR/frontend/package-lock.json")
            AFFECTED="iora-frontend-dev" ;;
    esac
    return 0
}

deploy_binary() {
    local name="$1"
    [ -f "$BIN_SRC/$name" ] || return 0
    local h prev
    h=$(sha256sum "$BIN_SRC/$name" 2>/dev/null | awk '{print $1}')
    prev=""
    [ -f "$HASH_DIR/$name" ] && prev=$(cat "$HASH_DIR/$name" 2>/dev/null)
    [ -n "$h" ] && [ "$h" = "$prev" ] && return 0  # already deployed this exact binary

    if install -m 0755 "$BIN_SRC/$name" "/usr/bin/iora-$name" 2>/dev/null; then
        echo "$h" > "$HASH_DIR/$name"
        log "deployed binary iora-$name"
        if [ -f /etc/iora/.no-restart ]; then
            log "restart skipped (/etc/iora/.no-restart present)"
        else
            restart_service "$name"
        fi
    fi
    return 0
}

# ── Watch loop ─────────────────────────────────────────────────────────────
log "Hot-reload daemon started (mode: $RUN_MODE, mirror: $MIRROR)"

if [ "$RUN_MODE" = "build" ]; then
    # Build mode: watch the drop-box (binaries arrive via the mirror or
    # dev-watch.sh). Hash tracking avoids repeated deploys of the same file.
    mkdir -p "$HASH_DIR" "$BIN_SRC"
    log "Build mode – watching $BIN_SRC"
    while true; do
        for bin in "$BIN_SRC"/*; do
            [ -f "$bin" ] || continue
            deploy_binary "$(basename "$bin")"
        done
        sleep 2
    done
fi

# Source mode: watch the backend source tree (frontend is handled by Vite HMR)
log "Source mode – watching $BACKEND"
BUF=/tmp/iora-hot-reload-events
: > "$BUF"

# Collect raw events into a buffer; a 2s loop processes them batched + deduped
# (one rsync burst then causes exactly ONE restart per affected service)
inotifywait -m -r -q \
    -e modify -e create -e delete -e move \
    --exclude '(/target/|/node_modules/|/\.git/|\.DS_Store)' \
    --format '%w%f' \
    "$BACKEND" "$MIRROR/frontend" 2>/dev/null |
while IFS= read -r path; do
    echo "$path" >> "$BUF"
done &
WATCHER_PID=$!
trap 'kill $WATCHER_PID 2>/dev/null || true' EXIT INT TERM

while true; do
    sleep 2
    [ -s "$BUF" ] || continue

    DO_ALL=false
    SVCS=""
    while IFS= read -r path; do
        map_path "$path"
        case "$AFFECTED" in
            ALL) DO_ALL=true ;;
            "") : ;;  # irrelevant file (docs, frontend src, ...)
            *)  case "|$SVCS|" in
                    *"|$AFFECTED|"*) : ;;  # already queued
                    *) SVCS="$SVCS|$AFFECTED" ;;
                esac ;;
        esac
    done < "$BUF"
    : > "$BUF"

    if $DO_ALL; then
        restart_all
    else
        for s in ${SVCS//|/ }; do
            [ -n "$s" ] && restart_service "$s"
        done
    fi
done
