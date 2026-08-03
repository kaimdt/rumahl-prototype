#!/usr/bin/env bash
# ============================================================================
# qga.sh – IORA Dev VM control over the QEMU Guest Agent (no IP needed)
# ============================================================================
# Talks to the running dev VM through the virtio-serial channel
# (qemu-guest-agent). This works even when the VM has NO network/IP at all,
# which makes it the primary control channel for the dev loop:
#
#   ./qga.sh ping                          # is the agent reachable?
#   ./qga.sh exec 'systemctl status iora-home'
#   ./qga.sh exec 'journalctl -u iora-home -n 30'
#   ./qga.sh read  /etc/iora/iora-home.env # print a VM file
#   ./qga.sh write /tmp/test.txt 'hello'   # write a VM file (notfall sync)
#   ./qga.sh reboot                        # reboot the VM
#   ./qga.sh shutdown                      # power off the VM
#
# Socket: <repo>/iora-os/.cache/qga.sock (created by dev-local.sh).
# Protocol: JSON lines, base64 for file/output data.
# ============================================================================
# shellcheck disable=SC2155,SC2086

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$SCRIPT_DIR/.cache"
QGA_SOCK="${QGA_SOCK:-$CACHE/qga.sock}"

if [ -t 1 ]; then C=$'\033[0;36m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; R=$'\033[0;31m'; N=$'\033[0m'
else C=''; G=''; Y=''; R=''; N=''; fi
err() { printf '%s[X]%s %s\n' "$R" "$N" "$*" >&2; }

# ── Low-level: send one JSON line, read one JSON line back ─────────────────
qga_json() {
    [ -S "$QGA_SOCK" ] || { err "Guest-agent socket not found: $QGA_SOCK"; err "Start the VM first: ./dev-local.sh"; return 1; }
    if ! command -v socat >/dev/null 2>&1; then
        err "socat is required (brew install socat / apt install socat)"
        return 1
    fi
    printf '%s\n' "$1" | socat - "UNIX-CONNECT:$QGA_SOCK" 2>/dev/null | head -1
}

# ── JSON helpers (python3 is available on macOS/Linux/WSL) ─────────────────
json_get() {  # $1=json  $2=key path like 'return.pid'
    printf '%s' "$1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k in '$2'.split('.'):
    d = d.get(k) if isinstance(d, dict) else None
    if d is None: break
print(d if d is not None else '')
" 2>/dev/null
}

# ── Commands ───────────────────────────────────────────────────────────────
qga_ping() {
    local resp
    resp=$(qga_json '{"execute":"guest-ping"}') || return 1
    case "$resp" in
        *'"return"'*) echo "OK"; return 0 ;;
        *) err "Unexpected reply: $resp"; return 1 ;;
    esac
}

qga_exec() {  # $1 = shell command
    local resp pid code out
    resp=$(qga_json "{\"execute\":\"guest-exec\",\"arguments\":{\"path\":\"/bin/sh\",\"arg\":[\"-c\",\"$1\"],\"capture-output\":true}}") || return 1
    pid=$(json_get "$resp" "return.pid")
    [ -n "$pid" ] || { err "guest-exec failed: $resp"; return 1; }
    # Poll guest-exec-status until the process exits
    for _ in $(seq 1 120); do
        sleep 0.5
        local st
        st=$(qga_json "{\"execute\":\"guest-exec-status\",\"arguments\":{\"pid\":$pid}}")
        code=$(json_get "$st" "return.exitcode")
        if [ -n "$code" ]; then
            out=$(printf '%s' "$st" | python3 -c "
import json, sys, base64
r = json.load(sys.stdin).get('return', {})
d = r.get('out-data')
sys.stdout.write(base64.b64decode(d).decode('utf-8', 'replace') if d else '')
" 2>/dev/null)
            printf '%s' "$out"
            [ "$code" = "0" ] && return 0 || return 1
        fi
    done
    err "guest-exec timed out"
    return 1
}

qga_read() {  # $1 = remote path
    local resp handle data
    resp=$(qga_json "{\"execute\":\"guest-file-open\",\"arguments\":{\"path\":\"$1\",\"mode\":\"r\"}}") || return 1
    handle=$(json_get "$resp" "return")
    [ -n "$handle" ] || { err "guest-file-open failed: $resp"; return 1; }
    data=$(qga_json "{\"execute\":\"guest-file-read\",\"arguments\":{\"handle\":$handle,\"count\":1048576}}")
    printf '%s' "$data" | python3 -c "
import json, sys, base64
r = json.load(sys.stdin).get('return', {})
d = r.get('buf-data')
sys.stdout.write(base64.b64decode(d).decode('utf-8', 'replace') if d else '')
" 2>/dev/null
    qga_json "{\"execute\":\"guest-file-close\",\"arguments\":{\"handle\":$handle}}" >/dev/null 2>&1
    return 0
}

qga_write() {  # $1 = remote path, $2 = content (or stdin if omitted)
    local content
    if [ $# -ge 2 ]; then content="$2"; else content=$(cat); fi
    local b64
    b64=$(printf '%s' "$content" | base64 | tr -d '\n')
    local resp handle
    resp=$(qga_json "{\"execute\":\"guest-file-open\",\"arguments\":{\"path\":\"$1\",\"mode\":\"w\"}}") || return 1
    handle=$(json_get "$resp" "return")
    [ -n "$handle" ] || { err "guest-file-open (write) failed: $resp"; return 1; }
    qga_json "{\"execute\":\"guest-file-write\",\"arguments\":{\"handle\":$handle,\"buf-b64\":\"$b64\"}}" >/dev/null 2>&1
    qga_json "{\"execute\":\"guest-file-close\",\"arguments\":{\"handle\":$handle}}" >/dev/null 2>&1
    echo "written: $1"
    return 0
}

qga_reboot()  { qga_json '{"execute":"guest-reboot"}' >/dev/null 2>&1 && echo "reboot sent"; }
qga_shutdown(){ qga_json '{"execute":"guest-shutdown"}' >/dev/null 2>&1 && echo "shutdown sent"; }

# ── Main (only when run standalone – dev-local.sh sources this file) ──────
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
case "${1:-}" in
    ping)    qga_ping ;;
    exec)    shift; qga_exec "$*" ;;
    read)    shift; qga_read "${1:-}" ;;
    write)   shift; qga_write "${1:-}" "${2:-}" ;;
    reboot)  qga_reboot ;;
    shutdown) qga_shutdown ;;
    -h|--help) sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) err "Usage: $0 {ping|exec <cmd>|read <path>|write <path> [content]|reboot|shutdown}"; exit 1 ;;
esac
fi
