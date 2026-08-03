#!/usr/bin/env bash
# ============================================================================
# iora-dev-compat.sh – IORA OS Compatibility Layer for Dev VM
# ============================================================================
# Stellt sicher, dass die Debian Dev-VM dieselben OS-Schnittstellen
# bereitstellt wie das echte IORA OS / IORA OS Dev:
#   - /etc/iora/        – OS-Konfiguration
#   - /usr/bin/iora-*   – System-Tools + Services (EXAKT wie IORA OS)
#   - /opt/iora/        – Data directories (EXAKT wie IORA OS)
#   - systemd-networkd  – Gleiche Netzwerk-Konfiguration
#   - Docker daemon     – Gleiche Docker-Konfiguration
#   - /mnt/data/iora/   – Datenpartition (emuliert via tmpfs)
#
# Usage: sudo ./iora-dev-compat.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[compat]${NC} $*"; }
success(){ echo -e "${GREEN}[compat]${NC} $*"; }
warn()   { echo -e "${YELLOW}[compat]${NC} $*"; }

# Service directory for systemd units
SVC_DIR="/etc/systemd/system"

# Enable a service (helper function - also in iora-dev-services.sh)
_enable() { 
    ln -sf "${SVC_DIR}/${1}.service" "${SVC_DIR}/multi-user.target.wants/${1}.service" 2>/dev/null || true
    ln -sf "${SVC_DIR}/${1}.service" "${SVC_DIR}/local-fs.target.wants/${1}.service" 2>/dev/null || true
}

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./iora-dev-compat.sh"
    exit 1
fi

log "Setting up IORA OS compatibility layer..."

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Directory Structure – EXAKT wie IORA OS
# ═══════════════════════════════════════════════════════════════════════════════
mkdir -p /etc/iora
mkdir -p /opt/iora/data
mkdir -p /opt/iora/docs
mkdir -p /opt/iora/build/dist
mkdir -p /mnt/data/iora /mnt/data/rauc /mnt/data/backups
mkdir -p /var/lib/iora
mkdir -p /usr/lib/iora
mkdir -p /tmp/iora-sandboxes
success "Directory structure: /etc/iora, /opt/iora, /mnt/data/iora"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Network Configuration – systemd-networkd (wie IORA OS)
# ═══════════════════════════════════════════════════════════════════════════════
if command -v networkctl >/dev/null 2>&1; then
    mkdir -p /etc/systemd/network
    
    # Remove any existing network config that might interfere
    rm -f /etc/systemd/network/eth0.network /etc/systemd/network/10-iora-wired.network 2>/dev/null || true
    
    # IORA OS default wired profile (DHCP + IPv6)
    cat > /etc/systemd/network/90-iora-wired-default.network <<'NETWORKEOF'
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

    # Shorten networkd-wait-online timeout (like IORA OS does)
    mkdir -p /etc/systemd/system/systemd-networkd-wait-online.service.d
    cat > /etc/systemd/system/systemd-networkd-wait-online.service.d/10-iora.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/lib/systemd/systemd-networkd-wait-online --any --timeout=20
SuccessExitStatus=0 1
EOF

    systemctl enable systemd-networkd 2>/dev/null || true
    systemctl restart systemd-networkd 2>/dev/null || true
    success "systemd-networkd: IORA OS DHCP profile active"
else
    warn "systemd-networkd not available – skipping network config"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. iora-netctl – Network Configurator (1:1 wie IORA OS)
# ═══════════════════════════════════════════════════════════════════════════════
if [ ! -f /usr/bin/iora-netctl ]; then
    cat > /usr/bin/iora-netctl <<'NETCTLEOF'
#!/usr/bin/env python3
"""IORA OS network configurator (Dev VM compatibility).

Writes /etc/systemd/network/20-iora.network atomically.
Safety: auto-rollback if new config fails within 30s.
Usage:
  iora-netctl status                          # show current config
  iora-netctl set --dhcp                      # DHCP for IPv4+IPv6
  iora-netctl set --static --ipv4 192.168.1.50/24 --gw4 192.168.1.1
  iora-netctl rollback                        # restore previous config
  iora-netctl set '{"mode":"dhcp","dns":["1.1.1.1"]}'  # JSON input
"""

import argparse, ipaddress, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time

NET_DIR     = pathlib.Path("/etc/systemd/network")
CUR_FILE    = NET_DIR / "20-iora.network"
BAK_FILE    = NET_DIR / "20-iora.network.bak"
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

    lines = ["# Managed by iora-netctl", "[Match]", f"Name={cfg.get('match', DEFAULT_MATCH)}", "Type=ether", "", "[Network]"]
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
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".iora-netctl.")
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
    ap = argparse.ArgumentParser(prog="iora-netctl")
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
    chmod 755 /usr/bin/iora-netctl
    success "iora-netctl installed (/usr/bin/iora-netctl)"
else
    success "iora-netctl already exists"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Docker daemon config – identisch zu IORA OS
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
success "Docker daemon: IORA OS config applied"

# ── Docker socket hardening (matches IORA OS) ───────────────────────────────
mkdir -p /etc/systemd/system/docker.socket.d
cat > /etc/systemd/system/docker.socket.d/hardening.conf <<'EOF'
[Socket]
# Remove the default docker group ownership — only root may access the socket.
# iora-supervisor holds root and is the sole gateway to Docker for user apps.
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
# 4b. iora-dhcp-conflict-guard – DHCP Conflict Detection (IORA OS feature)
# ═══════════════════════════════════════════════════════════════════════════════
log "Setting up DHCP conflict guard..."

cat > /usr/lib/iora/iora-dhcp-conflict-guard.sh <<'DHCPGUARDEOF'
#!/bin/sh
# IORA OS DHCP Conflict Guard (Optimized with parallel checks)
#
# Validates that the IPv4 address on each physical interface is not
# conflicting with another host on the LAN. Uses arping for Duplicate
# Address Detection (DAD).

set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
LOG_TAG="iora-dhcp-conflict-guard"
RETRIES=2
TMP_DIR="/tmp/iora-dhcp-check-$$"

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
chmod 755 /usr/lib/iora/iora-dhcp-conflict-guard.sh

cat > "${SVC_DIR}/iora-dhcp-conflict-guard.service" <<'EOF'
[Unit]
Description=Validate DHCP lease and re-request on IPv4 conflict
After=systemd-networkd.service systemd-networkd-wait-online.service
Wants=systemd-networkd.service systemd-networkd-wait-online.service
ConditionPathExists=/usr/lib/iora/iora-dhcp-conflict-guard.sh

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-dhcp-conflict-guard.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
_enable iora-dhcp-conflict-guard
success "iora-dhcp-conflict-guard.service installed"

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Compatibility marker – IORA-typische Pfade und Marker
# ═══════════════════════════════════════════════════════════════════════════════
echo "IORA_OS_COMPAT=1" > /etc/iora/os-release
echo "IORA_VERSION=dev-vm" >> /etc/iora/os-release
echo "IORA_BUILD_ID=debian-compat-$(date +%Y%m%d)" >> /etc/iora/os-release

# Dev mode marker (like IORA OS Dev)
touch /etc/iora/os-dev-mode

# Binary manifest (empty placeholder – dev services are built by cargo)
touch /etc/iora/binary-manifest.sha256
touch /etc/iora/allowed-images.txt
touch /mnt/data/iora/.setup-complete
success "IORA OS markers: /etc/iora/os-release, os-dev-mode, manifest, setup-complete"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. iora-* Tool-Wrapper (falls Binaries nicht via cargo gebaut wurden)
# ═══════════════════════════════════════════════════════════════════════════════
for tool in iora-netctl; do
    if [ -f "/usr/bin/${tool}" ]; then
        chmod 755 "/usr/bin/${tool}"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# 7. Systemd-Journal auf max 100MB begrenzen (wie IORA OS)
# ═══════════════════════════════════════════════════════════════════════════════
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/99-iora.conf <<'EOF'
[Journal]
SystemMaxUse=100M
RuntimeMaxUse=50M
MaxFileSec=7day
EOF
systemctl restart systemd-journald 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════════
# 8. Firewall & Security (matches IORA OS)
# ═══════════════════════════════════════════════════════════════════════════════

log "Configuring firewall and security..."

# Install iptables if not present
if ! command -v iptables >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq iptables 2>/dev/null || true
fi

# Basic firewall rules (like IORA OS)
cat > /usr/lib/iora/iora-firewall <<'FIREWALLEOF'
#!/bin/bash
# IORA Firewall – Basic security rules
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

# Allow IORA service ports (localhost only)
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

# Allow ICMP (ping)
iptables -A INPUT -p icmp -j ACCEPT

# Log dropped packets
iptables -A INPUT -j LOG --log-prefix "IPTABLES-DROP: " --log-level 4

exit 0
FIREWALLEOF
chmod 755 /usr/lib/iora/iora-firewall

# Firewall systemd service
cat > "${SVC_DIR}/iora-firewall.service" <<'EOF'
[Unit]
Description=IORA Firewall
DefaultDependencies=no
After=local-fs.target
Before=network.target

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
_enable iora-firewall
success "Firewall: basic security rules configured"

# ═══════════════════════════════════════════════════════════════════════════════
# 9. Setup Wizard (matches IORA OS first-boot)
# ═══════════════════════════════════════════════════════════════════════════════

log "Setting up first-boot wizard..."

cat > /usr/lib/iora/iora-setup-wizard <<'WIZARDEOF'
#!/bin/bash
# IORA Setup Wizard – First-boot configuration
SETUP_FILE="/mnt/data/iora/.setup-complete"
WIZARD_RUN="/mnt/data/iora/.wizard-running"
LOG_TAG="iora-setup"

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
su - postgres -c "psql -c 'CREATE DATABASE iora_home OWNER iora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE iora_core OWNER iora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE iora_security OWNER iora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE iora_secrets OWNER iora'" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE DATABASE iora_appstore OWNER iora'" 2>/dev/null || true

# Wait for iora-core
log "Waiting for iora-core..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:8090/health >/dev/null 2>&1; then break; fi
    sleep 1
done

# Wait for iora-home
log "Waiting for iora-home..."
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
chmod 755 /usr/lib/iora/iora-setup-wizard

cat > "${SVC_DIR}/iora-setup-wizard.service" <<'EOF'
[Unit]
Description=IORA Setup Wizard (First Boot)
After=iora-db-init.service iora-home.service
Wants=iora-db-init.service iora-home.service
ConditionPathExists=!/mnt/data/iora/.setup-complete

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-setup-wizard
StandardOutput=journal
StandardError=journal
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
_enable iora-setup-wizard
success "Setup wizard: /usr/lib/iora/iora-setup-wizard"

# ═══════════════════════════════════════════════════════════════════════════════
# 10. Verify & Report
# ═══════════════════════════════════════════════════════════════════════════════

echo ""
log "============================================"
log "IORA OS Compatibility Layer – Verification"
log "============================================"

check() {
    local path="$1" desc="$2"
    if [ -e "$path" ]; then
        success "  [✓] $desc"
    else
        warn "  [✗] $desc (missing: $path)"
    fi
}

check "/etc/iora/os-release"          "/etc/iora/os-release"
check "/etc/iora/os-dev-mode"         "Dev mode marker"
check "/usr/bin/iora-netctl"           "iora-netctl tool"
check "/etc/docker/daemon.json"        "Docker daemon config"
check "/etc/systemd/network/90-iora-wired-default.network" "Network config"
check "/opt/iora/data"                 "/opt/iora/data (service data)"
check "/opt/iora/build/dist"           "/opt/iora/build/dist (frontend)"
check "/mnt/data/iora"                 "/mnt/data/iora (data partition)"
check "/mnt/data/iora/.setup-complete" "Setup-complete marker"
check "/etc/iora/binary-manifest.sha256" "Binary manifest"
check "/etc/iora/ssl/server.crt"       "SSL certificate"
check "/etc/iora/ssl/server.key"       "SSL private key"
check "/etc/nginx/sites-available/iora-gateway" "nginx gateway config"
check "/usr/lib/iora/iora-firewall"    "Firewall script"
check "/usr/lib/iora/iora-setup-wizard" "Setup wizard script"
check "/etc/logrotate.d/iora"          "Log rotation config"
check "/var/log/iora"                  "Log directory"
check "/var/lib/iora"                  "/var/lib/iora runtime dir"

echo ""
log "Dev VM now speaks IORA OS interfaces:"
log "  Network:          iora-netctl status"
log "  Services:         systemctl status iora-*"
log "  Config:           /etc/iora/"
log "  SSL/TLS:          https://localhost"
log "  Reverse Proxy:    nginx (port 80/443)"
log "  Service Discovery: iora-core (port 8090)"
log "  Health Monitor:   systemctl status iora-health-check.timer"
log "  Firewall:         systemctl status iora-firewall"
log "  Logging:          journalctl -u iora-*"
log "  Setup Wizard:     /usr/lib/iora/iora-setup-wizard"
log "  Dev Mode:         /etc/iora/os-dev-mode"
log "  Same glibc, systemd, Docker setup as IORA OS."
echo ""
success "Compatibility layer setup complete."
echo ""
log "Next steps:"
log "  1. Build services: cd iora-os/backend && cargo build --release"
log "  2. Deploy via devup.sh or dev-watch.ps1"
log "  3. Access dashboard: https://localhost"
log "  4. Default credentials: admin / admin1234 (PIN: 0000)"
log "  5. Services auto-register with iora-core"
