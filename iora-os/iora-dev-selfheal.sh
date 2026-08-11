#!/bin/bash
# ============================================================================
# iora-dev-selfheal.sh - idempotent self-healing fixes for the IORA Dev VM
# ============================================================================
# Applies known fixes inside the guest so the VM heals itself without manual
# intervention. Safe to run at any time (every step checks whether it is
# already applied). Two modes:
#
#   ./iora-dev-selfheal.sh --apply    one-time fixes (guard patch, SSH
#                                     hardening, network watchdog install)
#   ./iora-dev-selfheal.sh --net      network integrity check + repair
#                                     (no IPv4 on an UP interface -> renew)
#
# Called by:
#   - the dev-manager daemon when the VM comes up (guest_fixes_applied flag)
#   - iora-dev-compat.sh during provisioning
#   - the in-guest systemd timer iora-dev-net-check.timer (--net only)
# ============================================================================
set -u

LOG_TAG="iora-dev-selfheal"
log() { logger -t "$LOG_TAG" "$*" 2>/dev/null || echo "$LOG_TAG: $*"; }

MODE="${1:---apply}"

# -- build-deadlock autofix --------------------------------------------------
# All iora-* services run as `cargo run -p iora-X` and serialize on the cargo
# build lock. If the lock holder stalls (no rustc compiling), the whole stack
# waits forever - the VM boots but every service is "Blocking waiting for
# file lock". Kill the oldest waiter so the chain continues; systemd
# restarts it and it joins the queue again.
build_watchdog() {
    if [ "$(pgrep -c rustc 2>/dev/null || echo 0)" -ne 0 ]; then
        return 0 # a build is actively running - all good
    fi
    local waiters
    waiters=$(pgrep -f 'cargo run -p iora-' 2>/dev/null | sort -n | head -1)
    [ -n "$waiters" ] || return 0
    local count
    count=$(pgrep -fc 'cargo run -p iora-' 2>/dev/null || echo 0)
    [ "$count" -gt 3 ] || return 0
    local age
    age=$(ps -o etimes= -p "$waiters" 2>/dev/null | tr -d ' ')
    if [ -n "$age" ] && [ "$age" -gt 300 ]; then
        log "build lock stalled (no rustc, $count waiters) - killing stale cargo PID $waiters"
        kill -9 "$waiters" 2>/dev/null || true
    fi
}

# -- network integrity check + repair ---------------------------------------
# QEMU slirp user-net answers ARP for guest IPs, which made the IORA DHCP
# conflict guard flush the address (false positive). If an interface is UP
# but has no IPv4 address, renew the lease instead of leaving the VM offline.
net_check() {
    local repaired=0
    for iface in /sys/class/net/*; do
        name=$(basename "$iface")
        case "$name" in lo|docker*|br-*|veth*|vnet*|virbr*|tun*|tap*|bond*|sit*) continue ;; esac
        # Only physical interfaces have a "device" symlink.
        [ -d "$iface/device" ] || continue
        # Skip interfaces that are administratively down.
        grep -q 'state UP' "$iface/operstate" 2>/dev/null || continue
        if ! ip -4 addr show dev "$name" 2>/dev/null | grep -q ' inet '; then
            log "WARNING: $name is UP but has no IPv4 address - renewing lease"
            if command -v dhclient >/dev/null 2>&1; then
                dhclient -1 "$name" >/dev/null 2>&1 || true
            else
                networkctl reconfigure "$name" >/dev/null 2>&1 || true
            fi
            sleep 2
            if ip -4 addr show dev "$name" 2>/dev/null | grep -q ' inet '; then
                log "$name: lease restored"
            else
                log "ERROR: could not restore IPv4 on $name"
            fi
            repaired=1
        fi
    done
    if [ "$repaired" -eq 0 ]; then
        log "network OK - all physical interfaces have an IPv4 address"
    fi
}

# -- guard patch -------------------------------------------------------------
# The IORA DHCP conflict guard runs ARP-based Duplicate Address Detection.
# Under QEMU slirp the gateway (10.0.2.2) answers ARP for guest IPs, so DAD
# reports a false conflict and flushes the address - the VM loses its network
# ~1 minute after boot. Skip DAD when the default gateway is the slirp one.
patch_guard() {
    local guard=/usr/lib/iora/iora-dhcp-conflict-guard.sh
    [ -f "$guard" ] || { log "guard not installed - nothing to patch"; return 0; }
    grep -q 'skip_slirp' "$guard" && { log "guard already patched"; return 0; }
    log "patching $guard (skip DAD under QEMU slirp)"
    # Insert the slirp skip right before the "Checking ..." log line.
    sed -i '/log "Checking \$iface/ i\    # QEMU slirp user-net answers ARP for guest IPs - DAD would always\n    # report a false conflict and flush the address. Only meaningful on a\n    # real LAN (bridge mode / physical hardware).\n    default_gw=$(ip route show default 2>/dev/null | awk '"'"'{print $3; exit}'"'"')\n    case "$default_gw" in\n        10.0.2.*)\n            echo "skip_slirp" > "$result_file"\n            return ;;\n    esac\n' "$guard"
    if grep -q 'skip_slirp' "$guard"; then
        log "guard patched"
    else
        log "ERROR: guard patch could not be verified"
        return 1
    fi
}

# -- frontend ownership fix -------------------------------------------------
# npm install runs as root during provisioning, so node_modules belongs to
# root - but the Vite dev server runs as `iora` and needs write access to
# node_modules for its .vite dependency cache. Without it Vite fails with
# EACCES and the dashboard serves 504 "Outdated Optimize Dep" (white page).
fix_frontend_ownership() {
    local dir=/home/iora/iora/frontend/node_modules
    if [ -d "$dir" ] && [ "$(stat -c %U "$dir" 2>/dev/null)" != "iora" ]; then
        chown -R iora:iora "$dir" 2>/dev/null \
            && log "node_modules ownership fixed (iora)" \
            || log "ERROR: could not chown node_modules"
    else
        log "node_modules ownership OK"
    fi
}

# -- firewall dev-port fix ---------------------------------------------------
# The IORA firewall (INPUT policy DROP) only opens the known service ports.
# Host connections arrive via QEMU slirp with source 10.0.2.0/24 - the dev
# forwarded ports (Vite 5173 etc.) were missing, so they stayed unreachable
# from the host even though the guest services were listening.
fix_firewall_ports() {
    for port in 5173 5355; do
        if ! iptables -C INPUT -p tcp --dport "$port" -s 10.0.2.0/24 -j ACCEPT 2>/dev/null; then
            iptables -A INPUT -p tcp --dport "$port" -s 10.0.2.0/24 -j ACCEPT \
                && log "firewall: opened dev port $port" \
                || log "ERROR: could not open port $port"
        fi
    done
}

# -- SSH hardening -----------------------------------------------------------
# The dev VM is reachable via host-forwarded SSH (127.0.0.1:2222); keys are
# installed by cloud-init. Disable password auth so a leaked dev password
# cannot be used over SSH. Console (getty) root login stays available.
harden_ssh() {
    local cfg=/etc/ssh/sshd_config
    [ -f "$cfg" ] || { log "sshd_config not found - skipping SSH hardening"; return 0; }
    local changed=0
    for setting in \
        "PasswordAuthentication no" \
        "PermitRootLogin prohibit-password" \
        "KbdInteractiveAuthentication no" \
        "ChallengeResponseAuthentication no" \
        "UseDNS no"; do
        key="${setting%% *}"
        if grep -qE "^[# ]*${key} " "$cfg"; then
            if ! grep -qE "^${key} " "$cfg"; then
                sed -i "s/^[# ]*${key} .*/${setting}/" "$cfg"
                changed=1
            fi
        elif ! grep -qE "^${key} " "$cfg"; then
            printf '%s\n' "$setting" >> "$cfg"
            changed=1
        fi
    done
    if [ "$changed" -eq 1 ]; then
        log "sshd_config hardened"
        systemctl reload ssh 2>/dev/null || systemctl restart ssh 2>/dev/null || true
    else
        log "SSH already hardened"
    fi
}

# -- network watchdog (in-guest timer) ---------------------------------------
# Runs --net periodically so a lost lease is restored even when no host-side
# tool (dev-local / dev-manager) is watching.
install_net_watchdog() {
    local script=/usr/lib/iora/iora-dev-net-check.sh
    local timer=/etc/systemd/system/iora-dev-net-check.timer
    local unit=/etc/systemd/system/iora-dev-net-check.service
    local self
    self=$(readlink -f "$0" 2>/dev/null || echo "$0")
    if [ -f "$script" ] && grep -q 'iora-dev-selfheal' "$script"; then
        log "net watchdog already installed"
    else
        log "installing net watchdog"
        mkdir -p /usr/lib/iora
        cat > "$script" <<'NETCHECKEOF'
#!/bin/sh
# IORA Dev VM network integrity check (installed by iora-dev-selfheal.sh)
set -u
LOG_TAG="iora-dev-selfheal"
for iface in /sys/class/net/*; do
    name=$(basename "$iface")
    case "$name" in lo|docker*|br-*|veth*|vnet*|virbr*|tun*|tap*|bond*|sit*) continue ;; esac
    [ -d "$iface/device" ] || continue
    grep -q 'state UP' "$iface/operstate" 2>/dev/null || continue
    if ! ip -4 addr show dev "$name" 2>/dev/null | grep -q ' inet '; then
        logger -t "$LOG_TAG" "WARNING: $name is UP but has no IPv4 address - renewing lease"
        if command -v dhclient >/dev/null 2>&1; then
            dhclient -1 "$name" >/dev/null 2>&1 || true
        else
            networkctl reconfigure "$name" >/dev/null 2>&1 || true
        fi
        sleep 2
        if ip -4 addr show dev "$name" 2>/dev/null | grep -q ' inet '; then
            logger -t "$LOG_TAG" "$name: lease restored"
        else
            logger -t "$LOG_TAG" "ERROR: could not restore IPv4 on $name"
        fi
    fi
done
NETCHECKEOF
        chmod 755 "$script"
        cat > "$unit" <<'UNITEOF'
[Unit]
Description=IORA Dev VM network integrity check
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-dev-net-check.sh
UNITEOF
        cat > "$timer" <<'TIMEREOF'
[Unit]
Description=IORA Dev VM network integrity timer
[Timer]
OnBootSec=60
OnUnitActiveSec=30
AccuracySec=5
[Install]
WantedBy=timers.target
TIMEREOF
        systemctl daemon-reload 2>/dev/null || true
        systemctl enable --now iora-dev-net-check.timer 2>/dev/null || true
        log "net watchdog installed and enabled"
    fi
}

# -- GStreamer runtime for iora-browserd (WebRTC) --------------------------
# The ORA Browser renders via WebRTC (webrtcbin in plugins-bad, vp8enc in
# plugins-good, jpegdec in plugins-base). Missing packages silently disable
# WebRTC and leave only the canvas fallback - install them idempotently.
# The -dev packages are required so cargo can build gstreamer-rs.
gstreamer_check() {
    if pkg-config --exists gstreamer-1.0 gstreamer-webrtc-1.0 2>/dev/null; then
        return 0
    fi
    log "installing GStreamer packages for iora-browserd WebRTC…"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq 2>/dev/null || true
    apt-get install -y -qq --no-install-recommends \
        libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
        gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
        gstreamer1.0-plugins-bad gstreamer1.0-tools 2>&1 | tail -2 || true
    if pkg-config --exists gstreamer-1.0 gstreamer-webrtc-1.0 2>/dev/null; then
        log "GStreamer ready"
    else
        log "GStreamer install failed (check network/apt)"
    fi
}

case "$MODE" in
    --net)
        net_check
        ;;
    --build)
        build_watchdog
        ;;
    --apply)
        patch_guard
        fix_frontend_ownership
        fix_firewall_ports
        harden_ssh
        install_net_watchdog
        gstreamer_check
        log "self-heal --apply finished"
        ;;
    *)
        echo "usage: $0 [--apply|--net]" >&2
        exit 2
        ;;
esac
exit 0
