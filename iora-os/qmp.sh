#!/usr/bin/env bash
# ============================================================================
# qmp.sh – IORA Dev VM hypervisor control over QEMU Machine Protocol
# ============================================================================
# Talks to QEMU itself (not the guest) – the same channel Proxmox uses to
# manage its VMs. Together with qga.sh (guest agent) the VM is no black
# box: the dev server can see and steer the VM at the hypervisor level.
#
#   ./qmp.sh status                    # running/paused/... + CPU/RAM/block info
#   ./qmp.sh info                      # same as status (Proxmox-style summary)
#   ./qmp.sh pause                     # freeze the VM (stop)
#   ./qmp.sh resume                    # unfreeze (cont)
#   ./qmp.sh powerdown                 # ACPI shutdown
#   ./qmp.sh reset                     # reboot the VM
#   ./qmp.sh screenshot <file.png>     # PNG of the VM console
#   ./qmp.sh sendkey <qcode>           # send a key, e.g. enter, f1, ctrl-alt-delete
#   ./qmp.sh hmp 'info block'          # any HMP monitor command
#   ./qmp.sh balloon 4096              # set VM RAM to 4096 MB (needs virtio-balloon)
#   ./qmp.sh net off|on                # disconnect/reconnect the VM NIC
#
# Socket: <repo>/iora-os/.cache/qmp.sock (created by dev-local.sh).
# Protocol: QMP JSON with capabilities handshake.
# ============================================================================
# shellcheck disable=SC2155,SC2086

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$SCRIPT_DIR/.cache"
QMP_SOCK="${QMP_SOCK:-$CACHE/qmp.sock}"

if [ -t 1 ]; then C=$'\033[0;36m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; R=$'\033[0;31m'; N=$'\033[0m'
else C=''; G=''; Y=''; R=''; N=''; fi
err() { printf '%s[X]%s %s\n' "$R" "$N" "$*" >&2; }

# ── Low-level: QMP command with handshake (python3 does the socket dance) ──
qmp_json() {  # $1 = JSON command
    [ -S "$QMP_SOCK" ] || { err "QMP socket not found: $QMP_SOCK"; err "Start the VM first: ./dev-local.sh"; return 1; }
    python3 - "$QMP_SOCK" "$1" <<'PYEOF'
import socket, sys, json
sock, cmd = sys.argv[1], sys.argv[2]
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(sock)
    f = s.makefile("rwb")
    # QMP handshake: greeting -> qmp_capabilities -> ack
    json.loads(f.readline())
    f.write(b'{"execute":"qmp_capabilities"}\n'); f.flush()
    json.loads(f.readline())
    f.write((cmd + "\n").encode()); f.flush()
    while True:
        line = f.readline()
        if not line:
            break
        resp = json.loads(line)
        if "return" in resp or "error" in resp:
            print(json.dumps(resp))
            break
    s.close()
except Exception as e:
    err("QMP communication failed: %s" % e)
    sys.exit(1)
PYEOF
}

# ── Commands ───────────────────────────────────────────────────────────────
qmp_status() {
    local st
    st=$(qmp_json '{"execute":"query-status"}') || return 1
    printf '%s' "$st" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'error' in d:
    print('ERROR:', d['error']); sys.exit(1)
r = d.get('return', {})
print('VM status:', r.get('status'))
" 2>/dev/null
    # Proxmox-style summary: CPUs, RAM, block devices
    local cpus mem block
    cpus=$(qmp_json '{"execute":"query-cpus-fast"}' 2>/dev/null | python3 -c "
import json, sys
try: print(len(json.load(sys.stdin).get('return', [])))
except: print('?')
" 2>/dev/null)
    mem=$(qmp_json '{"execute":"query-memory-size-summary"}' 2>/dev/null | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin).get('return', {})
    print('%.1f GB' % (r.get('base-memory', 0) / 1073741824))
except: print('?')
" 2>/dev/null)
    block=$(qmp_json '{"execute":"query-block"}' 2>/dev/null | python3 -c "
import json, sys
try:
    bs = json.load(sys.stdin).get('return', [])
    print(', '.join(b.get('device', '?') for b in bs))
except: print('?')
" 2>/dev/null)
    echo "vCPUs : $cpus"
    echo "RAM   : $mem (balloonable)"
    echo "Disks : $block"
}

qmp_info() { qmp_status; }

qmp_pause()   { qmp_json '{"execute":"stop"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('paused' if 'return' in d else 'ERROR: '+str(d.get('error')))" 2>/dev/null; }
qmp_resume()  { qmp_json '{"execute":"cont"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('resumed' if 'return' in d else 'ERROR: '+str(d.get('error')))" 2>/dev/null; }
qmp_powerdown(){ qmp_json '{"execute":"system_powerdown"}' >/dev/null 2>&1 && echo "powerdown sent"; }
qmp_reset()   { qmp_json '{"execute":"system_reset"}' >/dev/null 2>&1 && echo "reset sent"; }

qmp_screenshot() {  # $1 = output png path
    local out="${1:-$CACHE/vm-screenshot.png}"
    qmp_json "{\"execute\":\"screendump\",\"arguments\":{\"filename\":\"$out\"}}" >/dev/null 2>&1 \
        && echo "screenshot: $out" || err "screendump failed"
}

qmp_sendkey() {  # $1 = qcode (a, enter, f1, ctrl, alt-delete, ...)
    local key="${1:-enter}"
    qmp_json "{\"execute\":\"sendkey\",\"arguments\":{\"keys\":[{\"type\":\"qcode\",\"data\":\"$key\"}]}}" >/dev/null 2>&1 \
        && echo "key sent: $key" || err "sendkey failed"
}

qmp_hmp() {  # $1 = human monitor command, e.g. 'info block'
    qmp_json "{\"execute\":\"human-monitor-command\",\"arguments\":{\"command-line\":\"$1\"}}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'return' in d:
    print(d['return'], end='')
else:
    print('ERROR:', d.get('error'))
" 2>/dev/null
}

qmp_balloon() {  # $1 = MB
    local mb="${1:-4096}"
    qmp_json "{\"execute\":\"balloon\",\"arguments\":{\"value\":$mb}}" >/dev/null 2>&1 \
        && echo "balloon set to ${mb} MB" || err "balloon failed (virtio-balloon present?)"
}

qmp_net() {  # $1 = off|on
    local state="${1:-}"
    case "$state" in
        off) qmp_json '{"execute":"set_link","arguments":{"name":"n0","up":false}}' >/dev/null 2>&1 && echo "NIC disconnected" ;;
        on)  qmp_json '{"execute":"set_link","arguments":{"name":"n0","up":true}}' >/dev/null 2>&1 && echo "NIC connected" ;;
        *)   err "Usage: $0 net off|on" ;;
    esac
}

# ── Main (only when run standalone – dev-local.sh sources this file) ──────
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
case "${1:-}" in
    status|info) qmp_status ;;
    pause)       qmp_pause ;;
    resume)      qmp_resume ;;
    powerdown)   qmp_powerdown ;;
    reset)       qmp_reset ;;
    screenshot)  shift; qmp_screenshot "${1:-}" ;;
    sendkey)     shift; qmp_sendkey "${1:-}" ;;
    hmp)         shift; qmp_hmp "$*" ;;
    balloon)     shift; qmp_balloon "${1:-}" ;;
    net)         shift; qmp_net "${1:-}" ;;
    -h|--help)   sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) err "Usage: $0 {status|pause|resume|powerdown|reset|screenshot <png>|sendkey <qcode>|hmp <cmd>|balloon <mb>|net off|on}"; exit 1 ;;
esac
fi
