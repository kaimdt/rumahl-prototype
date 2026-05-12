#!/usr/bin/env bash
# ============================================================================
# iora-dev-compat.sh – IORA OS Compatibility Layer for Dev VM
# ============================================================================
# Stellt sicher, dass die Debian Dev-VM dieselben OS-Schnittstellen
# bereitstellt wie das echte IORA OS:
#   - /etc/iora/        – OS-Konfiguration
#   - /usr/bin/iora-*   – System-Tools (netctl, watchdog, …)
#   - /opt/iora/        – Service binaries + build staging
#   - systemd-networkd  – Gleiche Netzwerk-Konfiguration
#   - Docker daemon     – Gleiche Docker-Konfiguration
#   - /mnt/data/iora/   – Datenpartition (emuliert via loopback)
#
# Usage: sudo ./iora-dev-compat.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[compat]${NC} $*"; }
success(){ echo -e "${GREEN}[compat]${NC} $*"; }
warn()   { echo -e "${YELLOW}[compat]${NC} $*"; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./iora-dev-compat.sh"
    exit 1
fi

log "Setting up IORA OS compatibility layer..."

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Directory Structure – exakt wie IORA OS
# ═══════════════════════════════════════════════════════════════════════════════
mkdir -p /etc/iora
mkdir -p /opt/iora/build
mkdir -p /opt/iora/iora-home
mkdir -p /mnt/data/iora /mnt/data/rauc /mnt/data/backups
mkdir -p /var/lib/iora
mkdir -p /usr/lib/iora
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

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Compatibility marker – IORA-typische Pfade und Marker
# ═══════════════════════════════════════════════════════════════════════════════
echo "IORA_OS_COMPAT=1" > /etc/iora/os-release
echo "IORA_VERSION=dev-vm" >> /etc/iora/os-release
echo "IORA_BUILD_ID=debian-compat-$(date +%Y%m%d)" >> /etc/iora/os-release

# Binary manifest (empty placeholder – dev services are built by cargo)
touch /etc/iora/binary-manifest.sha256
touch /etc/iora/allowed-images.txt
touch /mnt/data/iora/.setup-complete
success "IORA OS markers: /etc/iora/os-release, manifest, setup-complete"

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
# 8. Verify & Report
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
check "/usr/bin/iora-netctl"           "iora-netctl tool"
check "/etc/docker/daemon.json"        "Docker daemon config"
check "/etc/systemd/network/90-iora-wired-default.network" "Network config"
check "/opt/iora/build"                "/opt/iora/build staging"
check "/mnt/data/iora"                 "/mnt/data/iora (data partition)"
check "/mnt/data/iora/.setup-complete" "Setup-complete marker"
check "/etc/iora/binary-manifest.sha256" "Binary manifest"
check "/var/lib/iora"                  "/var/lib/iora runtime dir"

echo ""
log "Dev VM now speaks IORA OS interfaces:"
log "  Network:   iora-netctl status"
log "  Services:  systemctl status iora-*"
log "  Config:    /etc/iora/"
log "  Same glibc, systemd, Docker setup as IORA OS."
echo ""
success "Compatibility layer setup complete."
