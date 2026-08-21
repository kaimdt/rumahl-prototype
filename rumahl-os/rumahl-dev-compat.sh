#!/usr/bin/env bash
# ============================================================================
# rumahl-dev-compat.sh – rumahl OS Compatibility Layer for Dev VM
# ============================================================================
# Stellt sicher, dass die Debian Dev-VM dieselben OS-Schnittstellen
# bereitstellt wie das echte rumahl OS / rumahl OS Dev:
#   - /etc/ora/        – OS-Konfiguration
#   - /usr/bin/rumahl-*   – System-Tools + Services (EXAKT wie rumahl OS)
#   - /opt/rumahl/        – Data directories (EXAKT wie rumahl OS)
#   - systemd-networkd  – Gleiche Netzwerk-Konfiguration
#   - Docker daemon     – Gleiche Docker-Konfiguration
#   - /mnt/data/ora/   – Datenpartition (emuliert via tmpfs)
#
# Usage: sudo ./rumahl-dev-compat.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[compat]${NC} $*"; }
success(){ echo -e "${GREEN}[compat]${NC} $*"; }
warn()   { echo -e "${YELLOW}[compat]${NC} $*"; }

# Service directory for systemd units
SVC_DIR="/etc/systemd/system"

# Enable a service (helper function - also in rumahl-dev-services.sh)
_enable() { 
    ln -sf "${SVC_DIR}/${1}.service" "${SVC_DIR}/multi-user.target.wants/${1}.service" 2>/dev/null || true
    ln -sf "${SVC_DIR}/${1}.service" "${SVC_DIR}/local-fs.target.wants/${1}.service" 2>/dev/null || true
}

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./rumahl-dev-compat.sh"
    exit 1
fi

log "Setting up rumahl OS compatibility layer..."

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Directory Structure – EXAKT wie rumahl OS
# ═══════════════════════════════════════════════════════════════════════════════
mkdir -p /etc/ora
mkdir -p /opt/rumahl/data
mkdir -p /opt/rumahl/docs
mkdir -p /opt/rumahl/build/dist
mkdir -p /mnt/data/ora /mnt/data/rauc /mnt/data/backups
mkdir -p /var/lib/ora
mkdir -p /usr/lib/ora
mkdir -p /tmp/rumahl-sandboxes
success "Directory structure: /etc/ora, /opt/rumahl, /mnt/data/ora"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Network Configuration – systemd-networkd (wie rumahl OS)
# ═══════════════════════════════════════════════════════════════════════════════
if command -v networkctl >/dev/null 2>&1; then
    mkdir -p /etc/systemd/network
    
    # Remove any existing network config that might interfere
    rm -f /etc/systemd/network/eth0.network /etc/systemd/network/10-rumahl-wired.network 2>/dev/null || true
    
    # rumahl OS default wired profile (DHCP + IPv6)
    cat > /etc/systemd/network/90-rumahl-wired-default.network <<'NETWORKEOF'
[Match]
Name=eth* en* eno* ens* enp* enx*
Type=ether

[Network]
DHCP=yes
IPv6AcceptRA=yes
LLMNR=no
MulticastDNS=no

[DHCPv4]
ClientIdentifier=mac
UseDNS=yes
UseNTP=yes
UseHostname=no
RouteMetric=100

[DHCPv6]
UseDNS=yes
UseNTP=yes
WithoutRA=solicit

[Link]
RequiredForOnline=degraded
NETWORKEOF

    # Shorten networkd-wait-online timeout (like rumahl OS does)
    mkdir -p /etc/systemd/system/systemd-networkd-wait-online.service.d
    cat > /etc/systemd/system/systemd-networkd-wait-online.service.d/10-ora.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/lib/systemd/systemd-networkd-wait-online --any --timeout=20
SuccessExitStatus=0 1
EOF

    systemctl enable systemd-networkd 2>/dev/null || true
    systemctl restart systemd-networkd 2>/dev/null || true
    success "systemd-networkd: rumahl OS DHCP profile active"
else
    warn "systemd-networkd not available – skipping network config"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. rumahl-netctl – Network Configurator (1:1 wie rumahl OS)
# ═══════════════════════════════════════════════════════════════════════════════
if [ ! -f /usr/bin/rumahl-netctl ]; then
    cat > /usr/bin/rumahl-netctl <<'NETCTLEOF'
#!/usr/bin/env python3
"""rumahl OS network configurator (Dev VM compatibility).

Writes /etc/systemd/network/20-ora.network atomically.
Safety: auto-rollback if new config fails within 30s.
Usage:
  rumahl-netctl status                          # show current config
  rumahl-netctl set --dhcp                      # DHCP for IPv4+IPv6
  rumahl-netctl set --static --ipv4 192.168.1.50/24 --gw4 192.168.1.1
  rumahl-netctl rollback                        # restore previous config
  rumahl-netctl set '{"mode":"dhcp","dns":["1.1.1.1"]}'  # JSON input
"""

import argparse, ipaddress, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time

NET_DIR     = pathlib.Path("/etc/systemd/network")
CUR_FILE    = NET_DIR / "20-ora.network"
BAK_FILE    = NET_DIR / "20-ora.network.bak"
DEFAULT_MATCH = "eth* en* eno* ens* enp* enx*"

def die(msg, rc=1):
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    sys.exit(rc)

def ok(payload=None):
    out = {"ok": True}
    if payload: out.update(payload)
    print(json.dumps(out))
    sys.exit(0)

def run(cmd, check=True, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception as e:
        if check: die(f"cmd failed: {' '.join(cmd)}: {e}")
        return None
    if check and r.returncode != 0:
        die(f"{' '.join(cmd)} exit {r.returncode}: {r.stderr.strip() or r.stdout.strip()}")
    return r

def cfg_to_ini(cfg):
    mode = cfg.get("mode", "dhcp").lower()
    valid = ("dhcp", "static", "dhcp-v4-only", "dhcp-v6-only", "hybrid")
    if mode not in valid: die(f"invalid mode {mode!r} — expected {valid}")

    lines = ["# Managed by rumahl-netctl", "[Match]", f"Name={cfg.get('match', DEFAULT_MATCH)}", "Type=ether", "", "[Network]"]
    dns = cfg.get("dns") or []

    has_v4 = bool(cfg.get("ipv4"))
    dhcp_v4 = mode in ("dhcp", "dhcp-v4-only", "hybrid") and not has_v4
    dhcp_v6 = mode in ("dhcp", "dhcp-v6-only", "hybrid") and not bool(cfg.get("ipv6"))

    if dhcp_v4 and dhcp_v6: lines.append("DHCP=yes")
    elif dhcp_v4: lines.append("DHCP=ipv4")
    elif dhcp_v6: lines.append("DHCP=ipv6")

    lines.append(f"IPv6AcceptRA={'yes' if cfg.get('accept_ra', True) else 'no'}")
    for s in dns: lines.append(f"DNS={s}")

    if cfg.get("ipv4"):
        v4 = str(ipaddress.ip_interface(cfg["ipv4"]))
        lines.append(f"Address={v4}")
        if cfg.get("gateway4"): lines.append(f"Gateway={ipaddress.ip_address(cfg['gateway4'])}")
    if cfg.get("ipv6"):
        lines.append(f"Address={str(ipaddress.ip_interface(cfg['ipv6']))}")
        if cfg.get("gateway6"): lines.append(f"Gateway={ipaddress.ip_address(cfg['gateway6'])}")

    if dhcp_v4: lines += ["", "[DHCPv4]", "ClientIdentifier=mac", "UseDNS=false" if dns else "UseDNS=true", "UseNTP=true", "RouteMetric=100"]
    if dhcp_v6: lines += ["", "[DHCPv6]", "UseDNS=false" if dns else "UseDNS=true", "UseNTP=true"]

    lines += ["", "[Link]", "RequiredForOnline=degraded", ""]
    return "\n".join(lines)

def write_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".rumahl-netctl.")
    try:
        os.write(fd, content.encode("utf-8"))
        os.fsync(fd)
    finally: os.close(fd)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)

def cmd_status():
    data = {"file": str(CUR_FILE), "exists": CUR_FILE.exists()}
    if CUR_FILE.exists(): data["content"] = CUR_FILE.read_text()
    r = run(["networkctl", "--no-pager", "--no-legend", "list"], check=False, timeout=5)
    if r and r.returncode == 0: data["networkctl"] = r.stdout
    ok(data)

def cmd_get():
    if not CUR_FILE.exists(): ok({"mode": "default", "file": None})
    ok({"file": str(CUR_FILE), "content": CUR_FILE.read_text()})

def cmd_set(cfg):
    ini = cfg_to_ini(cfg)
    if CUR_FILE.exists(): shutil.copy2(CUR_FILE, BAK_FILE)
    write_atomic(CUR_FILE, ini)
    run(["networkctl", "reload"], check=False)
    ok({"applied": True})

def cmd_rollback():
    if not BAK_FILE.exists(): die("no backup to roll back to")
    shutil.copy2(BAK_FILE, CUR_FILE)
    run(["networkctl", "reload"], check=False)
    ok({"rolled_back": True})

def main():
    if os.geteuid() != 0: die("must run as root", 77)
    ap = argparse.ArgumentParser(prog="rumahl-netctl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status"); sub.add_parser("get"); sub.add_parser("rollback")
    s = sub.add_parser("set")
    s.add_argument("json", nargs="?")
    s.add_argument("--dhcp", action="store_true")
    s.add_argument("--static", action="store_true")
    s.add_argument("--ipv4"); s.add_argument("--gw4")
    s.add_argument("--ipv6"); s.add_argument("--gw6")
    s.add_argument("--dns", nargs="*", default=[])
    s.add_argument("--match")
    args = ap.parse_args()

    if args.cmd == "status": cmd_status()
    elif args.cmd == "get": cmd_get()
    elif args.cmd == "rollback": cmd_rollback()
    elif args.cmd == "set":
        if args.json:
            cfg = json.loads(sys.stdin if args.json == "-" else args.json)
        else:
            flags = ["dhcp", "static", "dhcp-v4-only", "dhcp-v6-only", "hybrid"]
            mode = next((f for f in flags if getattr(args, f, False)), "dhcp")
            cfg = {"mode": mode}
            if args.ipv4: cfg["ipv4"] = args.ipv4
            if args.gw4: cfg["gateway4"] = args.gw4
            if args.ipv6: cfg["ipv6"] = args.ipv6
            if args.gw6: cfg["gateway6"] = args.gw6
            if args.dns: cfg["dns"] = args.dns
            if args.match: cfg["match"] = args.match
        cmd_set(cfg)

if __name__ == "__main__":
    main()
NETCTLEOF
    chmod 755 /usr/bin/rumahl-netctl
    success "rumahl-netctl installed (/usr/bin/rumahl-netctl)"
else
    success "rumahl-netctl already exists"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Docker daemon config – identisch zu rumahl OS
# ═══════════════════════════════════════════════════════════════════════════════
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DOCKEREOF'
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true,
  "userland-proxy": false,
  "ipv6": false,
  "exec-opts": ["native.cgroupdriver=systemd"],
  "icc": false
}
DOCKEREOF

# Restart Docker with new config if running
if systemctl is-active --quiet docker 2>/dev/null; then
    systemctl restart docker 2>/dev/null || true
fi
success "Docker daemon: rumahl OS config applied"

# ── Docker socket hardening (matches rumahl OS) ───────────────────────────────
mkdir -p /etc/systemd/system/docker.socket.d
cat > /etc/systemd/system/docker.socket.d/hardening.conf <<'EOF'
[Socket]
# Remove the default docker group ownership — only root may access the socket.
# rumahl-supervisor holds root and is the sole gateway to Docker for user apps.
SocketMode=0600
SocketUser=root
SocketGroup=root
EOF

# Make sure docker.service auto-restarts on crashes
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/override.conf <<'EOF'
[Service]
Restart=always
RestartSec=2
StartLimitBurst=5
StartLimitIntervalSec=30
LimitNOFILE=1048576
LimitNPROC=1048576
EOF

# Enable docker service and socket
systemctl daemon-reload 2>/dev/null || true
systemctl enable docker.service 2>/dev/null || true
systemctl enable docker.socket 2>/dev/null || true
success "Docker hardening: socket + service overrides applied"

# ═══════════════════════════════════════════════════════════════════════════════
# 4b. rumahl-dhcp-conflict-guard – DHCP Conflict Detection (rumahl OS feature)
# ═══════════════════════════════════════════════════════════════════════════════
log "Setting up DHCP conflict guard..."

cat > /usr/lib/ora/rumahl-dhcp-conflict-guard.sh <<'DHCPGUARDEOF'
#!/bin/sh
# rumahl OS DHCP Conflict Guard (Optimized with parallel checks)
#
# Validates that the IPv4 address on each physical interface is not
# conflicting with another host on the LAN. Uses arping for Duplicate
# Address Detection (DAD).

set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
LOG_TAG="rumahl-dhcp-conflict-guard"
RETRIES=2
TMP_DIR="/tmp/rumahl-dhcp-check-$$"

log() {
    logger -t "$LOG_TAG" "$*" 2>/dev/null || echo "$LOG_TAG: $*"
}

cleanup() {
    rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$TMP_DIR"

renew_iface() {
    iface="$1"
    networkctl renew "$iface" >/dev/null 2>&1 \
        || networkctl reconfigure "$iface" >/dev/null 2>&1 \
        || systemctl try-restart systemd-networkd.service >/dev/null 2>&1 \
        || true
}

# Check a single interface (for parallel execution)
check_iface() {
    iface="$1"
    result_file="$TMP_DIR/$iface.result"

    # Skip virtual / container interfaces
    case "$iface" in
        lo|docker*|br-*|veth*|vnet*|virbr*|tun*|tap*|bond*|sit*)
            echo "skip_virtual" > "$result_file"
            return ;;
    esac

    # Only physical interfaces have a "device" symlink.
    [ -d "/sys/class/net/$iface/device" ] || { echo "skip_notphysical" > "$result_file"; return; }

    ifindex=$(cat "/sys/class/net/$iface/ifindex" 2>/dev/null || echo "")
    [ -n "$ifindex" ] || { echo "skip_noindex" > "$result_file"; return; }

    # Get the current IPv4 address.
    addr_info=$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4}' | head -1)
    addr="${addr_info%%/*}"
    [ -n "$addr" ] || { echo "skip_noaddr" > "$result_file"; return; }

    # Skip Docker bridge range IPs
    case "$addr" in 172.17.*|172.18.*|172.19.*)
        log "Skipping $iface: $addr is in Docker bridge range"
        echo "skip_docker" > "$result_file"
        return ;;
    esac

    # Skip if no DHCP lease was assigned
    [ -f "/run/systemd/netif/leases/$ifindex" ] || { echo "skip_nolease" > "$result_file"; return; }

    # QEMU slirp user-net (the dev VM's default network mode) answers ARP
    # requests for guest IPs itself (gateway 10.0.2.2), so Duplicate Address
    # Detection always reports a FALSE conflict. The guard would then flush
    # the address and leave the VM without any network - exactly what
    # happened on dev-VM boots (daemon stuck at "Waiting for network").
    # DAD only makes sense on a real LAN (bridge mode / physical hardware).
    default_gw=$(ip route show default 2>/dev/null | awk '{print $3; exit}')
    case "$default_gw" in
        10.0.2.*)
            log "Skipping $iface: QEMU slirp user-net (gateway $default_gw) - DAD not applicable"
            echo "skip_slirp" > "$result_file"
            return ;;
    esac

    log "Checking $iface ($addr) for DHCP conflicts..."

    attempt=1
    while [ "$attempt" -le "$RETRIES" ]; do
        if arping -D -q -c 1 -w 2 -I "$iface" -S "$addr" "$addr" >/dev/null 2>&1; then
            log "$iface: no conflict detected for $addr"
            echo "ok" > "$result_file"
            return
        fi

        if ping -c 1 -W 1 "$addr" >/dev/null 2>&1; then
            self_mac=$(cat "/sys/class/net/$iface/address" 2>/dev/null || echo "")
            reply_mac=$(arping -c 1 -w 2 -I "$iface" "$addr" 2>/dev/null | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -1)
            if [ "$reply_mac" = "$self_mac" ] && [ -n "$self_mac" ]; then
                log "$iface: response is from ourselves ($self_mac) — no conflict"
                echo "ok_self" > "$result_file"
                return
            fi

            log "WARNING: Possible DHCP conflict on $iface ($addr) — attempt $attempt/$RETRIES"
            if [ "$attempt" -lt "$RETRIES" ]; then
                log "Requesting new lease..."
                ip addr flush dev "$iface" scope global >/dev/null 2>&1 || true
                renew_iface "$iface"
                sleep 3
                addr_info=$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4}' | head -1)
                addr="${addr_info%%/*}"
                [ -n "$addr" ] || { echo "conflict_nolease" > "$result_file"; return; }
            fi
        else
            log "$iface: no host responds to ping on $addr — no conflict"
            echo "ok_noping" > "$result_file"
            return
        fi
        attempt=$((attempt + 1))
    done

    final_addr=$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
    if [ -n "$final_addr" ]; then
        log "$iface: lease validated at $final_addr"
        echo "ok_validated" > "$result_file"
    else
        echo "conflict_failed" > "$result_file"
    fi
}

# Collect all interfaces
interfaces=""
for iface_path in /sys/class/net/*; do
    iface=$(basename "$iface_path")
    interfaces="$interfaces $iface"
done

# Run checks in parallel (background jobs)
for iface in $interfaces; do
    check_iface "$iface" &
done

# Wait for all checks to complete
wait

# Collect results
log "All interface checks completed"

exit 0
DHCPGUARDEOF
chmod 755 /usr/lib/ora/rumahl-dhcp-conflict-guard.sh

cat > "${SVC_DIR}/rumahl-dhcp-conflict-guard.service" <<'EOF'
[Unit]
Description=Validate DHCP lease and re-request on IPv4 conflict
After=systemd-networkd.service systemd-networkd-wait-online.service
Wants=systemd-networkd.service systemd-networkd-wait-online.service
ConditionPathExists=/usr/lib/ora/rumahl-dhcp-conflict-guard.sh

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-dhcp-conflict-guard.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
_enable rumahl-dhcp-conflict-guard
success "rumahl-dhcp-conflict-guard.service installed"

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Compatibility marker – rumahl-typische Pfade und Marker
# ═══════════════════════════════════════════════════════════════════════════════
echo "RUMAHL_OS_COMPAT=1" > /etc/ora/os-release
echo "RUMAHL_VERSION=dev-vm" >> /etc/ora/os-release
echo "RUMAHL_BUILD_ID=debian-compat-$(date +%Y%m%d)" >> /etc/ora/os-release

# Dev mode marker (like rumahl OS Dev)
touch /etc/ora/os-dev-mode

# Binary manifest (empty placeholder – dev services are built by cargo)
touch /etc/ora/binary-manifest.sha256
touch /etc/ora/allowed-images.txt
touch /mnt/data/ora/.setup-complete
success "rumahl OS markers: /etc/ora/os-release, os-dev-mode, manifest, setup-complete"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. rumahl-* Tool-Wrapper (falls Binaries nicht via cargo gebaut wurden)
# ═══════════════════════════════════════════════════════════════════════════════
for tool in rumahl-netctl; do
    if [ -f "/usr/bin/${tool}" ]; then
        chmod 755 "/usr/bin/${tool}"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# 7. Systemd-Journal auf max 100MB begrenzen (wie rumahl OS)
# ═══════════════════════════════════════════════════════════════════════════════
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/99-ora.conf <<'EOF'
[Journal]
SystemMaxUse=100M
RuntimeMaxUse=50M
MaxFileSec=7day
EOF
systemctl restart systemd-journald 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════════
# 8. Firewall & Security (matches rumahl OS)
# ═══════════════════════════════════════════════════════════════════════════════

log "Configuring firewall and security..."

# Install iptables if not present
if ! command -v iptables >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq iptables 2>/dev/null || true
fi

# Basic firewall rules (like rumahl OS)
cat > /usr/lib/ora/rumahl-firewall <<'FIREWALLEOF'
#!/bin/bash
# rumahl Firewall – Basic security rules
set -e

# Flush existing rules
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Allow rumahl service ports (localhost only)
iptables -A INPUT -p tcp --dport 3001 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 5432 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 8088:8126 -s 127.0.0.1 -j ACCEPT

# Allow DHCP (UDP 67/68) and DHCPv6 (UDP 546): the dev VM gets its address
# from the QEMU slirp DHCP server. Without these rules the firewall (INPUT
# DROP) kills the network on every boot/renewal (the interface comes up with
# no address and host forwards stay unreachable).
iptables -A INPUT -p udp --dport 67:68 -j ACCEPT
iptables -A INPUT -p udp --dport 546 -j ACCEPT

# Dev VM: host connections arrive via QEMU slirp with source 10.0.2.0/24
# (the host forwards all dev ports into the VM). Mirror the localhost rules
# for that subnet, otherwise every forwarded service is unreachable.
iptables -A INPUT -p tcp --dport 3001 -s 10.0.2.0/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 5432 -s 10.0.2.0/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -s 10.0.2.0/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 8088:8126 -s 10.0.2.0/24 -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports 8090:8098 -s 10.0.2.0/24 -j ACCEPT
# Dev VM frontend (Vite dev server) + extra forwarded dev ports - the host
# forwards them into the VM via QEMU slirp (source 10.0.2.0/24). Without
# these rules the firewall DROPs them and the ports stay unreachable from
# the host even though the services listen inside the guest.
iptables -A INPUT -p tcp --dport 5173 -s 10.0.2.0/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 5355 -s 10.0.2.0/24 -j ACCEPT

# Allow ICMP (ping)
iptables -A INPUT -p icmp -j ACCEPT

# Log dropped packets
iptables -A INPUT -j LOG --log-prefix "IPTABLES-DROP: " --log-level 4

exit 0
FIREWALLEOF
chmod 755 /usr/lib/ora/rumahl-firewall

# Firewall systemd service
cat > "${SVC_DIR}/rumahl-firewall.service" <<'EOF'
[Unit]
Description=rumahl Firewall
DefaultDependencies=no
After=local-fs.target
Before=network.target

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
_enable rumahl-firewall
success "Firewall: basic security rules configured"

# ═══════════════════════════════════════════════════════════════════════════════
# 9. Setup Wizard (matches rumahl OS first-boot)
# ═══════════════════════════════════════════════════════════════════════════════

log "Setting up first-boot wizard..."

cat > /usr/lib/ora/rumahl-setup-wizard <<'WIZARDEOF'
#!/bin/bash
# rumahl Setup Wizard – First-boot configuration
SETUP_FILE="/mnt/data/ora/.setup-complete"
WIZARD_RUN="/mnt/data/ora/.wizard-running"
LOG_TAG="rumahl-setup"

log() { logger -t "$LOG_TAG" "$*"; echo "[$(date -Iseconds)] $LOG_TAG: $*"; }

if [ -f "$SETUP_FILE" ]; then
    log "Setup already complete"
    exit 0
fi

if [ -f "$WIZARD_RUN" ]; then
    log "Setup wizard already running"
    exit 0
fi

touch "$WIZARD_RUN"
log "Starting first-boot setup wizard..."

# Wait for database
log "Waiting for database..."
for i in $(seq 1 30); do
    if pg_isready -q 2>/dev/null; then break; fi
    sleep 1
done

# Initialize databases
log "Initializing databases..."
su - postgres -c "createuser -s root 2>/dev/null || true" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE rumahl_home OWNER ora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE rumahl_core OWNER ora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE rumahl_security OWNER ora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE rumahl_secrets OWNER ora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE rumahl_appstore OWNER ora'" 2>/dev/null || true

# Wait for rumahl-core
log "Waiting for rumahl-core..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:8090/health >/dev/null 2>&1; then break; fi
    sleep 1
done

# Wait for rumahl-home
log "Waiting for rumahl-home..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:8126/health >/dev/null 2>&1; then break; fi
    sleep 1
done

# Create default admin user
log "Creating default admin user..."
curl -sf -X POST http://localhost:8126/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin1234","pin":"0000"}' 2>/dev/null || true

touch "$SETUP_FILE"
rm -f "$WIZARD_RUN"
log "First-boot setup complete!"
log "Default credentials: admin / admin1234 (PIN: 0000)"
log "Access dashboard: https://localhost"

exit 0
WIZARDEOF
chmod 755 /usr/lib/ora/rumahl-setup-wizard

cat > "${SVC_DIR}/rumahl-setup-wizard.service" <<'EOF'
[Unit]
Description=rumahl Setup Wizard (First Boot)
After=rumahl-db-init.service rumahl-home.service
Wants=rumahl-db-init.service rumahl-home.service
ConditionPathExists=!/mnt/data/ora/.setup-complete

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-setup-wizard
StandardOutput=journal
StandardError=journal
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
_enable rumahl-setup-wizard
success "Setup wizard: /usr/lib/ora/rumahl-setup-wizard"

# ═══════════════════════════════════════════════════════════════════════════════
# 10. Verify & Report
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
log "============================================"
log "rumahl OS Compatibility Layer – Verification"
log "============================================"

check() {
    local path="$1" desc="$2"
    if [ -e "$path" ]; then
        success "  [✓] $desc"
    else
        warn "  [✗] $desc (missing: $path)"
    fi
}

check "/etc/ora/os-release"          "/etc/ora/os-release"
check "/etc/ora/os-dev-mode"         "Dev mode marker"
check "/usr/bin/rumahl-netctl"           "rumahl-netctl tool"
check "/etc/docker/daemon.json"        "Docker daemon config"
check "/etc/systemd/network/90-rumahl-wired-default.network" "Network config"
check "/opt/rumahl/data"                 "/opt/rumahl/data (service data)"
check "/opt/rumahl/build/dist"           "/opt/rumahl/build/dist (frontend)"
check "/mnt/data/ora"                 "/mnt/data/ora (data partition)"
check "/mnt/data/ora/.setup-complete" "Setup-complete marker"
check "/etc/ora/binary-manifest.sha256" "Binary manifest"
check "/etc/ora/ssl/server.crt"       "SSL certificate"
check "/etc/ora/ssl/server.key"       "SSL private key"
check "/etc/nginx/sites-available/rumahl-gateway" "nginx gateway config"
check "/usr/lib/ora/rumahl-firewall"    "Firewall script"
check "/usr/lib/ora/rumahl-setup-wizard" "Setup wizard script"
check "/etc/logrotate.d/ora"          "Log rotation config"
check "/var/log/ora"                  "Log directory"
check "/var/lib/ora"                  "/var/lib/ora runtime dir"

echo ""
log "Dev VM now speaks rumahl OS interfaces:"
log "  Network:          rumahl-netctl status"
log "  Services:         systemctl status rumahl-*"
log "  Config:           /etc/ora/"
log "  SSL/TLS:          https://localhost"
log "  Reverse Proxy:    nginx (port 80/443)"
log "  Service Discovery: rumahl-core (port 8090)"
log "  Health Monitor:   systemctl status rumahl-health-check.timer"
log "  Firewall:         systemctl status rumahl-firewall"
log "  Logging:          journalctl -u rumahl-*"
log "  Setup Wizard:     /usr/lib/ora/rumahl-setup-wizard"
log "  Dev Mode:         /etc/ora/os-dev-mode"
log "  Same glibc, systemd, Docker setup as rumahl OS."
echo ""

# -- Self-healing fixes (idempotent) ----------------------------------------
# Install the self-heal script from the repo mirror (1:1 sync) and apply it:
#   - DHCP conflict guard: skip DAD under QEMU slirp (false conflicts used
#     to flush the only IP and leave the VM offline)
#   - SSH hardening: keys only (PasswordAuthentication no)
#   - Network watchdog timer: restores a lost lease automatically
log "Applying self-healing fixes (guard patch, SSH hardening, net watchdog)..."
SELFHEAL_SRC="/home/ora/ora/rumahl-os/rumahl-dev-selfheal.sh"
if [ -f "$SELFHEAL_SRC" ]; then
    cp "$SELFHEAL_SRC" /usr/lib/ora/rumahl-dev-selfheal.sh
    chmod 755 /usr/lib/ora/rumahl-dev-selfheal.sh
    /usr/lib/ora/rumahl-dev-selfheal.sh --apply || warn "self-heal reported an error (non-fatal)"
else
    warn "rumahl-dev-selfheal.sh not found in the mirror - skipping self-heal setup"
fi

success "Compatibility layer setup complete."
echo ""
log "Next steps:"
log "  1. Build services: cd rumahl-os/backend && cargo build --release"
log "  2. Deploy via devup.sh or dev-watch.ps1"
log "  3. Access dashboard: https://localhost"
log "  4. Default credentials: admin / admin1234 (PIN: 0000)"
log "  5. Services auto-register with rumahl-core"
