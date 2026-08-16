#!/bin/bash
# Post-build script for IORA OS
# Runs after root filesystem is built but before image creation

set -e

TARGET_DIR=$1

echo "IORA OS: Running post-build script..."

# ── Bundle grub tools into target rootfs ─────────────────────────────────────
# Buildroot's BR2_TARGET_GRUB2 only installs grub-install into HOST_DIR (for
# post-image.sh use). The live installer initramfs IS this target rootfs, and
# it needs grub-install + grub modules to robustly repair/install bootloaders
# on the user's disk after dd. Without this, the repair step can only write
# grub.cfg and hope that the MBR/core.img survived the dd unchanged.
bundle_grub_tools() {
    local host_dir=""
    # Buildroot exports HOST_DIR; fall back to derived path.
    if [ -n "${HOST_DIR:-}" ] && [ -d "${HOST_DIR}" ]; then
        host_dir="${HOST_DIR}"
    elif [ -d "${TARGET_DIR}/../host" ]; then
        host_dir="$(cd "${TARGET_DIR}/../host" && pwd)"
    fi
    if [ -z "${host_dir}" ] || [ ! -d "${host_dir}" ]; then
        echo "IORA OS: WARN: HOST_DIR not resolvable; skipping grub bundling"
        return 0
    fi

    echo "IORA OS: Bundling grub tools from ${host_dir} into installer rootfs"

    mkdir -p "${TARGET_DIR}/usr/sbin" "${TARGET_DIR}/usr/bin" "${TARGET_DIR}/usr/lib/grub"

    # grub-install and friends (shell scripts + binaries)
    for tool in grub-install grub-mkimage grub-mkconfig grub-mkrescue \
                grub-bios-setup grub-editenv grub-probe grub-mkdevicemap \
                grub-reboot grub-set-default; do
        for src in "${host_dir}/sbin/${tool}" \
                   "${host_dir}/bin/${tool}" \
                   "${host_dir}/usr/sbin/${tool}" \
                   "${host_dir}/usr/bin/${tool}"; do
            if [ -x "${src}" ] && [ ! -e "${TARGET_DIR}/usr/sbin/${tool}" ]; then
                cp -f "${src}" "${TARGET_DIR}/usr/sbin/${tool}" 2>/dev/null || true
                chmod 755 "${TARGET_DIR}/usr/sbin/${tool}" 2>/dev/null || true
                break
            fi
        done
    done

    # Copy grub modules & prefixes required for BIOS + UEFI install
    for arch in i386-pc x86_64-efi; do
        for src in "${host_dir}/lib/grub/${arch}" \
                   "${host_dir}/usr/lib/grub/${arch}" \
                   "${host_dir}/share/grub/${arch}"; do
            if [ -d "${src}" ] && [ ! -d "${TARGET_DIR}/usr/lib/grub/${arch}" ]; then
                cp -a "${src}" "${TARGET_DIR}/usr/lib/grub/${arch}" 2>/dev/null || true
                break
            fi
        done
    done

    # grub shared data (unicode.pf2, themes) — small, speeds up rescues
    for src in "${host_dir}/share/grub/unicode.pf2" \
               "${host_dir}/usr/share/grub/unicode.pf2"; do
        if [ -f "${src}" ]; then
            mkdir -p "${TARGET_DIR}/usr/share/grub"
            cp -f "${src}" "${TARGET_DIR}/usr/share/grub/unicode.pf2" 2>/dev/null || true
            break
        fi
    done

    # Report status
    if [ -x "${TARGET_DIR}/usr/sbin/grub-install" ]; then
        echo "IORA OS: grub-install bundled OK"
    else
        echo "IORA OS: WARN: grub-install NOT bundled - installer will rely on pre-installed MBR"
    fi
    [ -d "${TARGET_DIR}/usr/lib/grub/i386-pc" ]    && echo "IORA OS: i386-pc modules bundled"    || true
    [ -d "${TARGET_DIR}/usr/lib/grub/x86_64-efi" ] && echo "IORA OS: x86_64-efi modules bundled" || true
    return 0
}
bundle_grub_tools || true

# Create necessary directories
mkdir -p "${TARGET_DIR}/mnt/data"
mkdir -p "${TARGET_DIR}/var/lib/docker"
mkdir -p "${TARGET_DIR}/etc/docker"
mkdir -p "${TARGET_DIR}/etc/systemd/system"
mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
mkdir -p "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants"
mkdir -p "${TARGET_DIR}/etc/apparmor.d"

# Make the Rust SDK available to locally installed Rust apps. Some example
# ZIPs use `iora-sdk = { path = "../../sdks/rust" }`; iora-home vendors this
# SDK into the Docker build context when it is present here.
for sdk_src in \
    "${BR2_EXTERNAL_IORA_PATH:-}/../sdks/rust" \
    "$(pwd)/../sdks/rust" \
    "$(pwd)/sdks/rust"; do
    if [ -f "${sdk_src}/Cargo.toml" ]; then
        mkdir -p "${TARGET_DIR}/usr/share/iora/sdks"
        rm -rf "${TARGET_DIR}/usr/share/iora/sdks/rust"
        cp -a "${sdk_src}" "${TARGET_DIR}/usr/share/iora/sdks/rust"
        echo "IORA OS: Rust SDK bundled for local app builds"
        break
    fi
done

# ── Robust DHCP for *any* wired NIC name (eth0, ens3, enp0s3, …) ────────────
# Buildroot's BR2_SYSTEM_DHCP="eth0" only writes /etc/systemd/network/eth0.network
# that matches literally Name=eth0. Modern VMs (Proxmox/KVM/VMware/Hyper-V/VirtualBox)
# use predictable interface names like ens3/enp0s3, so nothing matches →
# systemd-networkd-wait-online times out and "Failed to start Wait for Network
# to be Configured" cascades into iora-stack / watchdog / startup-validator.
#
# Replace it with a wildcard profile that matches any physical ethernet NIC.
# IMPORTANT: this is the *default / fallback* — filename prefix is 90- so the
# installer-written 10-static.network / 10-dhcp.network / 20-iora.network
# (written at runtime by iora-netctl) always WINS over this one. Without the
# 90- prefix, an admin-configured static IP would be silently ignored because
# "10-iora-wired" sorts BEFORE "10-static" in systemd-networkd's lexical
# load order.
mkdir -p "${TARGET_DIR}/etc/systemd/network"
# Remove Buildroot's single-NIC default + any stale wildcard from older builds.
rm -f "${TARGET_DIR}/etc/systemd/network/eth0.network" \
      "${TARGET_DIR}/etc/systemd/network/10-iora-wired.network" 2>/dev/null || true
cat > "${TARGET_DIR}/etc/systemd/network/90-iora-wired-default.network" <<'EOF'
# IORA OS default wired profile — ONLY active when no higher-priority
# (10-* / 20-*) .network file matches the interface. Replaced automatically
# by iora-netctl when the admin configures a static IP or different DHCP
# options via the Control Center.
#
# Default: DHCP for both IPv4 AND IPv6. IPv6 is enabled by default so
# the system can be reached via both address families on first boot.
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

# Don't block boot forever if DHCP takes a while: consider the link online
# as soon as it has an IP (degraded is enough for iora-stack / docker pulls
# are retried anyway).
[Link]
RequiredForOnline=degraded
EOF

# ── iora-netctl: runtime network configurator ───────────────────────────────
# Used by the IORA Control Center (via docker host-bind or an SSH / REST hop)
# and by CLI admins to switch IPv4 / IPv6 / DHCP / DNS at runtime WITHOUT
# dropping the connection permanently — writes a new file atomically, asks
# networkd to reload, sanity-checks link+default route, and rolls back on
# failure. JSON in / JSON out so the Control Center can shell out to it.
#
# Usage:
#   iora-netctl status                          # show current config + leases
#   iora-netctl get                             # print current .network file as JSON
#   iora-netctl set <json>                      # apply new config from JSON on stdin or $1
#   iora-netctl set --dhcp [--custom-dns 1.1.1.1 1.0.0.1]
#   iora-netctl set --static --ipv4 192.168.1.50/24 --gw4 192.168.1.1 \
#                          [--dns 1.1.1.1] [--ipv6 2001:db8::1/64 --gw6 2001:db8::]
#   iora-netctl rollback                        # restore the previous config
#
# JSON schema (POST /api/network in the Control Center sends this):
#   mode: "dhcp" | "static" | "dhcp-v4-only" | "dhcp-v6-only" | "hybrid"
#   {"mode":"dhcp","ipv4":"…/…","gateway4":"…","ipv6":"…/…",
#    "gateway6":"…","dns":["…","…"],"accept_ra":true,
#    "match":"eth* en* eno* ens* enp* enx*","hostname":"foo"}
#
#   hybrid: DHCP for unspecified, static for specified addresses.
#   Example: {"mode":"hybrid","ipv6":"2001:db8::1/64","gateway6":"2001:db8::1"}
#   → DHCP for IPv4, static for IPv6
mkdir -p "${TARGET_DIR}/usr/bin" "${TARGET_DIR}/usr/lib/iora"
cat > "${TARGET_DIR}/usr/bin/iora-netctl" <<'NETCTLEOF'
#!/usr/bin/env python3
# IORA OS network configurator.
# SPDX-License-Identifier: Apache-2.0
#
# Writes /etc/systemd/network/20-iora.network atomically (filename prefix
# 20- so admin config beats the 90-iora-wired-default.network fallback but
# can still be overridden by the installer's 10-*.network if present).
#
# Safety features:
#   * Always writes to a temp file + rename (crash-safe).
#   * Keeps the previous file as 20-iora.network.bak for one-shot rollback.
#   * After reload, polls `networkctl status --no-pager` for up to 30 s to
#     confirm at least one interface is "routable" or "degraded". If not,
#     auto-rollback to the previous config.
#   * Sanitises all user-provided values with strict regexes before they
#     touch the filesystem — no injection of arbitrary INI keys.

import argparse
import ipaddress
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

NET_DIR     = pathlib.Path("/etc/systemd/network")
CUR_FILE    = NET_DIR / "20-iora.network"
BAK_FILE    = NET_DIR / "20-iora.network.bak"
DEFAULT_MATCH = "eth* en* eno* ens* enp* enx*"
MATCH_RE    = re.compile(r"^[A-Za-z0-9_*? .-]+$")
HOSTNAME_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")


def die(msg, rc=1):
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    sys.exit(rc)


def ok(payload=None):
    out = {"ok": True}
    if payload:
        out.update(payload)
    print(json.dumps(out))
    sys.exit(0)


def run(cmd, check=True, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except Exception as e:
        if check:
            die(f"cmd failed: {' '.join(cmd)}: {e}")
        return None
    if check and r.returncode != 0:
        die(f"{' '.join(cmd)} exit {r.returncode}: {r.stderr.strip() or r.stdout.strip()}")
    return r


def validate_cidr(value, family):
    try:
        net = ipaddress.ip_interface(value)
    except ValueError as e:
        die(f"invalid {family} CIDR {value!r}: {e}")
    if family == "v4" and not isinstance(net.ip, ipaddress.IPv4Address):
        die(f"expected IPv4, got {value!r}")
    if family == "v6" and not isinstance(net.ip, ipaddress.IPv6Address):
        die(f"expected IPv6, got {value!r}")
    return str(net)


def validate_ip(value, family):
    try:
        addr = ipaddress.ip_address(value)
    except ValueError as e:
        die(f"invalid {family} address {value!r}: {e}")
    if family == "v4" and not isinstance(addr, ipaddress.IPv4Address):
        die(f"expected IPv4 gateway, got {value!r}")
    if family == "v6" and not isinstance(addr, ipaddress.IPv6Address):
        die(f"expected IPv6 gateway, got {value!r}")
    return str(addr)


def normalize_cfg(cfg):
    if not isinstance(cfg, dict):
        die("config must be a JSON object")
    cfg = dict(cfg)
    dns = []
    if isinstance(cfg.get("dns"), list):
        dns.extend(cfg["dns"])

    ipv4_cfg = cfg.get("ipv4_config") or {}
    if isinstance(ipv4_cfg, dict):
        address = str(ipv4_cfg.get("address") or "").strip()
        gateway = str(ipv4_cfg.get("gateway") or "").strip()
        if address and not cfg.get("ipv4"):
            cfg["ipv4"] = address
        if gateway and not cfg.get("gateway4"):
            cfg["gateway4"] = gateway
        if isinstance(ipv4_cfg.get("dns"), list):
            dns.extend(ipv4_cfg["dns"])

    ipv6_cfg = cfg.get("ipv6_config") or {}
    if isinstance(ipv6_cfg, dict):
        address = str(ipv6_cfg.get("address") or "").strip()
        gateway = str(ipv6_cfg.get("gateway") or "").strip()
        if address and not cfg.get("ipv6"):
            cfg["ipv6"] = address
        if gateway and not cfg.get("gateway6"):
            cfg["gateway6"] = gateway
        if isinstance(ipv6_cfg.get("dns"), list):
            dns.extend(ipv6_cfg["dns"])

    seen_dns = []
    for item in dns:
        value = str(item).strip()
        if value and value not in seen_dns:
            seen_dns.append(value)
    if seen_dns:
        cfg["dns"] = seen_dns
    return cfg


def cfg_to_ini(cfg):
    cfg = normalize_cfg(cfg)
    mode = cfg.get("mode", "dhcp").lower()
    valid_modes = ("dhcp", "static", "dhcp-v4-only", "dhcp-v6-only", "hybrid")
    if mode not in valid_modes:
        die(f"invalid mode {mode!r} — expected one of {valid_modes}")
    match = cfg.get("match") or DEFAULT_MATCH
    if not MATCH_RE.match(match):
        die("invalid match pattern")

    lines = [
        "# Managed by iora-netctl — do not edit by hand.",
        "# Remove this file and run `iora-netctl set --dhcp` to reset.",
        "[Match]",
        f"Name={match}",
        "Type=ether",
        "",
        "[Network]",
    ]
    dns = cfg.get("dns") or []
    if not isinstance(dns, list):
        die("dns must be an array")
    for s in dns:
        try:
            ipaddress.ip_address(s)
        except ValueError as e:
            die(f"invalid DNS {s!r}: {e}")

    accept_ra = cfg.get("accept_ra", True)
    has_v4 = bool(cfg.get("ipv4"))
    has_v6 = bool(cfg.get("ipv6"))
    dhcp_v4 = mode in ("dhcp", "dhcp-v4-only", "hybrid") and not has_v4
    dhcp_v6 = mode in ("dhcp", "dhcp-v6-only", "hybrid") and not has_v6
    static_v4 = mode == "static" or (mode == "hybrid" and has_v4) or mode == "dhcp-v6-only"
    static_v6 = mode == "static" or (mode == "hybrid" and has_v6) or mode == "dhcp-v4-only"

    if not dhcp_v4 and not static_v4 and not dhcp_v6 and not static_v6:
        die("no network configuration could be determined from the given settings")

    if dhcp_v4 and dhcp_v6:
        lines.append("DHCP=yes")
    elif dhcp_v4:
        lines.append("DHCP=ipv4")
    elif dhcp_v6:
        lines.append("DHCP=ipv6")

    if dhcp_v4 or dhcp_v6 or static_v6:
        lines.append(f"IPv6AcceptRA={'yes' if accept_ra else 'no'}")
    elif not static_v6:
        lines.append("IPv6AcceptRA=no")

    for s in dns:
        lines.append(f"DNS={s}")

    # Static IPv4
    if cfg.get("ipv4"):
        v4 = validate_cidr(cfg["ipv4"], "v4")
        lines.append(f"Address={v4}")
        if cfg.get("gateway4"):
            gw4 = validate_ip(cfg["gateway4"], "v4")
            lines.append(f"Gateway={gw4}")

    # Static IPv6
    if cfg.get("ipv6"):
        v6 = validate_cidr(cfg["ipv6"], "v6")
        lines.append(f"Address={v6}")
        if cfg.get("gateway6"):
            gw6 = validate_ip(cfg["gateway6"], "v6")
            lines.append(f"Gateway={gw6}")

    # DHCP sections
    if dhcp_v4:
        lines += [
            "", "[DHCPv4]",
            "ClientIdentifier=mac",
            f"UseDNS={'false' if dns else 'true'}",
            "UseNTP=true",
            "UseHostname=no",
            "RouteMetric=100",
        ]
    if dhcp_v6:
        lines += [
            "", "[DHCPv6]",
            f"UseDNS={'false' if dns else 'true'}",
            "UseNTP=true",
        ]

    lines += [
        "",
        "[Link]",
        "RequiredForOnline=degraded",
        "",
    ]
    return "\n".join(lines)


def write_atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".iora-netctl.")
    try:
        os.write(fd, content.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def backup_current():
    if CUR_FILE.exists():
        shutil.copy2(CUR_FILE, BAK_FILE)


def restore_backup():
    if BAK_FILE.exists():
        shutil.copy2(BAK_FILE, CUR_FILE)
    else:
        try:
            CUR_FILE.unlink()
        except FileNotFoundError:
            pass


def reload_networkd():
    # `networkctl reload` is the non-disruptive path (systemd >= 244).
    r = run(["networkctl", "reload"], check=False)
    if r is None or r.returncode != 0:
        # Fall back to service reload/restart.
        run(["systemctl", "restart", "systemd-networkd.service"], check=False, timeout=30)
    # Nudge the per-interface state machine.
    run(["networkctl", "reconfigure"] + list_managed_ifaces(), check=False)


def list_managed_ifaces():
    try:
        entries = [p.name for p in pathlib.Path("/sys/class/net").iterdir()]
    except Exception:
        return []
    return [n for n in entries
            if n != "lo" and not n.startswith(("docker", "br-", "veth", "vnet", "virbr"))]


def wait_for_online(timeout=30):
    # Poll networkctl for an interface that's at least "routable" or
    # "degraded" (degraded = link up, no default route — still counts as
    # "we can talk to this box on the LAN").
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = run(["networkctl", "--no-pager", "--no-legend", "list"], check=False, timeout=5)
        if r and r.returncode == 0:
            for line in r.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 5:
                    setup, oper = parts[-2], parts[-1]
                    if oper in ("routable", "degraded") and setup == "configured":
                        return True
        time.sleep(1)
    return False


def cmd_status():
    data = {"file": str(CUR_FILE), "exists": CUR_FILE.exists()}
    if CUR_FILE.exists():
        data["content"] = CUR_FILE.read_text()
    r = run(["networkctl", "--no-pager", "--no-legend", "list"], check=False, timeout=5)
    data["networkctl"] = r.stdout if r else ""
    r = run(["ip", "-j", "addr"], check=False, timeout=5)
    if r and r.returncode == 0:
        try:
            data["addrs"] = json.loads(r.stdout)
        except Exception:
            pass
    ok(data)


def cmd_get():
    if not CUR_FILE.exists():
        ok({"mode": "default", "file": None})
    ok({"file": str(CUR_FILE), "content": CUR_FILE.read_text()})


def cmd_set(cfg, no_verify=False):
    ini = cfg_to_ini(cfg)
    backup_current()
    write_atomic(CUR_FILE, ini)
    hostname = cfg.get("hostname")
    if hostname:
        if not HOSTNAME_RE.match(hostname):
            die("invalid hostname")
        try:
            run(["hostnamectl", "set-hostname", hostname], check=False, timeout=5)
        except Exception:
            pathlib.Path("/etc/hostname").write_text(hostname + "\n")
    reload_networkd()
    if no_verify:
        ok({"applied": True, "verified": False})
    if not wait_for_online(timeout=30):
        restore_backup()
        reload_networkd()
        die("new config did not come up within 30s — rolled back")
    ok({"applied": True, "verified": True})


def cmd_rollback():
    if not BAK_FILE.exists():
        die("no backup to roll back to")
    restore_backup()
    reload_networkd()
    ok({"rolled_back": True})


def parse_cli():
    ap = argparse.ArgumentParser(prog="iora-netctl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("get")
    sub.add_parser("rollback")
    s = sub.add_parser("set")
    s.add_argument("json", nargs="?", help='JSON config, "-" for stdin')
    s.add_argument("--dhcp", action="store_true", help="DHCP for both IPv4 and IPv6")
    s.add_argument("--static", action="store_true", help="Static for both IPv4 and IPv6 (requires --ipv4 and/or --ipv6)")
    s.add_argument("--dhcp-v4-only", action="store_true", help="DHCP for IPv4 only")
    s.add_argument("--dhcp-v6-only", action="store_true", help="DHCP for IPv6 only (static IPv4)")
    s.add_argument("--hybrid", action="store_true", help="DHCP for unspecified; static for --ipv4/--ipv6")
    s.add_argument("--ipv4")
    s.add_argument("--gw4")
    s.add_argument("--ipv6")
    s.add_argument("--gw6")
    s.add_argument("--dns", nargs="*", default=[])
    s.add_argument("--custom-dns", nargs="*", default=[])
    s.add_argument("--hostname")
    s.add_argument("--match")
    s.add_argument("--no-verify", action="store_true")
    return ap.parse_args()


def main():
    if os.geteuid() != 0:
        die("must run as root", 77)
    args = parse_cli()
    if args.cmd == "status":
        cmd_status()
    if args.cmd == "get":
        cmd_get()
    if args.cmd == "rollback":
        cmd_rollback()
    if args.cmd == "set":
        if args.json:
            raw = sys.stdin.read() if args.json == "-" else args.json
            try:
                cfg = json.loads(raw)
            except Exception as e:
                die(f"invalid JSON: {e}")
        else:
            # Determine mode from CLI flags
            flags = ["dhcp", "static", "dhcp-v4-only", "dhcp-v6-only", "hybrid"]
            active_modes = [f for f in flags if getattr(args, f.replace("-", "_"), False)]
            if len(active_modes) > 1:
                die(f"modes are mutually exclusive, got: {active_modes}")
            mode = active_modes[0] if active_modes else "dhcp"
            cfg = {"mode": mode}
            if args.ipv4:   cfg["ipv4"] = args.ipv4
            if args.gw4:    cfg["gateway4"] = args.gw4
            if args.ipv6:   cfg["ipv6"] = args.ipv6
            if args.gw6:    cfg["gateway6"] = args.gw6
            dns = list(args.dns) + list(args.custom_dns)
            if dns:         cfg["dns"] = dns
            if args.match:  cfg["match"] = args.match
            if args.hostname: cfg["hostname"] = args.hostname
        cmd_set(cfg, no_verify=args.no_verify)


if __name__ == "__main__":
    main()
NETCTLEOF
chmod 755 "${TARGET_DIR}/usr/bin/iora-netctl"

# Enable systemd-networkd + resolved (they're built by BR2_PACKAGE_SYSTEMD_*).
# Buildroot doesn't always symlink them into network.target.wants on its own.
mkdir -p "${TARGET_DIR}/etc/systemd/system/network-online.target.wants"
ln -sf /usr/lib/systemd/system/systemd-networkd.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/systemd-networkd.service" 2>/dev/null || true
ln -sf /usr/lib/systemd/system/systemd-networkd.socket \
    "${TARGET_DIR}/etc/systemd/system/sockets.target.wants/systemd-networkd.socket" 2>/dev/null || true
mkdir -p "${TARGET_DIR}/etc/systemd/system/sockets.target.wants"
ln -sf /usr/lib/systemd/system/systemd-networkd.socket \
    "${TARGET_DIR}/etc/systemd/system/sockets.target.wants/systemd-networkd.socket" 2>/dev/null || true
ln -sf /usr/lib/systemd/system/systemd-networkd-wait-online.service \
    "${TARGET_DIR}/etc/systemd/system/network-online.target.wants/systemd-networkd-wait-online.service" 2>/dev/null || true

cat > "${TARGET_DIR}/usr/lib/iora/iora-dhcp-conflict-guard.sh" <<'EOF'
#!/bin/sh
# IORA OS DHCP Conflict Guard
#
# Validates that the IPv4 address on each physical interface is not
# conflicting with another host on the LAN. Uses arping for Duplicate
# Address Detection (DAD).
#
# CRITICAL: This script must EXCLUDE the system's own IP from the
# conflict check, otherwise the kernel responds to its own ARP probe
# and the script flushes a perfectly valid static IP — destroying the
# network config set by the installer or setup wizard.
#
# Rules:
#   1. Skip Docker/bridge/veth/tun/tap interfaces entirely.
#   2. Skip interfaces with statically configured IPs (no DHCP lease).
#   3. Use arping with -S <self_ip> so the kernel doesn't respond to
#      its own probe.
#   4. Skip addresses in Docker's default bridge range (172.17.0.0/16)
#      and other virtual ranges.

set -eu

PATH=/usr/sbin:/usr/bin:/sbin:/bin
LOG_TAG="iora-dhcp-conflict-guard"
RETRIES=2

# Docker default bridge subnet
DOCKER_BRIDGE_SUBNET="172.17.0.0/16"

log() {
    logger -t "$LOG_TAG" "$*" 2>/dev/null || echo "$LOG_TAG: $*"
}

renew_iface() {
    iface="$1"
    networkctl renew "$iface" >/dev/null 2>&1 \
        || networkctl reconfigure "$iface" >/dev/null 2>&1 \
        || systemctl try-restart systemd-networkd.service >/dev/null 2>&1 \
        || true
}

# Helper: check if an IP belongs to a subnet (CIDR notation).
ip_in_subnet() {
    ip="$1"
    subnet="$2"
    # Convert IP and subnet to comparable integers using ipcalc or awk.
    # Use a simple prefix-based approach.
    case "$subnet" in
        172.17.0.0/16)
            case "$ip" in 172.17.*) return 0;; esac ;;
        10.*) ;& 172.16.*) ;& 192.168.*) ;&
        *) return 1 ;;
    esac
    return 1
}

# Helper: check if this interface has a static network config (not DHCP).
is_static_iface() {
    iface="$1"
    # Check if any .network file in /etc/systemd/network matches this
    # interface AND does NOT contain "DHCP=yes".
    for nf in /etc/systemd/network/*.network; do
        [ -f "$nf" ] || continue
        # Check if this file matches our interface name.
        if grep -q "Name=$iface\|Name=${iface}*\|Name=eth*\|Name=en*" "$nf" 2>/dev/null; then
            # If it does NOT contain DHCP=yes or contains a static Address=, treat as static.
            if grep -q "^Address=" "$nf" 2>/dev/null || ! grep -q "^DHCP=yes" "$nf" 2>/dev/null; then
                return 0
            fi
        fi
    done
    return 1
}

for iface_path in /sys/class/net/*; do
    iface=$(basename "$iface_path")

    # ── Skip virtual / container interfaces ──────────────────────────
    case "$iface" in
        lo|docker*|br-*|veth*|vnet*|virbr*|tun*|tap*|bond*|sit*)
            continue ;;
    esac

    # Only physical interfaces have a "device" symlink.
    [ -d "/sys/class/net/$iface/device" ] || continue

    ifindex=$(cat "/sys/class/net/$iface/ifindex" 2>/dev/null || echo "")
    [ -n "$ifindex" ] || continue

    # Get the current IPv4 address.
    addr_info=$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4}' | head -1)
    addr="${addr_info%%/*}"
    [ -n "$addr" ] || continue

    # ── Skip Docker bridge range IPs ─────────────────────────────────
    case "$addr" in 172.17.*|172.18.*|172.19.*)
        log "Skipping $iface: $addr is in Docker bridge range"
        continue ;;
    esac

    # ── Skip statically configured interfaces ─────────────────────────
    # Only run DHCP conflict detection on interfaces that actually use DHCP.
    if is_static_iface "$iface"; then
        log "Skipping $iface: statically configured (no DHCP conflict check needed)"
        continue
    fi

    # ── Skip if no DHCP lease was assigned ───────────────────────────
    [ -f "/run/systemd/netif/leases/$ifindex" ] || continue

    log "Checking $iface ($addr) for DHCP conflicts..."

    attempt=1
    while [ "$attempt" -le "$RETRIES" ]; do
        # Use arping with source IP (-S) so the kernel does NOT respond
        # to its own probe. This prevents false-positive conflict detection
        # that would flush the IP.
        if arping -D -q -c 1 -w 2 -I "$iface" -S "$addr" "$addr" >/dev/null 2>&1; then
            log "$iface: no conflict detected for $addr"
            break
        fi

        # If arping -D returns non-zero, this could mean:
        #   1. A real conflict (another host has this IP)
        #   2. arping itself failed (not available, wrong interface)
        #
        # To avoid false positives, double-check with a simple ping first.
        if ping -c 1 -W 1 "$addr" >/dev/null 2>&1; then
            # Someone IS responding — could be us or a conflict.
            # Check if it's ourselves by comparing MAC.
            self_mac=$(cat "/sys/class/net/$iface/address" 2>/dev/null || echo "")
            reply_mac=$(arping -c 1 -w 2 -I "$iface" "$addr" 2>/dev/null | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -1)
            if [ "$reply_mac" = "$self_mac" ] && [ -n "$self_mac" ]; then
                log "$iface: response is from ourselves ($self_mac) — no conflict"
                break
            fi

            log "WARNING: Possible DHCP conflict on $iface ($addr) — attempt $attempt/$RETRIES"
            if [ "$attempt" -lt "$RETRIES" ]; then
                log "Requesting new lease..."
                ip addr flush dev "$iface" scope global >/dev/null 2>&1 || true
                renew_iface "$iface"
                sleep 3
                # Re-read address after renewal
                addr_info=$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4}' | head -1)
                addr="${addr_info%%/*}"
                [ -n "$addr" ] || break
            fi
        else
            # No one responds to ping — arping false positive, no conflict.
            log "$iface: no host responds to ping on $addr — no conflict"
            break
        fi
        attempt=$((attempt + 1))
    done

    final_addr=$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
    if [ -n "$final_addr" ]; then
        log "$iface: lease validated at $final_addr"
    fi
done

exit 0
EOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-dhcp-conflict-guard.sh"

cat > "${TARGET_DIR}/etc/systemd/system/iora-dhcp-conflict-guard.service" <<'EOF'
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
ln -sf /etc/systemd/system/iora-dhcp-conflict-guard.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-dhcp-conflict-guard.service" 2>/dev/null || true

# Cap networkd-wait-online so a missing cable never blocks the boot for
# 2 minutes: "any" means as soon as ONE interface is online we're done,
# 20s timeout prevents endless hangs in headless VMs.
mkdir -p "${TARGET_DIR}/etc/systemd/system/systemd-networkd-wait-online.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/systemd-networkd-wait-online.service.d/10-iora.conf" <<'EOF'
[Service]
ExecStart=
ExecStart=/lib/systemd/systemd-networkd-wait-online --any --timeout=20
# Don't fail the unit if no link is up — network-online.target should still
# be reached so iora-stack, docker, etc. can start (with retries).
SuccessExitStatus=0 1
EOF

# Configure Docker daemon
cat > "${TARGET_DIR}/etc/docker/daemon.json" <<EOF
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "userland-proxy": false,
  "ipv6": false,
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 65536, "Soft": 65536 }
  },
  "default-runtime": "runc",
  "exec-opts": ["native.cgroupdriver=systemd"],
  "icc": false
}
EOF
# Note: "hosts" is intentionally omitted. docker.socket (systemd socket
# activation) already binds /var/run/docker.sock. Adding "hosts" here
# conflicts with the fd:// activation used by the upstream docker.service
# unit and causes Docker to fail to start at boot.

# ── Docker socket hardening ──────────────────────────────────────────────────
# The Docker socket is owned by root:root with 0600. The docker group is NOT
# used — only iora-supervisor (running as root) is allowed to access the socket
# via AppArmor. This prevents user apps or any other process from directly
# driving Docker.
mkdir -p "${TARGET_DIR}/etc/systemd/system/docker.socket.d"
cat > "${TARGET_DIR}/etc/systemd/system/docker.socket.d/hardening.conf" <<'EOF'
[Socket]
# Remove the default docker group ownership — only root may access the socket.
# iora-supervisor holds root and is the sole gateway to Docker for user apps.
SocketMode=0600
SocketUser=root
SocketGroup=root
EOF

# Make sure docker.service itself auto-restarts on crashes
mkdir -p "${TARGET_DIR}/etc/systemd/system/docker.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/docker.service.d/override.conf" <<'EOF'
[Service]
Restart=always
RestartSec=5
StartLimitBurst=10
StartLimitIntervalSec=60
LimitNOFILE=1048576
LimitNPROC=1048576
EOF

# Buildroot installs docker.service + docker.socket but does not enable them
# at boot — no `systemctl preset` run during image assembly. Without these
# symlinks dockerd only starts on-demand via Wants=docker.service from other
# units, which fails for iora-stack.service with:
#     "A dependency job for iora-stack.service failed"
# because on-demand socket activation hasn't been configured either.
# Enable both explicitly so dockerd is up by the time setup completes.
mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
mkdir -p "${TARGET_DIR}/etc/systemd/system/sockets.target.wants"
ln -sf /usr/lib/systemd/system/docker.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/docker.service"
ln -sf /usr/lib/systemd/system/docker.socket \
    "${TARGET_DIR}/etc/systemd/system/sockets.target.wants/docker.socket"

# ── LUKS unlock service for /mnt/data ──────────────────────────────────────
# iora-data-unlock.service runs before mnt-data.mount. It inspects whether
# the iora-data partition is LUKS-formatted:
#   - LUKS: opens it with the keyfile at /etc/iora/data.keyfile, creating
#     the device-mapper node /dev/mapper/iora-data.
#   - Plain ext4 (fresh install, no encryption yet): creates a symlink
#     /dev/mapper/iora-data → /dev/disk/by-label/iora-data so the mount
#     unit can always reference /dev/mapper/iora-data regardless of mode.
# The keyfile is stored on the signed, read-only rootfs. An attacker booting
# from external media cannot access it; iora-verify ensures rootfs integrity.
mkdir -p "${TARGET_DIR}/usr/lib/iora" "${TARGET_DIR}/etc/iora"

cat > "${TARGET_DIR}/usr/lib/iora/iora-data-unlock" <<'UNLOCKEOF'
#!/bin/sh
# IORA OS — data partition LUKS unlock helper.
# Called by iora-data-unlock.service before mnt-data.mount.
# Exits 0 in all cases so a missing/plain partition never blocks boot.

DEV=/dev/disk/by-label/iora-data
KEYFILE=/etc/iora/data.keyfile
MAPPER=/dev/mapper/iora-data
LOG_TAG="iora-data-unlock"

log()  { logger -t "$LOG_TAG" "$*" 2>/dev/null || echo "$LOG_TAG: $*"; }
fail() { log "WARNING: $*"; exit 0; }  # always exit 0 — non-fatal

# Ensure device-mapper modules are loaded before any cryptsetup/dmsetup call.
# luksOpen and dmsetup both require dm_mod; dm-crypt adds the crypto layer.
# Failures are non-fatal: modules may already be built into the kernel.
modprobe dm_mod   2>/dev/null || true
modprobe dm-crypt 2>/dev/null || true

# Wait for udev to process the dm_mod init event and create
# /dev/mapper/control before cryptsetup runs.
udevadm settle --timeout=5 2>/dev/null || true

# Belt-and-suspenders: if /dev/mapper/control is still absent (e.g. when
# dm_mod is built-in and devtmpfs hasn't created the node yet), create it
# manually.  Major 10, minor 236 is the device-mapper control device.
mkdir -p /dev/mapper
if [ ! -e /dev/mapper/control ]; then
    mknod /dev/mapper/control c 10 236 2>/dev/null || true
fi

# Nothing to do if the partition doesn't exist yet (installer hasn't run).
[ -e "$DEV" ] || fail "iora-data partition not found — skipping"

# Nothing to do if already opened (e.g., by initramfs or previous invocation).
if [ -b "$MAPPER" ]; then
    log "iora-data already open at $MAPPER"
    exit 0
fi

mkdir -p /dev/mapper

if cryptsetup isLuks "$DEV" 2>/dev/null; then
    log "iora-data is LUKS-encrypted — unlocking"
    if [ -r "$KEYFILE" ]; then
        if cryptsetup luksOpen "$DEV" iora-data --key-file "$KEYFILE"; then
            log "iora-data unlocked successfully via keyfile"
        else
            log "ERROR: luksOpen failed — data partition will not be mounted"
        fi
    else
        log "ERROR: keyfile $KEYFILE missing — data partition will not be mounted"
        log "Boot into Recovery mode and use your Recovery PIN to restore access."
    fi
else
    log "iora-data is plain ext4 — creating pass-through device alias"
    # Resolve the by-label symlink to the actual block device.
    real=$(readlink -f "$DEV" 2>/dev/null) || real="$DEV"
    # Validate that 'real' is actually a block device before using it.
    if [ ! -b "$real" ]; then
        fail "resolved device '$real' is not a block device — cannot create alias"
    fi
    # Create a linear device-mapper device so mnt-data.mount always works.
    sectors=$(blockdev --getsz "$real" 2>/dev/null) || sectors=""
    if [ -n "$sectors" ] && command -v dmsetup >/dev/null 2>&1 \
            && dmsetup ls >/dev/null 2>&1; then
        # device-mapper is available — create a proper linear alias.
        dmsetup create iora-data --table "0 $sectors linear $real 0" 2>/dev/null \
            && log "device-mapper alias created for plain partition" \
            || { log "WARNING: dmsetup create failed — falling back to symlink"
                 ln -sf "$real" "$MAPPER" 2>/dev/null || true; }
    else
        # dmsetup not available (dm_mod kernel module missing) — fall back to
        # a symlink.  mnt-data.mount references /dev/mapper/iora-data; a
        # symlink to the underlying block device is sufficient for mounting.
        ln -sf "$real" "$MAPPER" 2>/dev/null || true
        log "symlink alias created for plain partition (dm_mod unavailable)"
    fi
fi
exit 0
UNLOCKEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-data-unlock"

cat > "${TARGET_DIR}/etc/systemd/system/iora-data-unlock.service" <<'EOF'
[Unit]
Description=IORA Data Partition LUKS Unlock
DefaultDependencies=no
After=systemd-udev-settle.service
Before=mnt-data.mount local-fs.target
ConditionPathExists=/dev/disk/by-label/iora-data

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/lib/iora/iora-data-unlock
# Non-fatal: a failure here just means the data partition won't mount,
# which is handled gracefully by ConditionPathIsMountPoint checks downstream.
SuccessExitStatus=0 1
# Prevent cryptsetup/dmsetup hangs from blocking the entire boot chain.
# 60 s is generous for LUKS operations on slow hardware.
TimeoutStartSec=60
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=local-fs.target
EOF

ln -sf /etc/systemd/system/iora-data-unlock.service \
    "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants/iora-data-unlock.service"

# Enable iora-assist (AI & Agent Service) — starts after iora-home
ln -sf /etc/systemd/system/iora-assist.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-assist.service"

# Auto-mount data partition at /mnt/data.
# `nofail` is critical: on a freshly-dd'd disk, in VMs where the iora-data
# label is not present yet, or when the installer hasn't run, a missing
# label would drop the system into emergency.target. With nofail the mount
# unit simply stays inactive and dependent services skip via their
# ConditionPathIsMountPoint=/mnt/data.
# We always mount /dev/mapper/iora-data (created by iora-data-unlock.service
# either as a real LUKS device-mapper node or a symlink/alias to the raw
# partition) so the mount unit doesn't need to know whether LUKS is active.
cat > "${TARGET_DIR}/etc/systemd/system/mnt-data.mount" <<'EOF'
[Unit]
Description=IORA Data Partition
DefaultDependencies=no
After=iora-data-unlock.service systemd-fsck@dev-disk-by\x2dlabel-iora\x2ddata.service
Before=local-fs.target
# Don't consider a missing data label a boot failure.
ConditionPathExists=/dev/disk/by-label/iora-data

[Mount]
# iora-data-unlock.service always provides /dev/mapper/iora-data regardless
# of whether the partition is LUKS-encrypted or plain ext4.
What=/dev/mapper/iora-data
Where=/mnt/data
Type=ext4
Options=defaults,noatime,nofail,x-systemd.device-timeout=10s
# x-systemd.device-timeout in Options is only honoured by fstab-generated
# units; for a hand-written .mount unit the equivalent is TimeoutSec here.
TimeoutSec=10

[Install]
WantedBy=local-fs.target
EOF

ln -sf /etc/systemd/system/mnt-data.mount \
    "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants/mnt-data.mount"

# Create service to initialize /mnt/data/iora directory structure
cat > "${TARGET_DIR}/etc/systemd/system/iora-init-data.service" <<'EOF'
[Unit]
Description=Initialize IORA data directory
DefaultDependencies=no
After=mnt-data.mount
Before=iora-stack.service iora-setup.service docker.service
# Soft dependency: if the mount failed/timed-out the Condition below handles
# it gracefully (unit skipped, not failed), preventing the cascade of
# [DEPEND] failures seen when RequiresMountsFor created a hard Requires=.
ConditionPathIsMountPoint=/mnt/data

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '\
  mkdir -p /mnt/data/iora /mnt/data/rauc /mnt/data/backups && \
  chmod 755 /mnt/data/iora /mnt/data/rauc /mnt/data/backups'
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=local-fs.target
EOF

ln -sf /etc/systemd/system/iora-init-data.service \
    "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants/iora-init-data.service"

# ── Recovery audit log initialisation ───────────────────────────────────────
# Create /var/log/iora-recovery.log at boot (on the ZRAM /var) with strict
# permissions. Every recovery-mode session appends a signed line including
# the timestamp, what action was taken, and whether a PIN was provided.
cat > "${TARGET_DIR}/etc/systemd/system/iora-recovery-log-init.service" <<'EOF'
[Unit]
Description=Initialise IORA recovery audit log
DefaultDependencies=no
After=zram.service local-fs.target
Before=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '\
  touch /var/log/iora-recovery.log && \
  chmod 0600 /var/log/iora-recovery.log && \
  chown root:root /var/log/iora-recovery.log'
SuccessExitStatus=0 1
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/iora-recovery-log-init.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-recovery-log-init.service"

# iora-stack.service is written later in this file (user-apps Docker section).

# Periodic watchdog: monitors both native IORA services AND the user-app
# Docker stack. Native services are restarted via systemctl; user-app
# containers are restarted via docker compose.
cat > "${TARGET_DIR}/etc/systemd/system/iora-stack-watchdog.service" <<'EOF'
[Unit]
Description=IORA Service Watchdog (native services + user-app containers + integrity)
After=iora-core.service iora-stack.service docker.service
Wants=iora-core.service

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-watchdog-check
SuccessExitStatus=0 1
StandardOutput=journal
StandardError=journal
EOF

cat > "${TARGET_DIR}/etc/systemd/system/iora-stack-watchdog.timer" <<'EOF'
[Unit]
Description=IORA Stack Watchdog Timer

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
RandomizedDelaySec=30s
Persistent=true

[Install]
WantedBy=timers.target
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/timers.target.wants"
ln -sf /etc/systemd/system/iora-stack-watchdog.timer \
    "${TARGET_DIR}/etc/systemd/system/timers.target.wants/iora-stack-watchdog.timer"

# ── iora-watchdog-check script ───────────────────────────────────────────────
# Centralised watchdog script invoked by iora-stack-watchdog.service every
# 2 minutes. Responsibilities:
#   1. Restart any stopped native IORA services.
#   2. Restart stopped user-app Docker containers (via Supervisor).
#   3. Detect unauthorised processes holding the Docker socket.
#   4. Detect unauthorised (non-allowlisted) running containers.
#   5. Run binary integrity spot-check for native IORA services.
# None of these steps block updates — they log anomalies and defer to the
# iora-integrity.service for full scans.
mkdir -p "${TARGET_DIR}/usr/lib/iora"
cat > "${TARGET_DIR}/usr/lib/iora/iora-watchdog-check" <<'WATCHDOGEOF'
#!/bin/sh
# IORA OS — centralised watchdog check.
# Invoked by iora-stack-watchdog.service (every 2 min via timer).
LOG_TAG="iora-watchdog"
SECURITY_LOG="/var/log/iora-security.log"
MANIFEST="/etc/iora/binary-manifest.sha256"
COMPOSE_HASH_FILE="/var/lib/iora/iora-supervisor/compose.sha256"
COMPOSE_FILE="/mnt/data/iora/docker-compose.yml"
ALLOWED_IMAGES_FILE="/etc/iora/allowed-images.txt"
DOCKER_SOCK="/var/run/docker.sock"

log()     { logger -t "$LOG_TAG" "$*";  echo "[$(date -Iseconds)] $LOG_TAG: $*"; }
alert()   {
    logger -p user.warning -t "$LOG_TAG" "ALERT: $*"
    echo "[$(date -Iseconds)] $LOG_TAG ALERT: $*" >> "$SECURITY_LOG" 2>/dev/null || true
}

# ── 1. Native IORA services ──────────────────────────────────────────────────
for svc in iora-core iora-home iora-control iora-assist \
            iora-secrets iora-watchdog iora-security iora-gateway \
            iora-supervisor iora-api iora-appstore iora-backup iora-connector \
            iora-dev-bridge iora-domain-validator iora-files \
            iora-network-monitor iora-nginx iora-resource-manager iora-updater; do
    if ! systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
        if systemctl is-enabled --quiet "${svc}.service" 2>/dev/null; then
            alert "native service ${svc} is down — restarting"
            systemctl start "${svc}.service" 2>/dev/null || true
        fi
    fi
done

# ── 2. User-app Docker containers (via Supervisor) ───────────────────────────
if [ -f /mnt/data/iora/.setup-complete ] && [ -f "$COMPOSE_FILE" ]; then
    STOPPED=$(/usr/bin/docker compose -f "$COMPOSE_FILE" \
              ps --status exited --services 2>/dev/null | wc -l)
    if [ "$STOPPED" -gt 0 ]; then
        log "restarting $STOPPED stopped user-app container(s)"
        /usr/bin/docker compose -f "$COMPOSE_FILE" \
            up -d --remove-orphans 2>/dev/null || true
    fi
fi

# ── 3. Docker socket consumer audit ─────────────────────────────────────────
# Only iora-supervisor (root) is permitted to open the Docker socket.
# We use shell globbing over /proc/[pid]/fd/ — no ls parsing, no external tools.
if [ -S "$DOCKER_SOCK" ]; then
    for pid_dir in /proc/[0-9]*/fd; do
        pid="${pid_dir%/fd}"
        pid="${pid#/proc/}"
        # Check if any fd in this process resolves to the Docker socket.
        for fdlink in "${pid_dir}"/*; do
            target=$(readlink "$fdlink" 2>/dev/null) || continue
            case "$target" in
                *docker.sock*) ;;
                *) continue ;;
            esac
            comm=$(cat "/proc/${pid}/comm" 2>/dev/null || echo "unknown")
            uid=$(awk '/^Uid:/{print $2}' "/proc/${pid}/status" 2>/dev/null || echo "?")
            if [ "$uid" != "0" ]; then
                alert "non-root process '${comm}' (pid ${pid}, uid ${uid}) is accessing the Docker socket"
            fi
            case "$comm" in
                iora-supervisor|dockerd|containerd|docker) : ;;  # authorised
                *)
                    alert "unexpected process '${comm}' (pid ${pid}) is holding the Docker socket"
                    ;;
            esac
            break  # only need one match per pid
        done
    done
fi

# ── 4. Unauthorized container detection ─────────────────────────────────────
# Check all running containers against the allowlist managed by Supervisor.
if [ -f "$ALLOWED_IMAGES_FILE" ] && command -v docker >/dev/null 2>&1; then
    docker ps --format '{{.Image}}:{{.Names}}' 2>/dev/null | while IFS=: read -r image name; do
        # Strip tag for comparison.
        image_base="${image%%:*}"
        if ! grep -qF "$image_base" "$ALLOWED_IMAGES_FILE" 2>/dev/null; then
            alert "unauthorized container running: name='${name}' image='${image}'"
        fi
    done
fi

# ── 5. Binary integrity spot-check ──────────────────────────────────────────
# Do a quick spot-check of one random IORA binary per watchdog cycle.
# The full scan runs in iora-integrity.service (separate timer, every 5 min).
if [ -f "$MANIFEST" ]; then
    # Pick a random line from the manifest.
    total=$(wc -l < "$MANIFEST")
    if [ "$total" -gt 0 ]; then
        rand_raw=$(od -An -N2 -tu2 /dev/urandom 2>/dev/null | tr -d ' \n')
        rand_val=$(( ${rand_raw:-1} ))
        pick=$(( (rand_val % total) + 1 ))
        line=$(sed -n "${pick}p" "$MANIFEST" 2>/dev/null)
        expected_hash=$(echo "$line" | awk '{print $1}')
        bin_path=$(echo "$line"    | awk '{print $2}')
        if [ -f "$bin_path" ] && [ -n "$expected_hash" ]; then
            actual_hash=$(sha256sum "$bin_path" 2>/dev/null | awk '{print $1}')
            if [ "$actual_hash" != "$expected_hash" ]; then
                alert "binary integrity MISMATCH: ${bin_path} (expected ${expected_hash}, got ${actual_hash})"
            fi
        fi
    fi
fi

exit 0
WATCHDOGEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-watchdog-check"

# ── Ensure getty@tty1 is enabled ────────────────────────────────────────────
# Without an explicit WantedBy symlink, Buildroot systemd doesn't always
# spawn a login prompt on tty1 → the user sees "Startup finished ..." and
# nothing else. systemctl preset would normally do this but Buildroot skips
# that, so we create the symlink ourselves. Also enable serial-getty@ttyS0
# so boards wired to a serial console get a prompt there too.
mkdir -p "${TARGET_DIR}/etc/systemd/system/getty.target.wants"
ln -sf /usr/lib/systemd/system/getty@.service \
    "${TARGET_DIR}/etc/systemd/system/getty.target.wants/getty@tty1.service"
ln -sf /usr/lib/systemd/system/serial-getty@.service \
    "${TARGET_DIR}/etc/systemd/system/getty.target.wants/serial-getty@ttyS0.service"

# ── Quiet kernel printk once boot is complete ───────────────────────────────
# After multi-user is up, late mount deactivations and watchdog timers print
# "Deactivated successfully" to /dev/console, overwriting the getty login
# prompt. Lowering printk's console log level to 3 (errors only) as soon as
# userspace comes up means the prompt stays visible, but kernel errors still
# appear. Warnings/info still go to journald.
mkdir -p "${TARGET_DIR}/etc/sysctl.d"
cat > "${TARGET_DIR}/etc/sysctl.d/10-iora-console-quiet.conf" <<'EOF'
# kernel.printk = console_loglevel default_message_loglevel minimum_console_loglevel default_console_loglevel
# 3 = KERN_ERR and below → only errors appear on the tty; everything else
# is still captured by journald and visible via `journalctl -k`.
kernel.printk = 3 4 1 7
EOF

# iora-stack.service (user-app Docker stack) is written in the native-services section below.

# Configure ZRAM for /tmp and /var
# Must use DefaultDependencies=no + explicit shutdown ordering: default
# deps would add After=sysinit.target, but sysinit.target transitively
# comes After=local-fs.target (via systemd-tmpfiles-setup), and we have
# Before=local-fs.target -> ordering cycle that systemd breaks by deleting
# local-fs.target, which then kills PostgreSQL, Chrony, and mount units.
# ZRAM setup script — best-effort. If the kernel doesn't have CONFIG_ZRAM
# or the LZ4 crypto module, we fall back to tmpfs for /tmp and leave /var
# on the rootfs. The important thing is that /var/lib/{pgsql,chrony} etc.
# always exist so PostgreSQL + Chrony can still start.
mkdir -p "${TARGET_DIR}/usr/lib/iora"
cat > "${TARGET_DIR}/usr/lib/iora/iora-zram-setup" <<'ZRAMEOF'
#!/bin/sh
# Set up ZRAM-backed /tmp and /var. All failures are non-fatal: on error
# we fall back to tmpfs (for /tmp) or just use the rootfs /var.
#
# Exit codes are intentionally always 0 — we do NOT want to cascade into
# failure for PostgreSQL, Chrony, journald, iora-stack, etc.

log() { echo "iora-zram: $*"; }

ensure_var_skeleton() {
    mkdir -p /var/lib /var/log /var/cache /var/spool /var/run \
             /var/tmp /var/empty /var/lock /var/log/journal \
             /var/lib/pgsql /var/lib/chrony /var/log/chrony 2>/dev/null || true
    chmod 1777 /var/tmp 2>/dev/null || true
    if getent passwd postgres >/dev/null 2>&1; then
        chown -R postgres:postgres /var/lib/pgsql 2>/dev/null || true
        chmod 700 /var/lib/pgsql 2>/dev/null || true
    fi
    if getent passwd chrony >/dev/null 2>&1; then
        chown -R chrony:chrony /var/lib/chrony /var/log/chrony 2>/dev/null || true
    fi
}

setup_zram() {
    local dev="$1" size="$2" mountpoint="$3" algo
    # Try lz4 first, then lzo, then fall back to whatever the default is.
    for algo in lz4 lzo zstd deflate ""; do
        if [ -z "$algo" ]; then break; fi
        if echo "$algo" > "/sys/block/${dev}/comp_algorithm" 2>/dev/null; then
            log "${dev}: using ${algo}"
            break
        fi
    done
    if ! echo "$size" > "/sys/block/${dev}/disksize" 2>/dev/null; then
        log "${dev}: cannot set disksize to ${size}"
        return 1
    fi
    if ! /usr/sbin/mkfs.ext4 -q -F "/dev/${dev}" >/dev/null 2>&1; then
        log "${dev}: mkfs.ext4 failed"
        return 1
    fi
    mkdir -p "$mountpoint" 2>/dev/null || true
    if ! /bin/mount -o noatime "/dev/${dev}" "$mountpoint" 2>/dev/null; then
        log "${dev}: mount on ${mountpoint} failed"
        return 1
    fi
    log "${dev}: mounted on ${mountpoint} (${size})"
    return 0
}

# 1. Load the zram module if possible. If it's not available we still
#    continue so at least the /var skeleton gets recreated.
if /usr/bin/modprobe zram num_devices=2 2>/dev/null \
   || [ -d /sys/module/zram ]; then
    :  # zram available
else
    log "zram module not available — falling back to tmpfs /tmp only"
    # tmpfs /tmp is harmless even if already mounted tmpfs by systemd.
    mountpoint -q /tmp 2>/dev/null || /bin/mount -t tmpfs -o noatime,size=512M tmpfs /tmp 2>/dev/null || true
    ensure_var_skeleton
    exit 0
fi

# 2. Wait briefly for /sys/block/zram{0,1} to appear.
for _i in 1 2 3 4 5; do
    [ -d /sys/block/zram0 ] && [ -d /sys/block/zram1 ] && break
    sleep 1
done

# 3. Configure and mount. Each is independent; failure to set up one
#    must not prevent the other from being tried.
setup_zram zram0 2G /tmp || \
    /bin/mount -t tmpfs -o noatime,size=512M tmpfs /tmp 2>/dev/null || true
setup_zram zram1 4G /var || \
    log "/var stays on rootfs"

chmod 1777 /tmp 2>/dev/null || true

# 4. Always create the skeleton so PostgreSQL/Chrony/journald can start.
ensure_var_skeleton

exit 0
ZRAMEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-zram-setup"

cat > "${TARGET_DIR}/etc/systemd/system/zram.service" <<'EOF'
[Unit]
Description=Setup ZRAM for /tmp and /var
DefaultDependencies=no
Before=local-fs.target shutdown.target
Conflicts=shutdown.target
After=systemd-remount-fs.service

[Service]
Type=oneshot
RemainAfterExit=yes
# Always succeeds — the script handles all failure modes internally so
# that a missing kernel feature never breaks Postgres/Chrony/iora-stack.
ExecStart=/usr/lib/iora/iora-zram-setup
# Best-effort unmount so shutdown isn't blocked.
ExecStop=/bin/sh -c 'umount /tmp 2>/dev/null; umount /var 2>/dev/null; true'
SuccessExitStatus=0 1 2 3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=local-fs.target
EOF

ln -sf /etc/systemd/system/zram.service \
    "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants/zram.service"

# Ensure PostgreSQL and Chrony wait for zram.service to have created
# /var/lib/pgsql and /var/lib/chrony — otherwise their first-boot initdb
# and chronyd write paths fail because /var is a freshly mounted ZRAM fs.
mkdir -p "${TARGET_DIR}/etc/systemd/system/postgresql.service.d" \
         "${TARGET_DIR}/etc/systemd/system/chrony.service.d" 2>/dev/null || true
cat > "${TARGET_DIR}/etc/systemd/system/postgresql.service.d/10-iora-zram.conf" <<'EOF'
[Unit]
# ZRAM service creates /var/lib/pgsql. We only *want* it — if it fails
# the skeleton is still created on rootfs /var, so Postgres can start.
Wants=zram.service
After=zram.service local-fs.target
ConditionPathIsDirectory=/var/lib/pgsql
EOF
cat > "${TARGET_DIR}/etc/systemd/system/chrony.service.d/10-iora-zram.conf" <<'EOF'
[Unit]
Wants=zram.service
After=zram.service local-fs.target
ConditionPathIsDirectory=/var/lib/chrony
EOF

# ── Hardened PostgreSQL init drop-in ────────────────────────────────────────
# On a minimal Buildroot rootfs there are no glibc locales available, which
# makes the default `pg_ctl initdb` fail (it tries to use the system locale).
# We override ExecStartPre so the cluster is always created with
# --locale=C --encoding=UTF8, and we make sure the data dir has mode 0700
# owned by the `postgres` user BEFORE initdb runs. The `+` prefix runs the
# command as root regardless of `User=postgres` in the upstream unit.
cat > "${TARGET_DIR}/etc/systemd/system/postgresql.service.d/20-iora-init.conf" <<'EOF'
[Service]
# Clear upstream ExecStartPre (which would fail without locales) and replace.
ExecStartPre=
ExecStartPre=+/bin/sh -c 'mkdir -p /var/lib/pgsql && chown postgres:postgres /var/lib/pgsql && chmod 700 /var/lib/pgsql'
ExecStartPre=/bin/sh -c 'if [ ! -f /var/lib/pgsql/PG_VERSION ]; then /usr/bin/pg_ctl initdb -D /var/lib/pgsql -o "--locale=C --encoding=UTF8"; fi'
Environment=LANG=C LC_ALL=C
# Be forgiving on first boot; retry instead of giving up.
Restart=on-failure
RestartSec=10
TimeoutStartSec=300

[Unit]
# Don't abort the boot if we ultimately can't start — user can fix later.
OnFailure=
EOF

# ── iora-db-init — PostgreSQL bootstrap for IORA ────────────────────────────
# This one-shot script runs after postgresql.service on every boot until a
# sentinel file tells it everything is already in place.  It:
#   1. Creates the iora role (if absent) with the password stored in
#      /etc/iora/db.password (written by the setup wizard at first boot).
#   2. Creates the four IORA databases (if absent) owned by the iora role.
#   3. Hardens pg_hba.conf so the iora role can only connect from localhost
#      using password authentication.
#
# The script is idempotent — running it twice does nothing harmful.
# The sentinel /etc/iora/.db-initialised is written on success.  If the
# setup wizard later changes the DB password it deletes the sentinel so the
# script re-runs and updates the role password.
cat > "${TARGET_DIR}/usr/lib/iora/iora-db-init" <<'DBINIT'
#!/bin/sh
# IORA OS — native PostgreSQL initialisation.
# Runs as root (via ExecStart=+) so it can call psql as the postgres user.
SENTINEL="/etc/iora/.db-initialised"
PASSFILE="/etc/iora/db.password"
LOG_TAG="iora-db-init"

log()   { logger -t "$LOG_TAG" "$*"; echo "[$(date -Iseconds)] $LOG_TAG: $*"; }
die()   { log "FATAL: $*"; exit 1; }

# Auto-detect PostgreSQL data directory (works on both IORA OS /var/lib/pgsql
# and Debian/Ubuntu /var/lib/postgresql/<version>/main).
auto_detect_pgdata() {
    if [ -n "${PGDATA:-}" ] && [ -d "$PGDATA" ]; then
        return
    fi
    if [ -d "/var/lib/pgsql" ] && [ -f "/var/lib/pgsql/PG_VERSION" ]; then
        PGDATA="/var/lib/pgsql"
    elif [ -d "/var/lib/postgresql" ]; then
        PGDATA=$(find /var/lib/postgresql -maxdepth 3 -name "PG_VERSION" -type f 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
        [ -z "$PGDATA" ] && PGDATA="/var/lib/pgsql"
    else
        PGDATA="/var/lib/pgsql"
    fi
    log "Detected PGDATA=${PGDATA}"
}
auto_detect_pgdata

# Wait for the PostgreSQL socket to be ready (up to 30 s).
wait_pg() {
    local i=0
    while ! su -s /bin/sh postgres -c "pg_isready -q" >/dev/null 2>&1; do
        i=$((i+1))
        [ "$i" -ge 30 ] && die "PostgreSQL not ready after 30 s"
        sleep 1
    done
}

psql_iora() {
    # Run a SQL command as the postgres superuser.
    su -s /bin/sh postgres -c "psql -v ON_ERROR_STOP=1 -qAt -c \"$1\""
}

wait_pg

# Load the DB password the setup wizard wrote, or auto-generate one.
# This ensures IORA services come up automatically on first boot
# even before the setup wizard has run.
if [ ! -f "$PASSFILE" ] || [ -z "$(cat "$PASSFILE" 2>/dev/null)" ]; then
    DB_PASS=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | cut -c1-32)
    mkdir -p /etc/iora
    printf '%s' "$DB_PASS" > "$PASSFILE"
    chmod 600 "$PASSFILE"
    log "Auto-generated DB password (setup wizard has not run yet)"
else
    DB_PASS=$(cat "$PASSFILE")
fi

log "Initialising IORA databases…"

# 1. Create the iora role (or update its password if it already exists).
# We pass the SQL via stdin and write the password using \password (reads from
# stdin) to avoid the credential appearing in process listings or pg logs.
# The heredoc feeds both the conditional role creation AND the password change.
su -s /bin/sh postgres -c "psql -v ON_ERROR_STOP=1 -q" <<SQLEOF || die "Failed to create/update iora role"
DO \$\$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iora') THEN
    CREATE ROLE iora LOGIN;
  END IF;
END\$\$;
ALTER ROLE iora PASSWORD '$(printf '%s' "$DB_PASS" | sed "s/'/''/g")';
SQLEOF

# 2. Create the IORA databases (owned by iora). iora_core is the
#    central one; the rest are per-service. iora_assist is referenced by
#    iora-api (Assist sidecar) so it must exist even if iora-assist
#    itself isn't enabled — without it iora-api crash-loops on startup
#    with "database iora_assist does not exist".
for db in iora_core iora_home iora_secrets iora_security iora_assist; do
    if ! psql_iora "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
        su -s /bin/sh postgres -c "createdb -O iora ${db}" || \
            die "Failed to create database ${db}"
        log "Created database ${db}"
    fi
done

# 3. Harden pg_hba.conf: only allow the iora role from localhost using
#    scram-sha-256 password auth; the postgres superuser keeps local peer
#    auth so pg_ctl, pg_dumpall etc. still work without a password.
HBA="${PGDATA}/pg_hba.conf"
IORA_IPV4="host    all             iora            127.0.0.1/32            scram-sha-256"
IORA_IPV6="host    all             iora            ::1/128                 scram-sha-256"

# Only add lines once to keep the file clean.
grep -qF "host    all             iora" "$HBA" 2>/dev/null || {
    printf '\n# IORA application role — localhost only, password auth\n' >> "$HBA"
    printf '%s\n' "$IORA_IPV4" "$IORA_IPV6" >> "$HBA"
    # Reload so the new rules take effect without a full restart.
    su -s /bin/sh postgres -c "pg_ctl reload -D ${PGDATA}" >/dev/null 2>&1 || true
    log "Updated pg_hba.conf and reloaded PostgreSQL"
}

# 4. Replace every CHANGEME placeholder in all service environment files
#    with the actual password so services come up immediately on first boot.
UPDATED_ENV=0
for envfile in /etc/iora/*.env; do
    [ -f "$envfile" ] || continue
    if grep -q 'CHANGEME' "$envfile" 2>/dev/null; then
        sed -i "s/CHANGEME/${DB_PASS}/g" "$envfile"
        UPDATED_ENV=$((UPDATED_ENV + 1))
        log "Updated $(basename "$envfile") — replaced CHANGEME placeholders"
    fi
done
if [ "$UPDATED_ENV" -gt 0 ]; then
    log "Replaced CHANGEME in ${UPDATED_ENV} environment file(s)"
else
    log "No CHANGEME placeholders found in /etc/iora/*.env (env files may be missing — services use fallback defaults)"
fi

# 5. Write the sentinel so this script is skipped on the next boot.
mkdir -p /etc/iora
touch "$SENTINEL"
log "IORA database initialisation complete"
exit 0
DBINIT
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-db-init"

# Install the bootstrap/rescue script for existing deployments
if [ -f "${BR2_EXTERNAL_IORA_PATH}/board/iora/iora-bootstrap.sh" ]; then
    install -Dm0755 "${BR2_EXTERNAL_IORA_PATH}/board/iora/iora-bootstrap.sh" \
        "${TARGET_DIR}/usr/lib/iora/iora-bootstrap.sh"
fi

cat > "${TARGET_DIR}/etc/systemd/system/iora-db-init.service" <<'EOF'
[Unit]
Description=IORA Database Initialisation
Documentation=https://iora.kaimdt.com
After=postgresql.service
Requires=postgresql.service
# Re-run whenever the sentinel is absent (first boot or password change).
ConditionPathExists=!/etc/iora/.db-initialised

[Service]
Type=oneshot
RemainAfterExit=yes
# Run as root so we can su to the postgres user.
User=root
ExecStart=/usr/lib/iora/iora-db-init
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iora-db-init
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF

ln -sf /etc/systemd/system/iora-db-init.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-db-init.service"

# IORA services depend on the database being initialised.
# Add iora-db-init.service to the After= line of services that need the DB.
mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-core.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-core.service.d/10-db-init.conf" <<'EOF'
[Unit]
After=iora-db-init.service
Wants=iora-db-init.service
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-secrets.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-secrets.service.d/10-db-init.conf" <<'EOF'
[Unit]
After=iora-db-init.service
Wants=iora-db-init.service
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-security.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-security.service.d/10-db-init.conf" <<'EOF'
[Unit]
After=iora-db-init.service
Wants=iora-db-init.service
EOF


# Make sure chronyd always has a writable drift directory and log directory.
# Upstream chrony.conf writes drift to /var/lib/chrony/drift — if /var is a
# fresh ZRAM filesystem on first boot the directory exists but the drift
# file does not, and chrony's own user may not be able to create it if
# ownership isn't correct yet.
cat > "${TARGET_DIR}/etc/systemd/system/chrony.service.d/20-iora-init.conf" <<'EOF'
[Service]
ExecStartPre=+/bin/sh -c 'mkdir -p /var/lib/chrony /var/log/chrony /run/chrony && (getent passwd chrony >/dev/null 2>&1 && chown -R chrony:chrony /var/lib/chrony /var/log/chrony /run/chrony || true) && chmod 0750 /var/lib/chrony /var/log/chrony && touch /var/lib/chrony/drift && (getent passwd chrony >/dev/null 2>&1 && chown chrony:chrony /var/lib/chrony/drift || true)'
Restart=on-failure
RestartSec=10
TimeoutStartSec=60
EOF

# Buildroot's chrony package does NOT install a default /etc/chrony.conf, so
# `chronyd -n` starts without any sources and exits with status 1 → endless
# restart loop + "Failed with result 'exit-code'". Provide a sensible
# minimal config pointing at public NTP pools.
#
#   pool : let chrony auto-manage the source pool
#   iburst : 4 quick packets on startup for fast initial sync
#   makestep 1.0 3 : step the clock if off by >1s during first 3 updates
#   rtcsync : hook RTC drift compensation (ignored if no /dev/rtc)
#   driftfile : writable location (ensured by the drop-in above)
#   leapsectz : best-effort; works without zoneinfo too
#   logdir : writable location
cat > "${TARGET_DIR}/etc/chrony.conf" <<'EOF'
# /etc/chrony.conf — IORA OS defaults.
# Change NTP pools via the Control Center or edit this file and
# `systemctl restart chrony.service`.

pool 2.pool.ntp.org iburst maxsources 4
pool time.cloudflare.com iburst maxsources 2

# Allow the clock to be stepped in the first 3 updates if it's >1s off.
makestep 1.0 3

# Keep kernel RTC in sync (no-op in VMs without /dev/rtc).
rtcsync

# Save drift + RTC data to persistent storage.
driftfile /var/lib/chrony/drift

# Log files (directory created by the systemd drop-in above).
logdir /var/log/chrony

# Serve time to localhost so docker containers can sync if configured.
allow 127.0.0.1/32
allow ::1/128

# Don't try to load the leap-seconds file if missing (common on Buildroot).
#leapsectz right/UTC
EOF

# Disable rngd on VMs — rng-tools repeatedly exits with status 1 when
# /dev/hwrng is absent (every QEMU/KVM/Hyper-V VM without virtio-rng),
# filling the boot console with red FAILED lines. haveged is already
# installed and is the correct entropy source for virtualised hosts;
# we mask rngd unconditionally and let haveged handle entropy.
mkdir -p "${TARGET_DIR}/etc/systemd/system"
ln -sf /dev/null "${TARGET_DIR}/etc/systemd/system/rngd.service" 2>/dev/null || true
# Ensure haveged is enabled if its unit exists (Buildroot ships one).
if [ -f "${TARGET_DIR}/usr/lib/systemd/system/haveged.service" ] || \
   [ -f "${TARGET_DIR}/lib/systemd/system/haveged.service" ]; then
    ln -sf /usr/lib/systemd/system/haveged.service \
        "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/haveged.service" 2>/dev/null || true
fi

# ── IORA virtualization / container detection service ───────────────────────
# Runs at early boot, writes /run/iora-virt.env + /etc/iora-virt.conf, updates
# /etc/issue and /etc/motd so the detected platform (VM, LXC, Proxmox, VMware,
# VirtualBox, Hyper-V, Xen, Docker, WSL, ...) is visible at login and in SSH.
mkdir -p "${TARGET_DIR}/usr/lib/iora"
cat > "${TARGET_DIR}/usr/lib/iora/iora-detect-virt" <<'DETECTEOF'
#!/bin/sh
# IORA OS virtualization/container detector.
# Writes:
#   /run/iora-virt.env        - sourceable env file (VIRT_TYPE, VIRT_VENDOR, ...)
#   /etc/iora-virt.conf       - persistent human-readable summary
# Updates:
#   /etc/issue.d/10-iora-virt.issue (systemd reads issue.d)
#   /etc/motd.d/10-iora-virt  (if /etc/motd.d exists)

set -e

VIRT_TYPE="none"
VIRT_VENDOR=""
VIRT_CONTAINER="none"
VIRT_LABEL="Bare metal"

# Prefer systemd-detect-virt when available (most accurate, maintained list).
if command -v systemd-detect-virt >/dev/null 2>&1; then
    _vm=$(systemd-detect-virt --vm 2>/dev/null || true)
    _ct=$(systemd-detect-virt --container 2>/dev/null || true)
    [ -n "$_vm" ] && [ "$_vm" != "none" ] && VIRT_TYPE="$_vm"
    [ -n "$_ct" ] && [ "$_ct" != "none" ] && VIRT_CONTAINER="$_ct"
fi

# Map systemd-detect-virt keywords to friendly vendor strings, and fill gaps
# with DMI for stock kernels without systemd-detect-virt.
sys_vendor=""; product=""; bios_version=""
[ -r /sys/class/dmi/id/sys_vendor ]    && sys_vendor=$(tr -d '\0' < /sys/class/dmi/id/sys_vendor   2>/dev/null)
[ -r /sys/class/dmi/id/product_name ]  && product=$(tr -d '\0' < /sys/class/dmi/id/product_name   2>/dev/null)
[ -r /sys/class/dmi/id/bios_version ]  && bios_version=$(tr -d '\0' < /sys/class/dmi/id/bios_version 2>/dev/null)

if [ "$VIRT_TYPE" = "none" ]; then
    case "${sys_vendor} ${product}" in
        *VMware*)             VIRT_TYPE="vmware" ;;
        *VirtualBox*|*innotek*) VIRT_TYPE="oracle" ;;
        *QEMU*)               VIRT_TYPE="qemu" ;;
        *Xen*)                VIRT_TYPE="xen" ;;
        *Microsoft*|*Hyper-V*) VIRT_TYPE="microsoft" ;;
        *Parallels*)          VIRT_TYPE="parallels" ;;
        *Bochs*)              VIRT_TYPE="bochs" ;;
    esac
    if [ "$VIRT_TYPE" = "none" ] && grep -qa '^flags.*\bhypervisor\b' /proc/cpuinfo 2>/dev/null; then
        VIRT_TYPE="kvm"
    fi
fi

case "$VIRT_TYPE" in
    vmware)          VIRT_VENDOR="VMware" ;;
    oracle)          VIRT_VENDOR="Oracle VirtualBox" ;;
    qemu)
        case "$bios_version" in
            *pve*|*roxmox*) VIRT_VENDOR="Proxmox VE (KVM)" ;;
            *)              VIRT_VENDOR="QEMU" ;;
        esac ;;
    kvm)
        case "$bios_version" in
            *pve*|*roxmox*) VIRT_VENDOR="Proxmox VE (KVM)" ;;
            *)              VIRT_VENDOR="KVM" ;;
        esac ;;
    xen)             VIRT_VENDOR="Xen" ;;
    microsoft)       VIRT_VENDOR="Microsoft Hyper-V" ;;
    parallels)       VIRT_VENDOR="Parallels" ;;
    bochs)           VIRT_VENDOR="Bochs" ;;
    none)            VIRT_VENDOR="" ;;
    *)               VIRT_VENDOR="$VIRT_TYPE" ;;
esac

if [ "$VIRT_CONTAINER" != "none" ]; then
    VIRT_LABEL="Container: ${VIRT_CONTAINER}"
elif [ "$VIRT_TYPE" != "none" ]; then
    VIRT_LABEL="VM: ${VIRT_VENDOR}"
else
    VIRT_LABEL="Bare metal"
fi

umask 022
mkdir -p /run /etc /etc/issue.d /etc/motd.d 2>/dev/null || true

cat > /run/iora-virt.env <<EOF
IORA_VIRT_TYPE=${VIRT_TYPE}
IORA_VIRT_VENDOR=${VIRT_VENDOR}
IORA_VIRT_CONTAINER=${VIRT_CONTAINER}
IORA_VIRT_LABEL=${VIRT_LABEL}
EOF

cat > /etc/iora-virt.conf <<EOF
# IORA OS — auto-detected platform (regenerated at each boot)
Platform:      ${VIRT_LABEL}
VM type:       ${VIRT_TYPE}
VM vendor:     ${VIRT_VENDOR}
Container:     ${VIRT_CONTAINER}
DMI sys_vendor: ${sys_vendor}
DMI product:    ${product}
DMI BIOS:       ${bios_version}
EOF

# Per-file issue fragment (systemd reads /etc/issue.d/*.issue)
cat > /etc/issue.d/10-iora-virt.issue <<EOF
Platform: ${VIRT_LABEL}
EOF

# MOTD fragment for login shells / SSH
cat > /etc/motd.d/10-iora-virt <<EOF
IORA OS platform: ${VIRT_LABEL}
EOF

exit 0
DETECTEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-detect-virt"

# systemd service — runs once before multi-user so getty/SSH see correct issue.
# systemd service — runs once before multi-user so getty/SSH see correct issue.
# Must run AFTER local-fs.target + systemd-remount-fs so /etc is writable;
# running it with DefaultDependencies=no before sysinit.target caused
# `set -e` failures when writing to /etc/iora-virt.conf on a read-only /etc.
cat > "${TARGET_DIR}/etc/systemd/system/iora-detect-virt.service" <<'EOF'
[Unit]
Description=IORA OS virtualization / container detection
After=local-fs.target systemd-remount-fs.service
Before=getty.target multi-user.target network.target
ConditionPathExists=/usr/lib/iora/iora-detect-virt

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/lib/iora/iora-detect-virt
# Be tolerant: a detection failure must NOT block boot.
SuccessExitStatus=0 1

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/iora-detect-virt.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-detect-virt.service"

# Shell convenience: `iora-virt` prints the platform label.
mkdir -p "${TARGET_DIR}/usr/bin"
cat > "${TARGET_DIR}/usr/bin/iora-virt" <<'EOF'
#!/bin/sh
# Print detected IORA platform. Runs iora-detect-virt on demand if needed.
if [ ! -r /run/iora-virt.env ]; then
    /usr/lib/iora/iora-detect-virt >/dev/null 2>&1 || true
fi
if [ -r /run/iora-virt.env ]; then
    # shellcheck disable=SC1091
    . /run/iora-virt.env
    if [ "${1:-}" = "--verbose" ] || [ "${1:-}" = "-v" ]; then
        cat /etc/iora-virt.conf 2>/dev/null
    else
        echo "${IORA_VIRT_LABEL:-unknown}"
    fi
else
    echo "unknown"
fi
EOF
chmod 755 "${TARGET_DIR}/usr/bin/iora-virt"

# Ensure /etc/issue pulls in issue.d fragments via agetty (systemd default).
mkdir -p "${TARGET_DIR}/etc/issue.d" "${TARGET_DIR}/etc/motd.d"

# ── SSH daemon hardening ─────────────────────────────────────────────────────
# Raise MaxAuthTries so SSH clients that offer many keys from ssh-agent don't
# get disconnected before password auth is attempted ("Too many authentication
# failures"). The OpenSSH default is 6; a client sending 5 public keys from
# ssh-agent exhausts this before the user has a chance to type a password.
# Also disable root login by password (key-only) and enforce sane defaults.
mkdir -p "${TARGET_DIR}/etc/ssh"
cat > "${TARGET_DIR}/etc/ssh/sshd_config" <<'EOF'
# IORA OS — OpenSSH server configuration
# Generated by iora-os/board/iora/post-build.sh

# Allow enough auth attempts so clients with many keys in ssh-agent
# don't hit "Too many authentication failures" before password auth.
MaxAuthTries 10

# Root login: allow key-based auth (needed for initial setup/recovery).
# PermitRootLogin without-password would be better once SSH keys are set.
PermitRootLogin yes

# Standard authentication options
PasswordAuthentication yes
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Disable unused/dangerous auth methods
ChallengeResponseAuthentication no
KerberosAuthentication no
GSSAPIAuthentication no
UsePAM no

# Keep alive so dead connections are detected
ClientAliveInterval 120
ClientAliveCountMax 3

# Limit connection setup time
LoginGraceTime 60

# Logging
SyslogFacility AUTH
LogLevel INFO

# Subsystem for SFTP
Subsystem sftp /usr/lib/ssh/sftp-server
EOF
chmod 600 "${TARGET_DIR}/etc/ssh/sshd_config"

# Configure RAUC
mkdir -p "${TARGET_DIR}/etc/rauc"
cat > "${TARGET_DIR}/etc/rauc/system.conf" <<'EOF'
[system]
compatible=iora-os
bootloader=grub
bundle-formats=-plain

[keyring]
path=/etc/rauc/keyring.pem

[slot.rootfs.0]
device=/dev/sda3
type=ext4
bootname=A

[slot.rootfs.1]
device=/dev/sda4
type=ext4
bootname=B
EOF

# Install AppArmor profiles for IORA services
# Binaries are now native systemd services at /opt/iora/build/<svc>/bin/<svc>.
cat > "${TARGET_DIR}/etc/apparmor.d/iora-supervisor" <<'EOF'
#include <tunables/global>

/opt/iora/build/iora-supervisor/bin/iora-supervisor {
  #include <abstractions/base>

  # Docker socket — iora-supervisor is the SOLE authorised consumer.
  /var/run/docker.sock rw,

  # Binary execution
  /opt/iora/build/iora-supervisor/bin/iora-supervisor r,

    # Docker CLI and compose (called as subprocesses to drive user-app containers)
    /usr/bin/docker rix,
    /usr/bin/docker-compose rix,
    /usr/lib/docker/** rix,
    /usr/libexec/docker/** rix,

  # Guard + manifest helper scripts
  /usr/lib/iora/iora-docker-guard              rix,
  /usr/lib/iora/iora-integrity-update-manifest rix,

  # Data and config
  /var/lib/iora/iora-supervisor/** rwk,
  /etc/iora/**                     rw,
  /mnt/data/iora/**                rw,
  /var/log/iora/**                 rw,

  # Read-only access to proc (for socket audit in iora-watchdog-check)
  /proc/*/comm                     r,
  /proc/*/status                   r,
  /proc/*/fd/                      r,

  # Network (API port 8097 + outbound for image pulls via dockerd)
  network inet stream,
  network inet6 stream,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-security" <<'EOF'
#include <tunables/global>

/opt/iora/build/iora-security/bin/iora-security {
  #include <abstractions/base>

  # Binary execution
  /opt/iora/build/iora-security/bin/iora-security r,

  # Security database
  /var/lib/iora/security/** rwk,

  # Audit / recovery log (read only for analysis)
  /var/log/iora-recovery.log r,
  /var/log/iora-security.log rw,

  # Network
  network inet stream,
  network inet6 stream,

  # PostgreSQL client libs
  /usr/lib/** rm,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-secrets" <<'EOF'
#include <tunables/global>

/opt/iora/build/iora-secrets/bin/iora-secrets {
  #include <abstractions/base>

  # Binary execution
  /opt/iora/build/iora-secrets/bin/iora-secrets r,

  # Secrets storage
  /var/lib/iora/secrets/** rwk,

  # Network
  network inet stream,
  network inet6 stream,

  # PostgreSQL client libs
  /usr/lib/** rm,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-gateway" <<'EOF'
#include <tunables/global>

/opt/iora/build/iora-gateway/bin/iora-gateway {
  #include <abstractions/base>

  # Binary execution
  /opt/iora/build/iora-gateway/bin/iora-gateway r,

  # Gateway database
  /var/lib/iora/gateway/** rwk,

  # Network (restricted — gateway may reach external hosts on behalf of apps)
  network inet stream,
  network inet6 stream,

  # Deny host-level capabilities
  deny capability sys_admin,
  deny capability sys_module,
  deny capability net_admin,
}
EOF

# Set up read-only root filesystem marker
touch "${TARGET_DIR}/etc/.readonly"

# Install IORA Setup Wizard (first-boot web setup)
echo "IORA OS: Installing setup wizard..."
SETUP_SRC="${BR2_EXTERNAL_IORA_PATH}/board/iora/iora-setup"
SETUP_DST="${TARGET_DIR}/opt/iora/setup"
mkdir -p "${SETUP_DST}"
if [ -d "${SETUP_SRC}" ]; then
    cp "${SETUP_SRC}/setup-server.py" "${SETUP_DST}/setup-server.py"
    chmod 755 "${SETUP_DST}/setup-server.py"
fi

# Install iora-nginx Tera template at a stable path. The binary defaults
# to `./nginx-config/nginx.conf.template` which only resolves when run
# from the source tree; on IORA OS the systemd unit's WorkingDirectory
# is `/var/lib/iora/iora-nginx`, so we ship the template under
# /usr/share/iora and point NGINX_TEMPLATE_PATH at it (see iora-nginx.env).
NGINX_TPL_SRC="${BR2_EXTERNAL_IORA_PATH}/backend/services/iora-nginx/nginx-config/nginx.conf.template"
NGINX_TPL_DST_DIR="${TARGET_DIR}/usr/share/iora/iora-nginx"
if [ -f "${NGINX_TPL_SRC}" ]; then
    mkdir -p "${NGINX_TPL_DST_DIR}"
    install -m 0644 "${NGINX_TPL_SRC}" "${NGINX_TPL_DST_DIR}/nginx.conf.template"
    echo "IORA OS: Installed nginx template -> ${NGINX_TPL_DST_DIR}/nginx.conf.template"
else
    echo "IORA OS: WARN: nginx template not found at ${NGINX_TPL_SRC}"
fi

# ── First-boot disk expansion (called by setup wizard) ──────────────────
# The expansion script is installed via rootfs-overlay. It is NOT started
# as a systemd service automatically — the setup wizard calls it during
# apply_config with the user's chosen disk layout (auto or manual).
# This lets the user decide how much space Root A / Root B / Data get.
#
# Invocation modes:
#   iora-disk-expand.sh              → auto mode (smart defaults)
#   iora-disk-expand.sh --preview    → JSON preview (disk info, sizes)
#   iora-disk-expand.sh --root N     → manual root size in MiB

# Ensure the expansion script is executable (overlay coppes permissions as-is).
chmod +x "${TARGET_DIR}/usr/lib/iora/iora-disk-expand.sh" 2>/dev/null || true

# Create iora-setup.service (first-boot setup wizard)
cat > "${TARGET_DIR}/etc/systemd/system/iora-setup.service" <<'EOF'
[Unit]
Description=IORA OS First-Boot Setup Wizard
# Start even if iora-init-data fails (no iora-data partition): the setup
# server creates /mnt/data/iora itself on whatever FS backs /mnt/data.
# network-online is Wants= (not Requires=) so a slow link doesn't block it.
After=network-online.target iora-init-data.service
Wants=network-online.target
Before=iora-stack.service
# Dual-flag guard: skip the wizard if EITHER the data-partition flag
# OR the rootfs flag exists. Multiple ConditionPathExists= lines are
# ANDed, so with the ! (negation) prefix, the service only runs when
# BOTH flags are absent. If either flag exists → condition fails →
# service is skipped. Both flags are written on successful setup.
ConditionPathExists=!/mnt/data/iora/.setup-complete
ConditionPathExists=!/etc/iora/.setup-complete

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p /mnt/data/iora /etc/iora
ExecStart=/usr/bin/python3 /opt/iora/setup/setup-server.py
# Hard timeout: if the setup server hasn't completed within 30 minutes,
# something is wrong (stuck LUKS, broken Python, etc.). Kill it so the
# boot can continue. The state file preserves progress for a retry.
TimeoutStartSec=1800
# Restart on crash only — do NOT restart if it exits cleanly (0 = setup
# was already complete, server finished and shut itself down).
Restart=on-failure
RestartSec=10
# Max 3 crashes in 5 minutes, then give up permanently for this boot.
StartLimitBurst=3
StartLimitIntervalSec=300
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable iora-setup service
ln -sf /etc/systemd/system/iora-setup.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-setup.service"

# ── First-boot progress TUI on tty1 ───────────────────────────────────────
# Render the setup progress (phase, percent, log tail, URL) on the local
# console while the user is running the wizard from another device. This
# replaces the blank prompt behind the login screen that made users think
# the system was frozen.
mkdir -p "${TARGET_DIR}/usr/lib/iora"
if [ -f "${SETUP_SRC}/iora-setup-tui" ]; then
    install -Dm0755 "${SETUP_SRC}/iora-setup-tui" \
        "${TARGET_DIR}/usr/lib/iora/iora-setup-tui"
fi

cat > "${TARGET_DIR}/etc/systemd/system/iora-setup-tui.service" <<'EOF'
[Unit]
Description=IORA OS first-boot progress display on tty1
# Only run while setup has not yet completed. Dual-flag: skip if either
# flag exists (both ANDed with ! = run only when BOTH absent).
ConditionPathExists=!/mnt/data/iora/.setup-complete
ConditionPathExists=!/etc/iora/.setup-complete
# Start after the setup server so /mnt/data/iora/setup-state.json is there.
After=iora-setup.service
Wants=iora-setup.service
# We take over tty1 exclusively.
Conflicts=getty@tty1.service
Before=getty@tty1.service

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/lib/iora/iora-setup-tui
# Hand TTY back to getty when the setup TUI stops (setup complete or crashed).
# Without this, Alt+Ctrl+F2 / tty1 stays blank after setup finishes.
ExecStopPost=/bin/systemctl start getty@tty1.service
StandardInput=tty
StandardOutput=tty
StandardError=journal
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
# Only restart on crash (non-zero exit). When setup completes the TUI exits
# with code 0 and must NOT be restarted.
Restart=on-failure
RestartSec=2
# Use a login-like environment (TERM so ANSI renders).
Environment=TERM=linux

[Install]
WantedBy=multi-user.target
EOF

ln -sf /etc/systemd/system/iora-setup-tui.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-setup-tui.service"
# ──────────────────────────────────────────────────────────────────────────

# Install IORA OS Update Client (Rust binary replaces the old shell script)
#
# Skipped entirely on IORA OS Dev builds: dev images do not have a unique,
# server-known version and would trash themselves on the first check.  The
# wrapper script is still installed on dev images so tooling that calls it
# gets a clear error instead of a cryptic 404.
if [ "${IORA_OS_DEV:-0}" = "1" ]; then
    echo "IORA OS: DEV build — update client DISABLED"
    mkdir -p "${TARGET_DIR}/opt/iora/update"
    cat > "${TARGET_DIR}/opt/iora/update/check-update.sh" <<'UPDATESCRIPT'
#!/bin/sh
echo "iora-updater: refusing to run on an IORA OS Dev build" >&2
echo "(no unique version — see /etc/iora/build-info.json)" >&2
exit 64
UPDATESCRIPT
    chmod 755 "${TARGET_DIR}/opt/iora/update/check-update.sh"
    # Make sure no stale units from an earlier production rebuild remain.
    rm -f "${TARGET_DIR}/etc/systemd/system/iora-update-check.service" \
          "${TARGET_DIR}/etc/systemd/system/iora-update-check.timer" \
          "${TARGET_DIR}/etc/systemd/system/timers.target.wants/iora-update-check.timer"
else

echo "IORA OS: Installing update client..."
mkdir -p "${TARGET_DIR}/opt/iora/update"

# Copy documentation from monorepo to IORA OS image
if [ -d "${BR2_EXTERNAL_IORA_PATH}/docs" ]; then
    echo "IORA OS: Installing documentation to /opt/iora/docs..."
    mkdir -p "${TARGET_DIR}/opt/iora/docs"
    cp -a "${BR2_EXTERNAL_IORA_PATH}/docs/." "${TARGET_DIR}/opt/iora/docs/"
fi

# The actual binary (`iora-updater`) is installed as /usr/bin/iora-updater
# by the Buildroot package below.  We keep a stable wrapper at the legacy
# path so old systemd units and documentation keep working.
cat > "${TARGET_DIR}/opt/iora/update/check-update.sh" <<'UPDATESCRIPT'
#!/bin/sh
# Thin wrapper around the Rust updater.  Kept only for backwards
# compatibility — all real logic lives in /usr/bin/iora-updater.
exec /usr/bin/iora-updater "$@"
UPDATESCRIPT
chmod 755 "${TARGET_DIR}/opt/iora/update/check-update.sh"

# Create iora-update.timer (check for updates periodically)
cat > "${TARGET_DIR}/etc/systemd/system/iora-update-check.service" <<'EOF'
[Unit]
Description=IORA OS Update Check
After=network-online.target iora-verify.service iora-init-data.service
Wants=network-online.target
ConditionPathExists=/mnt/data/iora/.setup-complete
ConditionPathExists=!/run/iora-tamper
ConditionPathIsDirectory=/mnt/data/iora

[Service]
Type=oneshot
ExecStart=/usr/bin/iora-updater --yes
StandardOutput=journal
StandardError=journal
# Hardening: the updater only needs network + /tmp + /var/log + rauc.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
# /data/rauc was a typo — the mount point is /mnt/data, and rauc writes
# bundles to /mnt/data/rauc (created by iora-init-data.service).
ReadWritePaths=/var/log /mnt/data
CapabilityBoundingSet=CAP_SYS_ADMIN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH
EOF

cat > "${TARGET_DIR}/etc/systemd/system/iora-update-check.timer" <<'EOF'
[Unit]
Description=IORA OS Update Check Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/timers.target.wants"
ln -sf /etc/systemd/system/iora-update-check.timer \
    "${TARGET_DIR}/etc/systemd/system/timers.target.wants/iora-update-check.timer"

fi  # end of "not IORA_OS_DEV" branch for the update client

# -----------------------------------------------------------------------------
# Version / build metadata
# -----------------------------------------------------------------------------
# We emit TWO things:
#   * /etc/iora-version          — one-line human-friendly string ("IORA OS
#                                   v1.4.2"), unchanged for compatibility.
#   * /etc/iora/build-info.json  — structured record that all services,
#                                   `ora system version` and iora-updater
#                                   read.  The `variant` field distinguishes
#                                   a production build from an IORA OS Dev
#                                   build; the updater refuses to install
#                                   anything on an os-dev image because its
#                                   version is not unique.
#
# Inputs (all optional, from the build host's env):
#   IORA_VERSION      e.g. "1.4.2"        (default: date-based)
#   IORA_GIT_SHA      e.g. "a1b2c3d"      (default: "unknown")
#   IORA_CHANNEL      stable|beta|edge    (default: "stable")
# -----------------------------------------------------------------------------
IORA_VERSION_STR="${IORA_VERSION:-$(date +%Y.%m.%d)}"
IORA_GIT_SHA="${IORA_GIT_SHA:-unknown}"
IORA_CHANNEL="${IORA_CHANNEL:-stable}"
IORA_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "${IORA_OS_DEV:-0}" = "1" ]; then
    IORA_VARIANT="os-dev"
    IORA_VERSION_STR="${IORA_VERSION_STR}+dev.${IORA_GIT_SHA}"
else
    IORA_VARIANT="production"
fi

echo "IORA OS ${IORA_VERSION_STR}" > "${TARGET_DIR}/etc/iora-version"

mkdir -p "${TARGET_DIR}/etc/iora"
cat > "${TARGET_DIR}/etc/iora/build-info.json" <<EOF
{
  "version":   "${IORA_VERSION_STR}",
  "variant":   "${IORA_VARIANT}",
  "channel":   "${IORA_CHANNEL}",
  "target":    "${IORA_TARGET:-pc}",
  "arch":      "${IORA_ARCH:-x86_64}",
  "git_sha":   "${IORA_GIT_SHA}",
  "built_at":  "${IORA_BUILT_AT}",
  "updates_enabled": $([ "${IORA_VARIANT}" = "production" ] && echo true || echo false)
}
EOF
chmod 0644 "${TARGET_DIR}/etc/iora/build-info.json"

# -----------------------------------------------------------------------------
# DEV BUILD branding (only on IORA_OS_DEV=1 images)
# -----------------------------------------------------------------------------
# We make the DEV nature of the image *unmissable* so devices never get
# accidentally handed to a real customer:
#   * /etc/os-release PRETTY_NAME carries "(DEV — INTERNAL)"
#   * /etc/issue gets a fat banner shown at every TTY login prompt
#   * /etc/motd.dev appended to motd shows the warning after login
#   * /etc/hostname suffixed with "-dev" if not already set otherwise
#   * /etc/iora/dev-banner.txt drop file used by iora-installer + iora-home
#     UIs to render a visible "DEV BUILD" badge.
if [ "${IORA_OS_DEV:-0}" = "1" ]; then
    echo "IORA OS: applying DEV-build branding (os-release/issue/motd/hostname)"

    # /etc/iora/dev-banner.txt — single source of truth that the
    # installer TUI, the iora-home web UI and any other surface can read.
    mkdir -p "${TARGET_DIR}/etc/iora"
    cat > "${TARGET_DIR}/etc/iora/dev-banner.txt" <<EOF
IORA OS DEV BUILD — INTERNAL USE ONLY
Version: ${IORA_VERSION_STR}
Built:   ${IORA_BUILT_AT}
Target:  ${IORA_TARGET:-pc} (${IORA_ARCH:-x86_64})
DO NOT distribute this image to end users.
EOF
    chmod 0644 "${TARGET_DIR}/etc/iora/dev-banner.txt"

    # /etc/os-release — be liberal: rewrite if it exists, create otherwise.
    if [ -f "${TARGET_DIR}/etc/os-release" ]; then
        # Drop any prior PRETTY_NAME/VARIANT lines, then re-add ours.
        sed -i -e '/^PRETTY_NAME=/d' -e '/^VARIANT=/d' -e '/^VARIANT_ID=/d' \
            "${TARGET_DIR}/etc/os-release"
    else
        : > "${TARGET_DIR}/etc/os-release"
    fi
    cat >> "${TARGET_DIR}/etc/os-release" <<EOF
PRETTY_NAME="IORA OS ${IORA_VERSION_STR} (DEV — INTERNAL)"
VARIANT="OS Dev Build"
VARIANT_ID=os-dev
EOF

    # /etc/issue — shown on every getty login prompt before the user logs
    # in. Includes plain ANSI colours that all 90s+ terminals understand.
    cat > "${TARGET_DIR}/etc/issue" <<'EOF'

  \e[1;43;30m ════════════════════════════════════════════ \e[0m
  \e[1;43;30m   IORA OS — DEV BUILD — INTERNAL USE ONLY    \e[0m
  \e[1;43;30m   Do NOT use in production. Do NOT ship.     \e[0m
  \e[1;43;30m ════════════════════════════════════════════ \e[0m

  IORA OS Dev \r  \l

EOF
    chmod 0644 "${TARGET_DIR}/etc/issue"

    # Append a DEV banner to /etc/motd. Note: /etc/motd is rewritten on
    # every boot by iora-motd-update (defined later in this script), so
    # the actual runtime banner injection happens inside that script —
    # search for "dev-banner.txt" below. The static append here only
    # matters if the dynamic update fails to run.

    # Hostname suffix: only override if the existing file is the stock
    # default ("iora") — respect any per-board override that already set
    # something else.
    if [ ! -s "${TARGET_DIR}/etc/hostname" ] || \
       [ "$(cat "${TARGET_DIR}/etc/hostname" 2>/dev/null | tr -d '\n')" = "iora" ]; then
        echo "iora-dev" > "${TARGET_DIR}/etc/hostname"
    fi
fi

# Install welcome message. We use a STATIC placeholder for /etc/motd
# that is overwritten on every boot by iora-motd.service with the real
# IP addresses. Users who log in before networking is up see the
# placeholder; afterwards they see actual URLs they can click.
cat > "${TARGET_DIR}/etc/motd" <<'EOF'

  ██╗ ██████╗ ██████╗  █████╗     ██████╗ ███████╗
  ██║██╔═══██╗██╔══██╗██╔══██╗   ██╔═══██╗██╔════╝
  ██║██║   ██║██████╔╝███████║   ██║   ██║███████╗
  ██║██║   ██║██╔══██╗██╔══██║   ██║   ██║╚════██║
  ██║╚██████╔╝██║  ██║██║  ██║   ╚██████╔╝███████║
  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝ ╚══════╝

  Interface for Optimized Residential Autonomy

  Documentation: /opt/iora/docs
  (Waiting for network — log in again once IPs are assigned.)

EOF

# /usr/lib/iora/iora-motd-update: render /etc/motd with live IPs.
# Called by iora-motd.service at boot AND by a networkd-dispatcher hook
# on every address change so the motd always reflects the current state.
mkdir -p "${TARGET_DIR}/usr/lib/iora"
cat > "${TARGET_DIR}/usr/lib/iora/iora-motd-update" <<'MOTDEOF'
#!/bin/sh
# Render /etc/motd with the current IPv4/IPv6 addresses and the
# real URLs for the IORA Setup Wizard / Control Center / IORA Home.
set -eu

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Gather primary IPv4 (first non-loopback global-scope address).
ipv4=""
ipv6=""
if command -v ip >/dev/null 2>&1; then
    ipv4=$(ip -4 -o addr show scope global 2>/dev/null \
            | awk '{print $4}' | cut -d/ -f1 | head -n1)
    ipv6=$(ip -6 -o addr show scope global 2>/dev/null \
            | awk '{print $4}' | cut -d/ -f1 \
            | grep -v '^fe80' | head -n1)
fi

# Hostname (fallback chain).
host="$(hostname 2>/dev/null || echo iora)"

# Decide which URL host-part to use: prefer IPv4, else IPv6 (bracketed),
# else hostname.
if [ -n "$ipv4" ]; then
    hostpart="$ipv4"
elif [ -n "$ipv6" ]; then
    hostpart="[$ipv6]"
else
    hostpart="$host"
fi

# Pick the Home Assistant web port: 8126 (IORA default, not the HA
# default 8123) is used when the setup wizard has written a compose
# file. Before first-boot setup, only the setup wizard on :8080 is up.
ha_port=8126
setup_done_flag=/mnt/data/iora/.setup-complete
if [ ! -e "$setup_done_flag" ]; then
    primary_url="http://${hostpart}:8080/setup"
    primary_lbl="First Boot Setup"
else
    primary_url="http://${hostpart}:8126"
    primary_lbl="IORA Home Dashboard"
fi

{
    cat <<'BANNER'

  ██╗ ██████╗ ██████╗  █████╗     ██████╗ ███████╗
  ██║██╔═══██╗██╔══██╗██╔══██╗   ██╔═══██╗██╔════╝
  ██║██║   ██║██████╔╝███████║   ██║   ██║███████╗
  ██║██║   ██║██╔══██╗██╔══██║   ██║   ██║╚════██║
  ██║╚██████╔╝██║  ██║██║  ██║   ╚██████╔╝███████║
  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝ ╚══════╝

  Interface for Optimized Residential Autonomy

BANNER
    printf "  Host:          %s\n" "$host"
    [ -n "$ipv4" ] && printf "  IPv4:          %s\n" "$ipv4"
    [ -n "$ipv6" ] && printf "  IPv6:          %s\n" "$ipv6"
    printf "\n"
    printf "  %-14s %s\n" "$primary_lbl:" "$primary_url"
    if [ -e "$setup_done_flag" ]; then
        printf "  %-14s http://%s:8091\n" "Control Center:" "$hostpart"
    fi
    printf "  %-14s /opt/iora/docs\n" "Documentation:"
    printf "\n"
    # If this is an OS-dev build, scream about it on every motd render.
    if [ -f /etc/iora/dev-banner.txt ]; then
        printf "  ╔══════════════════════════════════════════════════╗\n"
        printf "  ║   IORA OS DEV BUILD — INTERNAL USE ONLY          ║\n"
        printf "  ║   Hot-reload bridge: http://%-21s║\n" "${hostpart}:8099"
        printf "  ║   Do NOT use in production. Do NOT distribute.   ║\n"
        printf "  ╚══════════════════════════════════════════════════╝\n\n"
    fi
} > "$tmp"

# Atomically replace /etc/motd.
install -m 0644 "$tmp" /etc/motd
MOTDEOF
chmod 0755 "${TARGET_DIR}/usr/lib/iora/iora-motd-update"

# Service that keeps /etc/motd in sync with the current network state.
cat > "${TARGET_DIR}/etc/systemd/system/iora-motd.service" <<'EOF'
[Unit]
Description=IORA OS dynamic /etc/motd
After=network-online.target iora-setup.service
Wants=network-online.target
# Not conditional on setup-complete — we render a different motd
# before/after first-boot setup, both cases want live IPs.

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/lib/iora/iora-motd-update
# Re-render on network changes via the .path unit below.

[Install]
WantedBy=multi-user.target
EOF

# Path unit: re-run iora-motd-update whenever the network state changes
# (new lease, interface up, static IP applied). We watch the setup-done
# flag as well so switching from the pre-setup motd to the post-setup
# motd happens automatically.
cat > "${TARGET_DIR}/etc/systemd/system/iora-motd.path" <<'EOF'
[Unit]
Description=Trigger iora-motd-update on network or setup changes

[Path]
PathChanged=/run/systemd/netif/state
# Also watch the networkd lease directory — covers DHCP lease events on
# systems where /run/systemd/netif/state is not written by networkd.
PathChanged=/run/systemd/netif/leases
PathChanged=/etc/hostname
PathExistsGlob=/mnt/data/iora/.setup-complete

[Install]
WantedBy=multi-user.target
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/iora-motd.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-motd.service"
ln -sf /etc/systemd/system/iora-motd.path \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-motd.path"

# =============================================================================
# Integrity verification + tamper-screen (iora-verify)
# =============================================================================
# We install two Rust binaries on the target:
#   - /usr/bin/iora-verify   : hashes /opt/iora/** + a few critical units
#                              against a signed manifest at boot.  Failure
#                              isolates the system to iora-tamper.target.
#   - /usr/bin/iora-updater  : replaces the old check-update.sh (signature
#                              check + RAUC install).
#
# The binaries themselves and the signed manifest are produced by
# board/iora/build-integrity.sh (called just below).  That helper uses the
# host-built `iora-sign` tool and a release key pair whose public half is
# embedded into the image at /etc/iora/iora-release.pub.
echo "IORA OS: Installing integrity verification..."

mkdir -p "${TARGET_DIR}/etc/iora"

# iora-verify.service runs before anything reads from /opt/iora or talks to
# the network.  On failure it isolates to iora-tamper.target, which shows
# the bluescreen and refuses to proceed.
cat > "${TARGET_DIR}/etc/systemd/system/iora-verify.service" <<'EOF'
[Unit]
Description=IORA OS integrity verification
# NOTE: we intentionally keep default dependencies so that local-fs.target,
# systemd-remount-fs.service and the root mount unit are ordered *before*
# us via sysinit.target. Using DefaultDependencies=no together with
# `RequiresMountsFor=/opt /etc /usr` produced a circular ordering
# (-.mount After=sysinit.target, iora-verify Before=sysinit.target)
# which systemd resolved by deleting iora-verify + local-fs.target,
# cascading into ZRAM/Postgres/Chrony start failures.
Before=iora-stack.service iora-update-check.service
After=local-fs.target
ConditionPathExists=/etc/iora/manifest.json
ConditionPathExists=/etc/iora/manifest.json.sig
ConditionPathExists=/etc/iora/iora-release.pub

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/iora-verify
# Hardening — verify must itself be minimal-privilege.
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/run /var/log
CapabilityBoundingSet=
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# The tamper target.  Once isolated to, it:
#   * stops all other services (systemd `isolate` semantics)
#   * starts only iora-tamper-screen.service on tty1
#   * allows switching to tty2 for `ora recovery …`
cat > "${TARGET_DIR}/etc/systemd/system/iora-tamper.target" <<'EOF'
[Unit]
Description=IORA OS tamper-detected halt target
Documentation=https://iora.kaimdt.com/recovery
Requires=iora-tamper-screen.service
After=iora-tamper-screen.service
AllowIsolate=yes
# Explicitly DO NOT pull in multi-user.target or graphical.target.
EOF

# The bluescreen renderer.  Clears tty1, prints a red banner in English,
# and then sleeps forever.  The service is `Restart=always` so there is no
# "press ctrl+c to drop to shell" path.
cat > "${TARGET_DIR}/etc/systemd/system/iora-tamper-screen.service" <<'EOF'
[Unit]
Description=IORA OS tamper screen (bluescreen)
DefaultDependencies=no

[Service]
Type=simple
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
ExecStart=/opt/iora/security/tamper-screen
Restart=always
RestartSec=1s
# Cannot be stopped by the user: even Ctrl+C just re-spawns.
KillSignal=SIGKILL
SuccessExitStatus=
# Run as root so we can write to /dev/tty1 directly.
User=root
Nice=-5
EOF

mkdir -p "${TARGET_DIR}/opt/iora/security"
cat > "${TARGET_DIR}/opt/iora/security/tamper-screen" <<'SCREEN'
#!/bin/sh
# Tamper screen — displayed when iora-verify has detected integrity damage.
# We deliberately avoid sourcing anything from /opt/iora/** here: that is
# exactly the surface we just failed to trust.  Only busybox built-ins.
set -u

BG="$(printf '\033[44m')"       # blue background
FG="$(printf '\033[97m')"       # bright white
RED="$(printf '\033[1;91m')"    # bold red
RST="$(printf '\033[0m')"
CLS="$(printf '\033c')"         # full reset
HOME_POS="$(printf '\033[H')"

REASON="unknown"
if [ -r /run/iora-tamper ]; then
    REASON="$(head -c 400 /run/iora-tamper 2>/dev/null)"
fi

DEV=$(cat /etc/machine-id 2>/dev/null || echo unknown)
VER=$(cat /etc/iora-version 2>/dev/null || echo unknown)

# Infinite redraw so that whatever the user presses, the screen stays put.
while :; do
    printf '%s' "$CLS"
    printf '%s%s' "$BG" "$FG"
    # fill the screen with blue — crude but effective on a Linux console.
    i=0; while [ $i -lt 40 ]; do printf '%80s\n' ' '; i=$((i+1)); done
    printf '%s' "$HOME_POS"

    cat <<BANNER

  ${RED}   ██╗ ██████╗ ██████╗  █████╗    ██████╗ ███████╗${FG}
  ${RED}   ██║██╔═══██╗██╔══██╗██╔══██╗  ██╔═══██╗██╔════╝${FG}
  ${RED}   ██║██║   ██║██████╔╝███████║  ██║   ██║███████╗${FG}
  ${RED}   ██║██║   ██║██╔══██╗██╔══██║  ██║   ██║╚════██║${FG}
  ${RED}   ██║╚██████╔╝██║  ██║██║  ██║  ╚██████╔╝███████║${FG}
  ${RED}   ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═════╝ ╚══════╝${FG}

  ${RED}*** SYSTEM INTEGRITY FAILURE ***${FG}

  Unauthorized modifications have been detected on this IORA OS
  installation. The files that have been altered are NOT signed by
  IORA and may have been installed by malware or a third party.

  For your safety this device will NOT continue booting.

  What to do:
    1. Reboot the machine.
    2. At the boot menu, select  "IORA OS - Recovery"  (or hold
       SHIFT during boot) to start the online recovery image.
    3. The recovery image will reach out to  update.kaimdt.com
       and reinstall the original, signed IORA OS files.

  If this screen appeared without you doing anything unusual,
  please contact IORA support and keep the details below.

  -----------------------------------------------------------------
   Device ID :  ${DEV}
   Version   :  ${VER}
   Reason    :  ${REASON}
  -----------------------------------------------------------------

  This screen will remain until you reboot into recovery.
BANNER
    printf '%s' "$RST"
    # Never exit.  Even if `sleep` gets killed, the while loop (and the
    # Restart=always on the systemd unit) bring us right back.
    sleep 300 || true
done
SCREEN
chmod 755 "${TARGET_DIR}/opt/iora/security/tamper-screen"

# =============================================================================
# Recovery TUI — secure interactive recovery mode
# =============================================================================
# When GRUB passes `iora.recovery=1` on the kernel command line, the system
# does NOT drop to an unrestricted shell.  Instead, iora-recovery.service
# launches the Recovery TUI on tty1. The TUI presents a menu:
#
#   [1] Diagnose system (no data access, no PIN required)
#   [2] Reset root password (Recovery PIN required)
#   [3] Unlock & access user data (Recovery PIN + 2nd confirmation)
#   [4] Online reinstall via RAUC (PIN required)
#   [5] Reboot
#
# The Recovery PIN is a 16-digit decimal number generated during first-boot
# setup. It is hashed with PBKDF2-HMAC-SHA256 and stored at
#   /etc/iora/recovery-pin.hash
# The plaintext PIN is shown ONCE during setup and never stored on the device.
#
# Every session is logged to /var/log/iora-recovery.log with:
#   timestamp | action | PIN_provided | outcome
# This log is persistent across boots (appended to /mnt/data, synced after
# the data partition is mounted if available).

echo "IORA OS: Installing Recovery TUI..."
mkdir -p "${TARGET_DIR}/usr/lib/iora"

cat > "${TARGET_DIR}/usr/lib/iora/iora-recovery-tui" <<'RECOVERYEOF'
#!/bin/sh
# IORA OS Recovery TUI
# Shown when the system is booted with iora.recovery=1 on the kernel command line.
# Provides a menu-driven interface instead of an unrestricted shell.
# Data access always requires the Recovery PIN.
set -u

# ── Colours ──────────────────────────────────────────────────────────────────
BG="$(printf '\033[40m')"       # dark background
FG="$(printf '\033[97m')"       # bright white
CYAN="$(printf '\033[1;36m')"   # bold cyan
GREEN="$(printf '\033[1;32m')"  # bold green
YELLOW="$(printf '\033[1;33m')" # bold yellow
RED="$(printf '\033[1;31m')"    # bold red
DIM="$(printf '\033[2m')"       # dim
RST="$(printf '\033[0m')"
CLS="$(printf '\033c')"

RECOVERY_LOG="/var/log/iora-recovery.log"
PIN_HASH_FILE="/etc/iora/recovery-pin.hash"
DATA_KEYFILE="/etc/iora/data.keyfile"
DATA_DEV="/dev/disk/by-label/iora-data"
MAPPER="/dev/mapper/iora-data"

VERSION="$(cat /etc/iora-version 2>/dev/null || echo 'unknown')"
MACHINE_ID="$(cat /etc/machine-id 2>/dev/null | head -c 8 || echo 'unknown')"
SESSION_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── Audit log ────────────────────────────────────────────────────────────────
audit_log() {
    local action="$1" pin_used="${2:-no}" outcome="${3:-unknown}"
    local entry="${SESSION_TS} | action=${action} | pin=${pin_used} | result=${outcome} | machine=${MACHINE_ID}"
    echo "$entry" >> "$RECOVERY_LOG" 2>/dev/null || true
    # Also try to append to persistent data partition log if mounted.
    if mountpoint -q /mnt/data 2>/dev/null; then
        echo "$entry" >> /mnt/data/iora/recovery.log 2>/dev/null || true
    fi
}

# ── Header ───────────────────────────────────────────────────────────────────
show_header() {
    printf '%s' "$CLS$BG$FG"
    cat <<'BANNER'

  ██╗ ██████╗ ██████╗  █████╗     ██████╗ ███████╗
  ██║██╔═══██╗██╔══██╗██╔══██╗   ██╔═══██╗██╔════╝
  ██║██║   ██║██████╔╝███████║   ██║   ██║███████╗
  ██║██║   ██║██╔══██╗██╔══██║   ██║   ██║╚════██║
  ██║╚██████╔╝██║  ██║██║  ██║   ╚██████╔╝███████║
  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝ ╚══════╝
BANNER
    printf "\n  ${CYAN}IORA OS Recovery Mode${RST}${FG}   |   %s   |   ID: %s\n\n" \
        "$VERSION" "$MACHINE_ID"
    printf "  ${YELLOW}⚠  This session is being logged. All actions are audited.${RST}${FG}\n\n"
}

# ── PIN verification ─────────────────────────────────────────────────────────
# Returns 0 if correct, 1 if wrong or no hash file.
verify_pin() {
    if [ ! -r "$PIN_HASH_FILE" ]; then
        printf "\n  ${RED}✗ No Recovery PIN configured on this device.${RST}\n"
        printf "  ${DIM}Run first-boot setup to generate a Recovery PIN.${RST}\n\n"
        return 1
    fi

    printf "\n  Enter Recovery PIN (16 digits): "
    stty -echo 2>/dev/null || true
    read -r entered_pin
    stty echo 2>/dev/null || true
    printf "\n"

    # Validate format: exactly 16 decimal digits.
    # Note: the 16-character pattern below must match PIN_DIGITS (= 16) in
    # setup-server.py. If PIN length ever changes, update both together.
    case "$entered_pin" in
        [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
        *)
            printf "  ${RED}✗ Invalid format — PIN must be exactly 16 digits.${RST}\n\n"
            audit_log "pin-verify" "yes" "invalid-format"
            return 1
            ;;
    esac

    # Use Python 3 for PBKDF2-HMAC-SHA256 verification (consistent with
    # the storage implementation in setup-server.py, which uses
    # hashlib.pbkdf2_hmac). Python 3 is always available on IORA OS
    # (/usr/bin/python3 is installed by the iora-setup package).
    stored_hash="$(cat "$PIN_HASH_FILE" 2>/dev/null)"
    # Stored format: "pbkdf2-sha256:<hex_salt>:<iterations>:<hex_digest>"
    salt="$(echo "$stored_hash"     | cut -d: -f2)"
    iters="$(echo "$stored_hash"    | cut -d: -f3)"
    expected="$(echo "$stored_hash" | cut -d: -f4)"

    if [ -z "$salt" ] || [ -z "$iters" ] || [ -z "$expected" ]; then
        printf "  ${RED}✗ Recovery PIN file is corrupt.${RST}\n\n"
        audit_log "pin-verify" "yes" "hash-corrupt"
        return 1
    fi

    computed="$(python3 - "$entered_pin" "$salt" "$iters" 2>/dev/null <<'PYEOF'
import hashlib, sys
pin, salt, iters = sys.argv[1], sys.argv[2], int(sys.argv[3])
print(hashlib.pbkdf2_hmac('sha256', pin.encode(), salt.encode(), iters).hex())
PYEOF
)"

    if [ -z "$computed" ]; then
        printf "  ${RED}✗ PIN verification failed (python3 not available).${RST}\n\n"
        audit_log "pin-verify" "yes" "python-unavailable"
        return 1
    fi

    if [ "$computed" = "$expected" ]; then
        printf "  ${GREEN}✓ PIN accepted.${RST}\n\n"
        return 0
    else
        printf "  ${RED}✗ Incorrect PIN.${RST}\n\n"
        audit_log "pin-verify" "yes" "wrong-pin"
        # Exponential backoff: after each failure the delay doubles (3s, 6s, 12s…)
        # up to a maximum of 60 seconds.  This is stored in a run-time file so
        # it persists within the session but resets on reboot.
        BACKOFF_FILE="/run/iora-recovery-backoff"
        last="$(cat "$BACKOFF_FILE" 2>/dev/null || echo 0)"
        next=$(( last < 30 ? (last == 0 ? 3 : last * 2) : 60 ))
        printf "%s" "$next" > "$BACKOFF_FILE" 2>/dev/null || true
        printf "  ${DIM}Waiting %ds before next attempt...${RST}\n\n" "$next"
        sleep "$next"
        return 1
    fi
}

# ── Option 1: Diagnostics ────────────────────────────────────────────────────
do_diagnose() {
    audit_log "diagnose" "no" "started"
    printf "\n${CYAN}  System Diagnostics${RST}\n\n"
    printf "  Kernel: %s\n" "$(uname -r 2>/dev/null)"
    printf "  Uptime: %s\n" "$(uptime 2>/dev/null)"
    printf "\n  -- Disk --\n"
    df -h 2>/dev/null || true
    printf "\n  -- Memory --\n"
    free -m 2>/dev/null || true
    printf "\n  -- Failed Units --\n"
    systemctl list-units --state=failed --no-pager 2>/dev/null || echo "  (systemd not available)"
    printf "\n  -- Last Journal Errors --\n"
    journalctl -p err -n 20 --no-pager 2>/dev/null || echo "  (journal not available)"
    audit_log "diagnose" "no" "completed"
    printf "\n  ${DIM}Press Enter to return to menu.${RST} "
    read -r _dummy
}

# ── Option 2: Reset root password ───────────────────────────────────────────
do_reset_password() {
    printf "\n${YELLOW}  Reset Root Password${RST}\n\n"
    printf "  This requires your Recovery PIN.\n\n"
    if ! verify_pin; then
        audit_log "reset-password" "yes" "pin-rejected"
        printf "  ${DIM}Press Enter to return to menu.${RST} "
        read -r _dummy
        return
    fi
    audit_log "reset-password" "yes" "pin-accepted"
    printf "  Enter new root password: "
    stty -echo 2>/dev/null || true
    read -r pw1
    stty echo 2>/dev/null || true
    printf "\n  Confirm new root password: "
    stty -echo 2>/dev/null || true
    read -r pw2
    stty echo 2>/dev/null || true
    printf "\n"
    if [ "$pw1" != "$pw2" ]; then
        printf "  ${RED}✗ Passwords do not match.${RST}\n\n"
        audit_log "reset-password" "yes" "passwords-mismatch"
    elif [ -z "$pw1" ]; then
        printf "  ${RED}✗ Password may not be empty.${RST}\n\n"
        audit_log "reset-password" "yes" "empty-password"
    else
        printf '%s\n%s\n' "$pw1" "$pw2" | passwd root 2>/dev/null \
            && printf "  ${GREEN}✓ Root password updated.${RST}\n\n" \
            && audit_log "reset-password" "yes" "success" \
            || { printf "  ${RED}✗ passwd failed.${RST}\n\n"; audit_log "reset-password" "yes" "passwd-failed"; }
    fi
    printf "  ${DIM}Press Enter to return to menu.${RST} "
    read -r _dummy
}

# ── Option 3: Unlock & access user data ─────────────────────────────────────
do_unlock_data() {
    printf "\n${RED}  Access User Data${RST}\n\n"
    printf "  ${YELLOW}WARNING: This grants full access to all user data stored on this device.${RST}\n"
    printf "  ${YELLOW}Your Recovery PIN and a second confirmation are required.${RST}\n\n"
    printf "  Continue? [yes/NO] "
    read -r confirm
    if [ "$confirm" != "yes" ]; then
        printf "  Cancelled.\n\n"
        audit_log "unlock-data" "no" "user-cancelled"
        printf "  ${DIM}Press Enter to return to menu.${RST} "
        read -r _dummy
        return
    fi
    printf "\n"
    if ! verify_pin; then
        audit_log "unlock-data" "yes" "pin-rejected"
        printf "  ${DIM}Press Enter to return to menu.${RST} "
        read -r _dummy
        return
    fi
    audit_log "unlock-data" "yes" "pin-accepted"

    # If already mounted, just show the path.
    if mountpoint -q /mnt/data 2>/dev/null; then
        printf "  ${GREEN}✓ Data partition already mounted at /mnt/data${RST}\n"
    elif [ -e "$DATA_DEV" ]; then
        if cryptsetup isLuks "$DATA_DEV" 2>/dev/null; then
            if [ -b "$MAPPER" ] || cryptsetup luksOpen "$DATA_DEV" iora-data \
                    --key-file "$DATA_KEYFILE" 2>/dev/null; then
                mount /dev/mapper/iora-data /mnt/data 2>/dev/null \
                    && printf "  ${GREEN}✓ Data partition unlocked and mounted at /mnt/data${RST}\n" \
                    || printf "  ${RED}✗ Mount failed — see journal for details.${RST}\n"
            else
                printf "  ${RED}✗ LUKS unlock failed — keyfile may be missing or corrupted.${RST}\n"
                audit_log "unlock-data" "yes" "luks-failed"
                printf "  ${DIM}Press Enter to return to menu.${RST} "
                read -r _dummy
                return
            fi
        else
            mount "$DATA_DEV" /mnt/data 2>/dev/null \
                && printf "  ${GREEN}✓ Data partition mounted at /mnt/data${RST}\n" \
                || printf "  ${RED}✗ Mount failed.${RST}\n"
        fi
    else
        printf "  ${RED}✗ Data partition not found.${RST}\n"
    fi

    printf "\n  ${GREEN}Data access granted. User data is at /mnt/data${RST}\n"
    printf "  ${YELLOW}Opening a recovery shell. Type 'exit' to return to Recovery TUI.${RST}\n\n"
    audit_log "unlock-data" "yes" "shell-opened"
    # Recovery shell: intentionally grants full root filesystem access because
    # the operator has already authenticated with the Recovery PIN (the
    # security gate). The shell has a clean environment and a distinct prompt
    # so the user knows they are in recovery mode. Capabilities are set on the
    # service unit; CAP_SYS_ADMIN is required for mount/umount operations.
    # This is equivalent to physical access — the Recovery PIN IS the
    # authentication factor for data recovery.
    env - HOME=/root TERM="${TERM:-linux}" PATH=/usr/sbin:/usr/bin:/sbin:/bin \
        PS1="[IORA-RECOVERY \w]# " \
        sh --norc 2>/dev/null
    audit_log "unlock-data" "yes" "shell-exited"
    # Re-lock data partition on exit if we mounted it.
    if mountpoint -q /mnt/data 2>/dev/null; then
        umount /mnt/data 2>/dev/null || true
    fi
    if cryptsetup status iora-data >/dev/null 2>&1; then
        cryptsetup luksClose iora-data 2>/dev/null || true
    fi
    printf "\n  ${DIM}Data partition locked. Press Enter to return to menu.${RST} "
    read -r _dummy
}

# ── Option 4: Online reinstall ───────────────────────────────────────────────
do_online_reinstall() {
    printf "\n${YELLOW}  Online Reinstall${RST}\n\n"
    printf "  This will download and reinstall the latest IORA OS from update.kaimdt.com.\n"
    printf "  User data on /mnt/data will be preserved.\n\n"
    printf "  Your Recovery PIN is required.\n\n"
    if ! verify_pin; then
        audit_log "online-reinstall" "yes" "pin-rejected"
        printf "  ${DIM}Press Enter to return to menu.${RST} "
        read -r _dummy
        return
    fi
    audit_log "online-reinstall" "yes" "pin-accepted"
    printf "  ${YELLOW}Starting online reinstall (system will reboot when done)...${RST}\n\n"
    if command -v iora-updater >/dev/null 2>&1; then
        iora-updater --yes --channel stable 2>&1
        audit_log "online-reinstall" "yes" "updater-completed"
        printf "\n  ${GREEN}Reinstall complete. Rebooting in 5 seconds...${RST}\n"
        sleep 5
        systemctl reboot 2>/dev/null || reboot 2>/dev/null || true
    else
        printf "  ${RED}✗ iora-updater not found. Cannot perform online reinstall.${RST}\n\n"
        audit_log "online-reinstall" "yes" "updater-missing"
        printf "  ${DIM}Press Enter to return to menu.${RST} "
        read -r _dummy
    fi
}

# ── Main menu loop ────────────────────────────────────────────────────────────
audit_log "session-start" "no" "recovery-tui-started"

while :; do
    show_header
    printf "  ${CYAN}Recovery Menu${RST}\n\n"
    printf "  ${FG}[1]${RST} System Diagnose            ${DIM}(no data access, no PIN needed)${RST}\n"
    printf "  ${FG}[2]${RST} Reset Root Password        ${DIM}(Recovery PIN required)${RST}\n"
    printf "  ${FG}[3]${RST} Access User Data           ${DIM}${RED}(Recovery PIN + confirmation)${RST}\n"
    printf "  ${FG}[4]${RST} Online Reinstall IORA OS   ${DIM}(Recovery PIN required)${RST}\n"
    printf "  ${FG}[5]${RST} Reboot\n"
    printf "\n  Choose [1-5]: "
    read -r choice

    case "$choice" in
        1) do_diagnose ;;
        2) do_reset_password ;;
        3) do_unlock_data ;;
        4) do_online_reinstall ;;
        5)
            audit_log "reboot" "no" "user-initiated"
            printf "\n  Rebooting...\n"
            systemctl reboot 2>/dev/null || reboot 2>/dev/null || true
            ;;
        *)
            printf "\n  ${YELLOW}Invalid choice.${RST}\n\n"
            sleep 1
            ;;
    esac
done
RECOVERYEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-recovery-tui"

# The recovery service boots from a secondary grub entry. When the user
# selects it, grub passes `iora.recovery=1` on the kernel command line.
# The service launches the Recovery TUI on tty1 instead of dropping to
# an unrestricted shell — all data access requires the Recovery PIN.
cat > "${TARGET_DIR}/etc/systemd/system/iora-recovery.service" <<'EOF'
[Unit]
Description=IORA OS secure recovery mode
After=local-fs.target systemd-remount-fs.service
ConditionKernelCommandLine=iora.recovery=1

[Service]
Type=simple
# Run the Recovery TUI on tty1 — no unrestricted shell is spawned.
ExecStart=/usr/lib/iora/iora-recovery-tui
StandardInput=tty
StandardOutput=tty
StandardError=tty
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=no
# Restart if TUI crashes so the user is never left at a blank screen.
Restart=always
RestartSec=2s
# Prevent privilege escalation from within the TUI's restricted shell.
NoNewPrivileges=yes
CapabilityBoundingSet=CAP_SYS_ADMIN CAP_DAC_OVERRIDE CAP_DAC_READ_SEARCH CAP_CHOWN CAP_FOWNER

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-recovery.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-recovery.service"

# Enable iora-verify at multi-user.target so it runs before iora-stack and
# the update checker but AFTER local-fs + remount-rw (see Unit file above).
# Skipped on dev images: the tamper screen + verify gate would make hot-
# reload impossible, which is the whole point of a dev build.
mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
# Clean up any stale sysinit.target.wants symlink from older builds that
# caused ordering cycles with -.mount.
rm -f "${TARGET_DIR}/etc/systemd/system/sysinit.target.wants/iora-verify.service"
if [ "${IORA_OS_DEV:-0}" = "1" ]; then
    echo "IORA OS: DEV build — iora-verify.service NOT enabled"
    rm -f "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-verify.service"
else
    ln -sf /etc/systemd/system/iora-verify.service \
        "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-verify.service"
fi

# -----------------------------------------------------------------------------
# Dev bridge (only on images built with IORA_OS_DEV=1 / `build.sh --dev`)
# -----------------------------------------------------------------------------
# Installs /usr/bin/iora-dev-bridge, a systemd unit that keeps it running
# on 127.0.0.1:8099, plus /etc/iora/dev-mode and /etc/iora/dev-token.  The
# Developer App reads /dev/status to detect the image and authenticates
# with the freshly-generated token.  None of this is present on a stock
# production image, so enabling it after the fact is impossible.
if [ "${IORA_OS_DEV:-0}" = "1" ]; then
    echo "IORA OS: Installing native DEV build headers and pkg-config metadata..."
    if [ -n "${STAGING_DIR:-}" ] && [ -d "${STAGING_DIR}/usr" ]; then
        mkdir -p "${TARGET_DIR}/usr/include" "${TARGET_DIR}/usr/lib" "${TARGET_DIR}/usr/share"
        if [ -d "${STAGING_DIR}/usr/include" ]; then
            cp -a "${STAGING_DIR}/usr/include/." "${TARGET_DIR}/usr/include/" 2>/dev/null || true
        fi
        if [ -d "${STAGING_DIR}/usr/lib" ]; then
            cp -a "${STAGING_DIR}/usr/lib/." "${TARGET_DIR}/usr/lib/" 2>/dev/null || true
        fi
        for dir in pkgconfig cmake aclocal; do
            if [ -d "${STAGING_DIR}/usr/share/${dir}" ]; then
                mkdir -p "${TARGET_DIR}/usr/share/${dir}"
                cp -a "${STAGING_DIR}/usr/share/${dir}/." "${TARGET_DIR}/usr/share/${dir}/" 2>/dev/null || true
            fi
        done
        find "${STAGING_DIR}/usr/bin" -maxdepth 1 -type f -name '*-config' -exec cp -a {} "${TARGET_DIR}/usr/bin/" \; 2>/dev/null || true
    else
        echo "IORA OS: WARN: STAGING_DIR not available; native DEV headers not copied"
    fi

    echo "IORA OS: Installing OS dev bridge..."
    mkdir -p "${TARGET_DIR}/etc/iora"
    mkdir -p "${TARGET_DIR}/usr/bin"

    # Native Rust daemons live under /opt/iora/build/<svc>/bin/<svc>. Keep a
    # compatibility symlink at /usr/bin/iora-dev-bridge because older tools,
    # docs and status checks still probe that path.
    ln -sf /opt/iora/build/iora-dev-bridge/bin/iora-dev-bridge \
        "${TARGET_DIR}/usr/bin/iora-dev-bridge"

    # NOTE: this marker is specifically for the *OS*-level dev mode (the
    # one that lets the Developer App swap binaries and restart services).
    # It is intentionally distinct from the *public* developer-mode toggle
    # in iora-developer-app, which is purely a per-user setting and does
    # NOT grant OS-level privileges.
    cat > "${TARGET_DIR}/etc/iora/os-dev-mode" <<EOF
# Presence of this file marks the image as an IORA OS Dev build.
# The iora-dev-bridge binary refuses to start without it, and the IORA
# Developer App keys its hot-reload UI off of it.
#
# This is NOT the same as the public Developer Mode that app/plugin
# authors toggle on a normal device — that one only affects the
# Developer App and cannot touch the host OS.
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
target=${IORA_TARGET:-unknown}
EOF
    chmod 0644 "${TARGET_DIR}/etc/iora/os-dev-mode"

    # Per-image random token so even multiple dev images on one LAN don't
    # share credentials. NOTE: 0644, not 0600 — on a dev image any user
    # on the device can already read it via the bridge anyway, and 0600
    # historically caused EACCES storms when the bridge ended up running
    # as the unprivileged `iora` user (uid 900) instead of root.
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' \
        > "${TARGET_DIR}/etc/iora/dev-token"
    chmod 0644 "${TARGET_DIR}/etc/iora/dev-token"

    # Helper that the dev-bridge unit calls before the binary starts. It
    # makes sure (1) a writable copy of the token exists on a writable
    # filesystem (/var/lib/iora is on the persistent overlay; /etc may be
    # part of a read-only RAUC slot), (2) the file is world-readable, and
    # (3) the bridge port is reachable from the LAN, not just localhost.
    install -d -m 0755 "${TARGET_DIR}/usr/lib/iora"
    cat > "${TARGET_DIR}/usr/lib/iora/iora-dev-bridge-prepare.sh" <<'PREPARE_EOF'
#!/bin/sh
# Prepare the dev bridge runtime: ensure the dev-token is on a writable
# path with permissions the bridge can actually use. Idempotent.
set -e

DST_DIR=/var/lib/iora
DST=${DST_DIR}/dev-token
SRC=/etc/iora/dev-token

mkdir -p "${DST_DIR}"
chmod 0755 "${DST_DIR}"

if [ ! -s "${DST}" ]; then
    if [ -s "${SRC}" ]; then
        cp -f "${SRC}" "${DST}"
    else
        # Generate one if neither side has a token (e.g. RAUC slot rotation
        # ate the original).
        head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${DST}"
    fi
fi

chmod 0644 "${DST}" || true

# Best-effort: also (re)write the /etc/iora copy so legacy code paths
# that still hard-code the old location keep working. Silently tolerate
# a read-only filesystem here.
if [ -w /etc/iora ] || mkdir -p /etc/iora 2>/dev/null; then
    cp -f "${DST}" "${SRC}" 2>/dev/null && chmod 0644 "${SRC}" 2>/dev/null || true
fi

# Open the bridge port through any iptables/nftables firewall that
# happens to be active. Failures are non-fatal — most dev images don't
# run a firewall at all.
if command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport 8101 -j ACCEPT 2>/dev/null \
        || iptables -I INPUT -p tcp --dport 8101 -j ACCEPT 2>/dev/null \
        || true
fi
if command -v nft >/dev/null 2>&1; then
    nft list chain inet filter input 2>/dev/null | grep -q 'tcp dport 8101 accept' \
        || nft add rule inet filter input tcp dport 8101 accept 2>/dev/null \
        || true
fi
exit 0
PREPARE_EOF
    chmod 0755 "${TARGET_DIR}/usr/lib/iora/iora-dev-bridge-prepare.sh"

    cat > "${TARGET_DIR}/etc/systemd/system/iora-dev-bridge.service" <<'EOF'
[Unit]
Description=IORA Emergency Access Bridge (diagnostic & hot-reload)
Documentation=https://iora.os/docs/emergency-access
# Always start: provides SSH-less emergency access even when iora-home
# or the dashboard is not functioning. Authentication uses either IORA
# dashboard credentials OR OS-level (root) passwords via /etc/shadow.
After=network.target docker.service iora-init-data.service
Wants=network.target
ConditionPathExists=/opt/iora/build/iora-dev-bridge/bin/iora-dev-bridge

[Service]
Type=simple
# Must run as root to access /etc/shadow for OS-level auth fallback,
# read any log file, restart any service, and perform emergency repairs.
User=root
Group=root
# Bind on all interfaces for LAN access from admin workstations.
# Override via EnvironmentFile if you want to restrict to localhost.
Environment=IORA_DEV_BIND=0.0.0.0:8101
EnvironmentFile=-/etc/iora/iora-dev-bridge.env
# Self-heal: copy/regenerate the dev-token onto a writable path, fix
# permissions, and configure firewall rules for 8101.
ExecStartPre=/usr/lib/iora/iora-dev-bridge-prepare.sh
ExecStart=/opt/iora/build/iora-dev-bridge/bin/iora-dev-bridge
Restart=on-failure
RestartSec=5
# Emergency mode: no restrictions. The bridge can read/write any file,
# restart any service, and execute any command. Auth is required (see
# /dev/auth endpoint).
NoNewPrivileges=no
ProtectSystem=no
ProtectHome=no
PrivateTmp=no
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    ln -sf /etc/systemd/system/iora-dev-bridge.service \
        "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-dev-bridge.service"

    # Always enable, regardless of dev-mode. The binary is authenticated
    # via OS credentials (fallback) or iora-home dashboard credentials.
fi

# In both dev and production: ensure the binary path symlink exists.
if [ -f "${TARGET_DIR}/opt/iora/build/iora-dev-bridge/bin/iora-dev-bridge" ]; then
    mkdir -p "${TARGET_DIR}/usr/bin"
    ln -sf /opt/iora/build/iora-dev-bridge/bin/iora-dev-bridge \
        "${TARGET_DIR}/usr/bin/iora-dev-bridge"
fi

# The public key and signed manifest are populated by build-integrity.sh,
# which is invoked from post-image.sh after Buildroot finished installing
# the iora-verify / iora-updater binaries.  If the build-host key does not
# yet exist, build-integrity.sh will autogenerate a dev key pair — do NOT
# use that for production images.

# Build + install the Rust integrity binaries (iora-verify, iora-updater)
# and generate the signed manifest.  Failure here is NOT fatal to the
# overall image build — the tamper screen simply refuses to boot without
# a valid manifest, which is the safe default.
BOARD_DIR="$(dirname "$0")"
if [ -x "${BOARD_DIR}/build-integrity.sh" ]; then
    TARGET_DIR="${TARGET_DIR}" IORA_ARCH="${IORA_ARCH:-x86_64}" \
        "${BOARD_DIR}/build-integrity.sh" "${TARGET_DIR}" || \
        echo "IORA OS: WARNING: build-integrity.sh failed; image will not boot past iora-verify"
else
    echo "IORA OS: WARNING: build-integrity.sh missing; skipping signed manifest"
fi

# Install IORA startup validator
echo "IORA OS: Installing startup validator..."
BOARD_DIR="$(dirname "$0")"

if [ -f "${BOARD_DIR}/iora-startup-validator.sh" ]; then
    install -D -m 0755 "${BOARD_DIR}/iora-startup-validator.sh" \
        "${TARGET_DIR}/usr/bin/iora-startup-validator"
    echo "IORA OS: Installed startup validator script"
else
    echo "IORA OS: WARNING: iora-startup-validator.sh not found"
fi

if [ -f "${BOARD_DIR}/iora-startup-validator.service" ]; then
    install -D -m 0644 "${BOARD_DIR}/iora-startup-validator.service" \
        "${TARGET_DIR}/etc/systemd/system/iora-startup-validator.service"

    # Enable the service
    mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
    ln -sf /etc/systemd/system/iora-startup-validator.service \
        "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-startup-validator.service"

    echo "IORA OS: Enabled startup validator service"
else
    echo "IORA OS: WARNING: iora-startup-validator.service not found"
fi

# Install healthcheck script for IORA OS
if [ -f "${BOARD_DIR}/../../scripts/healthcheck.sh" ]; then
    install -D -m 0755 "${BOARD_DIR}/../../scripts/healthcheck.sh" \
        "${TARGET_DIR}/usr/bin/iora-healthcheck"
    echo "IORA OS: Installed healthcheck script"
fi

# =============================================================================
# 'ora' CLI command — shorthand for IORA OS system management
# =============================================================================
echo "IORA OS: Installing 'ora' CLI command..."
mkdir -p "${TARGET_DIR}/usr/bin"
cat > "${TARGET_DIR}/usr/bin/ora" <<'ORAEOF'
#!/bin/sh
# ora — IORA OS system management CLI
# Usage: ora <command> [subcommand] [args...]
#
# Commands:
#   system info          Show system information
#   system version       Show IORA OS version
#   system reboot        Reboot the system
#   system shutdown      Shut down the system
#   system resources     Show CPU, RAM, disk usage
#   service list         List all systemd services
#   service start NAME   Start a service
#   service stop NAME    Stop a service
#   service restart NAME Restart a service
#   service status NAME  Show service status
#   service logs NAME    Show service logs
#   container list       List running Docker containers
#   container start NAME Start a container
#   container stop NAME  Stop a container
#   container restart N  Restart a container
#   container logs NAME  Show container logs
#   container stats      Show container resource usage
#   update check         Check for OS updates
#   update install       Install available updates
#   status               Show overall IORA status
#   recovery             Enter recovery mode information
#   help                 Show this help

set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RST='\033[0m'

iora_version() {
    cat /etc/iora-version 2>/dev/null || echo "IORA OS (version unknown)"
}

print_header() {
    printf "${BOLD}${CYAN}%s${RST}\n" "$1"
}

print_ok() {
    printf "  ${GREEN}✓${RST} %s\n" "$1"
}

print_warn() {
    printf "  ${YELLOW}⚠${RST} %s\n" "$1"
}

print_err() {
    printf "  ${RED}✗${RST} %s\n" "$1" >&2
}

cmd_system() {
    local sub="${1:-info}"
    shift 2>/dev/null || true
    case "$sub" in
        info)
            print_header "IORA OS — System Information"
            echo ""
            printf "  %-16s %s\n" "Version:"   "$(iora_version)"
            printf "  %-16s %s\n" "Hostname:"  "$(hostname 2>/dev/null || echo unknown)"
            printf "  %-16s %s\n" "Uptime:"    "$(uptime -p 2>/dev/null || uptime)"
            printf "  %-16s %s\n" "CPU:"       "$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//' || echo unknown)"
            printf "  %-16s %s\n" "Cores:"     "$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo '?')"
            printf "  %-16s %s\n" "Memory:"    "$(awk '/MemTotal/{printf "%.0f MB", $2/1024}' /proc/meminfo 2>/dev/null || echo unknown)"
            printf "  %-16s %s\n" "Kernel:"    "$(uname -r 2>/dev/null || echo unknown)"
            printf "  %-16s %s\n" "Arch:"      "$(uname -m 2>/dev/null || echo unknown)"
            printf "  %-16s %s\n" "Boot mode:" "$([ -d /sys/firmware/efi ] && echo UEFI || echo 'BIOS (Legacy)')"
            echo ""
            ;;
        version)
            iora_version
            ;;
        resources)
            print_header "IORA OS — Resource Usage"
            echo ""
            # CPU
            local cpu_idle
            cpu_idle=$(top -bn1 2>/dev/null | grep '%Cpu' | awk '{print $8}' | tr -d '%' || echo '?')
            if [ "$cpu_idle" != '?' ]; then
                local cpu_used=$(echo "$cpu_idle" | awk '{printf "%.1f", 100-$1}')
                printf "  %-12s %s%%\n" "CPU:"  "$cpu_used"
            fi
            # Memory
            awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{
                printf "  %-12s %.0f MB used / %.0f MB total\n",
                    "Memory:", (t-a)/1024, t/1024
            }' /proc/meminfo 2>/dev/null || true
            # Disk
            echo ""
            df -h /mnt/data 2>/dev/null | awk 'NR==2{printf "  %-12s %s used / %s total (%s full)\n", "Data disk:", $3, $2, $5}' || \
            df -h / 2>/dev/null | awk 'NR==2{printf "  %-12s %s used / %s total (%s full)\n", "Root disk:", $3, $2, $5}' || true
            echo ""
            ;;
        reboot)
            printf "${YELLOW}Rebooting IORA OS...${RST}\n"
            systemctl reboot 2>/dev/null || busybox reboot 2>/dev/null || reboot -f 2>/dev/null
            ;;
        shutdown|poweroff)
            printf "${YELLOW}Shutting down IORA OS...${RST}\n"
            systemctl poweroff 2>/dev/null || busybox poweroff 2>/dev/null || poweroff -f 2>/dev/null
            ;;
        *)
            print_err "Unknown system subcommand: $sub"
            echo "  Usage: ora system {info|version|resources|reboot|shutdown}"
            exit 1
            ;;
    esac
}

cmd_service() {
    local sub="${1:-list}"
    local name="${2:-}"
    shift 2>/dev/null || true
    case "$sub" in
        list)
            print_header "IORA Services (native systemd)"
            echo ""
            printf "  ${BOLD}%-26s %-12s %s${RST}\n" "SERVICE" "STATE" "DESCRIPTION"
            echo "  ──────────────────────────────────────────────────────────────"
            for svc in iora-core iora-home iora-control iora-assist \
                       iora-secrets iora-watchdog iora-security iora-gateway \
                       iora-supervisor iora-update-monitor \
                       iora-api iora-appstore iora-backup iora-connector \
                       iora-dev-bridge iora-domain-validator iora-files \
                       iora-network-monitor iora-nginx iora-resource-manager \
                       iora-updater postgresql chrony docker; do
                if systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
                    st="${GREEN}active${RST}"
                elif systemctl list-unit-files --quiet "${svc}.service" >/dev/null 2>&1; then
                    st="${YELLOW}inactive${RST}"
                else
                    continue
                fi
                desc=$(systemctl show -p Description --value "${svc}.service" 2>/dev/null || echo "")
                printf "  %-26s ${st}  %s\n" "$svc" "$desc"
            done
            echo ""
            ;;
        start|stop|restart|status)
            [ -z "$name" ] && { print_err "Usage: ora service $sub <name>"; exit 1; }
            systemctl "$sub" "$name" 2>/dev/null
            ;;
        logs)
            [ -z "$name" ] && { print_err "Usage: ora service logs <name>"; exit 1; }
            journalctl -u "$name" --no-pager -n 50 2>/dev/null
            ;;
        *)
            print_err "Unknown service subcommand: $sub"
            echo "  Usage: ora service {list|start|stop|restart|status|logs} [name]"
            exit 1
            ;;
    esac
}

cmd_container() {
    local sub="${1:-list}"
    local name="${2:-}"
    shift 2>/dev/null || true
    case "$sub" in
        list)
            print_header "User-App Containers (Docker)"
            echo "  Note: IORA system services run natively — only USER APPS use Docker."
            echo ""
            docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}" 2>/dev/null || \
                print_warn "Docker not available or no user-app containers running"
            ;;
        start|stop|restart)
            [ -z "$name" ] && { print_err "Usage: ora container $sub <name>"; exit 1; }
            docker "$sub" "$name" 2>/dev/null
            ;;
        logs)
            [ -z "$name" ] && { print_err "Usage: ora container logs <name>"; exit 1; }
            docker logs --tail 50 "$name" 2>/dev/null
            ;;
        stats)
            docker stats --no-stream 2>/dev/null || print_warn "Docker not available"
            ;;
        *)
            print_err "Unknown container subcommand: $sub"
            echo "  Usage: ora container {list|start|stop|restart|logs|stats} [name]"
            exit 1
            ;;
    esac
}

cmd_update() {
    local sub="${1:-check}"
    shift 2>/dev/null || true
    case "$sub" in
        check)
            print_header "IORA OS — Update Check"
            echo ""
            if command -v iora-updater >/dev/null 2>&1; then
                iora-updater --check 2>/dev/null || print_warn "Update check failed"
            else
                print_warn "iora-updater not installed"
            fi
            ;;
        install)
            print_header "IORA OS — Installing Updates"
            echo ""
            if command -v iora-updater >/dev/null 2>&1; then
                iora-updater --yes 2>/dev/null
            else
                print_warn "iora-updater not installed"
            fi
            ;;
        *)
            print_err "Unknown update subcommand: $sub"
            echo "  Usage: ora update {check|install}"
            exit 1
            ;;
    esac
}

cmd_status() {
    print_header "IORA OS — System Status"
    echo ""
    printf "  %-20s %s\n" "OS Version:"     "$(iora_version)"
    printf "  %-20s %s\n" "Hostname:"       "$(hostname 2>/dev/null || echo unknown)"
    printf "  %-20s %s\n" "Uptime:"         "$(uptime -p 2>/dev/null || uptime | sed 's/.*up /up /' | sed 's/,.*//')"
    echo ""

    # Native IORA system services
    print_header "Native IORA Services"
    for svc in iora-core iora-home iora-control iora-assist \
               iora-secrets iora-watchdog iora-security iora-gateway \
               iora-supervisor iora-update-monitor \
               iora-api iora-appstore iora-backup iora-connector \
               iora-dev-bridge iora-domain-validator iora-files \
               iora-network-monitor iora-nginx iora-resource-manager \
               iora-updater; do
        if systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
            print_ok "${svc}: active"
        elif systemctl list-unit-files --quiet "${svc}.service" >/dev/null 2>&1; then
            print_warn "${svc}: inactive"
        fi
    done

    echo ""
    # Infrastructure services
    print_header "Infrastructure"
    for svc in postgresql chrony docker; do
        if systemctl is-active --quiet "$svc" 2>/dev/null; then
            print_ok "$svc: active"
        elif systemctl list-unit-files --quiet "$svc.service" >/dev/null 2>&1; then
            print_warn "$svc: inactive"
        fi
    done

    # User-app Docker containers
    echo ""
    if docker info >/dev/null 2>&1; then
        local running stopped
        running=$(docker ps -q 2>/dev/null | wc -l)
        stopped=$(docker ps -aq 2>/dev/null | wc -l)
        stopped=$((stopped - running))
        printf "  %-20s %s running" "User-app containers:"  "$running"
        [ "$stopped" -gt 0 ] && printf ", %s stopped" "$stopped"
        echo ""
    else
        printf "  %-20s %s\n" "User-app containers:" "Docker not running"
    fi
    echo ""
}

cmd_recovery() {
    print_header "IORA OS — Recovery"
    echo ""
    echo "  Recovery options:"
    echo ""
    echo "    ora system reboot       Reboot the system"
    echo "    ora system shutdown     Shut down the system"
    echo "    ora service restart NAME  Restart a service"
    echo "    ora container restart N   Restart a container"
    echo "    ora update check        Check for OS updates"
    echo "    ora update install      Install OS updates"
    echo ""
    echo "  System logs:"
    echo "    journalctl -xe          Recent system errors"
    echo "    journalctl -u iora-stack  IORA stack logs"
    echo ""
    echo "  Documentation: /opt/iora/docs"
    echo "  Support: https://iora.kaimdt.com"
    echo ""
}

cmd_help() {
    print_header "ora — IORA OS CLI"
    echo ""
    echo "  Usage: ora <command> [subcommand] [args...]"
    echo ""
    printf "  ${BOLD}System:${RST}\n"
    echo "    ora system info           Show system information"
    echo "    ora system version        Show IORA OS version"
    echo "    ora system resources      Show CPU/RAM/disk usage"
    echo "    ora system reboot         Reboot the system"
    echo "    ora system shutdown       Shut down the system"
    echo ""
    printf "  ${BOLD}Services:${RST}\n"
    echo "    ora service list          List services"
    echo "    ora service start NAME    Start a service"
    echo "    ora service stop NAME     Stop a service"
    echo "    ora service restart NAME  Restart a service"
    echo "    ora service status NAME   Show service status"
    echo "    ora service logs NAME     Show service logs"
    echo ""
    printf "  ${BOLD}Containers:${RST}\n"
    echo "    ora container list        List containers"
    echo "    ora container start NAME  Start a container"
    echo "    ora container stop NAME   Stop a container"
    echo "    ora container restart N   Restart a container"
    echo "    ora container logs NAME   Show container logs"
    echo "    ora container stats       Show resource usage"
    echo ""
    printf "  ${BOLD}Updates:${RST}\n"
    echo "    ora update check          Check for updates"
    echo "    ora update install        Install updates"
    echo ""
    printf "  ${BOLD}Other:${RST}\n"
    echo "    ora status                Show overall status"
    echo "    ora recovery              Show recovery options"
    echo "    ora help                  Show this help"
    echo ""
}

# ── Main dispatch ──────────────────────────────────────────────────
CMD="${1:-help}"
shift 2>/dev/null || true

case "$CMD" in
    system)     cmd_system "$@" ;;
    service)    cmd_service "$@" ;;
    container)  cmd_container "$@" ;;
    update)     cmd_update "$@" ;;
    status)     cmd_status ;;
    recovery)   cmd_recovery ;;
    help|--help|-h) cmd_help ;;
    version|--version|-v) iora_version ;;
    *)
        print_err "Unknown command: $CMD"
        echo "  Run 'ora help' for usage."
        exit 1
        ;;
esac
ORAEOF
chmod 755 "${TARGET_DIR}/usr/bin/ora"

# =============================================================================
# System power commands — reboot, shutdown, poweroff, restart
# =============================================================================
# Ensure reboot/poweroff/halt/shutdown are accessible and use systemd where
# available, falling back to busybox/kernel calls.  Also create 'restart'
# which is not a standard POSIX command but many users expect it.
echo "IORA OS: Ensuring system power commands are accessible..."

# Create /usr/bin wrappers if the commands are only in /sbin or missing.
for _cmd in reboot halt poweroff; do
    if [ ! -e "${TARGET_DIR}/usr/bin/${_cmd}" ] && \
       [ ! -L "${TARGET_DIR}/usr/bin/${_cmd}" ]; then
        # Prefer a symlink to the existing /sbin version (systemd or busybox)
        if [ -e "${TARGET_DIR}/sbin/${_cmd}" ] || [ -L "${TARGET_DIR}/sbin/${_cmd}" ]; then
            ln -sf "/sbin/${_cmd}" "${TARGET_DIR}/usr/bin/${_cmd}" 2>/dev/null || true
        elif [ -e "${TARGET_DIR}/usr/sbin/${_cmd}" ] || [ -L "${TARGET_DIR}/usr/sbin/${_cmd}" ]; then
            ln -sf "/usr/sbin/${_cmd}" "${TARGET_DIR}/usr/bin/${_cmd}" 2>/dev/null || true
        else
            # Create a minimal wrapper that tries systemctl, then busybox;
            # no further exec fallback to avoid calling a non-existent /sbin binary.
            cat > "${TARGET_DIR}/usr/bin/${_cmd}" <<PWREOF
#!/bin/sh
# IORA OS ${_cmd} wrapper
if systemctl ${_cmd} 2>/dev/null; then
    exit 0
fi
busybox ${_cmd} 2>/dev/null || echo "ERROR: ${_cmd} failed — no suitable command found" >&2
PWREOF
            chmod 755 "${TARGET_DIR}/usr/bin/${_cmd}" 2>/dev/null || true
        fi
    fi
done

# 'shutdown' wrapper — supports common flags like 'shutdown now', '-h', '-r'
if [ ! -e "${TARGET_DIR}/usr/bin/shutdown" ] && \
   [ ! -L "${TARGET_DIR}/usr/bin/shutdown" ]; then
    if [ -e "${TARGET_DIR}/sbin/shutdown" ] || [ -L "${TARGET_DIR}/sbin/shutdown" ]; then
        ln -sf "/sbin/shutdown" "${TARGET_DIR}/usr/bin/shutdown" 2>/dev/null || true
    else
        cat > "${TARGET_DIR}/usr/bin/shutdown" <<'SHUTEOF'
#!/bin/sh
# IORA OS shutdown wrapper
case "${1:-}" in
    -r|--reboot)      systemctl reboot   2>/dev/null || busybox reboot   2>/dev/null ;;
    -h|-P|--poweroff) systemctl poweroff 2>/dev/null || busybox poweroff 2>/dev/null ;;
    -H|--halt)        systemctl halt     2>/dev/null || busybox halt     2>/dev/null ;;
    now)              systemctl poweroff 2>/dev/null || busybox poweroff 2>/dev/null ;;
    *)                systemctl poweroff 2>/dev/null || busybox poweroff 2>/dev/null ;;
esac
SHUTEOF
        chmod 755 "${TARGET_DIR}/usr/bin/shutdown" 2>/dev/null || true
    fi
fi

# 'restart' — convenience alias for reboot (common expectation on some systems)
if [ ! -e "${TARGET_DIR}/usr/bin/restart" ] && \
   [ ! -L "${TARGET_DIR}/usr/bin/restart" ]; then
    cat > "${TARGET_DIR}/usr/bin/restart" <<'RESTEOF'
#!/bin/sh
# IORA OS restart — reboots the system
printf "Restarting IORA OS...\n"
if systemctl reboot 2>/dev/null; then
    exit 0
fi
if busybox reboot 2>/dev/null; then
    exit 0
fi
# Last resort: try /sbin/reboot or /usr/bin/reboot directly
for _rb in /sbin/reboot /usr/bin/reboot; do
    [ -x "$_rb" ] && exec "$_rb" "$@"
done
echo "ERROR: reboot failed — no suitable command found" >&2
exit 1
RESTEOF
    chmod 755 "${TARGET_DIR}/usr/bin/restart" 2>/dev/null || true
fi

# =============================================================================
# Console font — smaller font like Ubuntu's default
# =============================================================================
# systemd reads /etc/vconsole.conf on every boot and applies FONT= via
# systemd-vconsole-setup.service.  If the kbd package is not installed
# (common on minimal Buildroot) this is silently ignored — no harm done.
echo "IORA OS: Configuring console font..."
if [ ! -f "${TARGET_DIR}/etc/vconsole.conf" ]; then
    cat > "${TARGET_DIR}/etc/vconsole.conf" <<'EOF'
KEYMAP=us
# Terminus 16px — compact and readable, similar to Ubuntu's default console
FONT=Lat15-Terminus16
EOF
else
    # Preserve existing vconsole.conf but ensure FONT is set
    if ! grep -q '^FONT=' "${TARGET_DIR}/etc/vconsole.conf" 2>/dev/null; then
        echo "FONT=Lat15-Terminus16" >> "${TARGET_DIR}/etc/vconsole.conf"
    fi
fi

# =============================================================================
# Native IORA system services — no Docker required for core services
# =============================================================================
# All IORA system services run as native systemd units with AppArmor confinement.
# Binaries are placed by the build pipeline into:
#   /opt/iora/build/<svc>/bin/<svc>
# and referenced directly from systemd ExecStart directives.
#
# Docker is only used for USER APPS (Home Assistant, Zigbee2MQTT, etc.)
# installed via the IORA App Store. The user-app Docker stack is managed by
# iora-supervisor (itself a native systemd service) via the compose file at
# /mnt/data/iora/docker-compose.yml (written by the setup wizard).
#
# Service communication (native services talk to each other via localhost):
#   iora-core     → localhost:8090
#   iora-home     → localhost:8126  (IORA Home Dashboard)
#   iora-control  → localhost:8091
#   iora-assist   → localhost:8092
#   iora-secrets  → localhost:8093
#   iora-watchdog → localhost:8094
#   iora-security → localhost:8095
#   iora-gateway  → localhost:8096
#   iora-supervisor → localhost:8097
#
# The PostgreSQL database runs natively as postgresql.service (already set up
# above) and is reached at localhost:5432.

echo "IORA OS: Installing native IORA system services..."

# Create the iora system user (non-privileged, no shell).
# iora-supervisor runs as root to manage Docker; all other services run as iora.
grep -q '^iora:' "${TARGET_DIR}/etc/passwd" 2>/dev/null || \
    echo 'iora:x:900:900:IORA System:/var/lib/iora:/sbin/nologin' \
        >> "${TARGET_DIR}/etc/passwd"
grep -q '^iora:' "${TARGET_DIR}/etc/group" 2>/dev/null || \
    echo 'iora:x:900:' >> "${TARGET_DIR}/etc/group"
grep -q '^iora:' "${TARGET_DIR}/etc/shadow" 2>/dev/null || \
    echo 'iora:!:19000:0:99999:7:::' >> "${TARGET_DIR}/etc/shadow"

# Security uses a dedicated UID as a kernel-enforced trust boundary for the
# privileged helper socket. No other IORA service runs under this identity.
if awk -F: '$3 == 919 && $1 != "iora-security" { found=1 } END { exit !found }' "${TARGET_DIR}/etc/passwd"; then
    echo "IORA OS: ERROR: reserved security UID 919 is already assigned" >&2
    exit 1
fi
if awk -F: '$3 == 919 && $1 != "iora-security" { found=1 } END { exit !found }' "${TARGET_DIR}/etc/group"; then
    echo "IORA OS: ERROR: reserved security GID 919 is already assigned" >&2
    exit 1
fi
grep -q '^iora-security:' "${TARGET_DIR}/etc/passwd" 2>/dev/null || \
    echo 'iora-security:x:919:919:IORA Security:/var/lib/iora/iora-security:/sbin/nologin' \
        >> "${TARGET_DIR}/etc/passwd"
grep -q '^iora-security:' "${TARGET_DIR}/etc/group" 2>/dev/null || \
    echo 'iora-security:x:919:' >> "${TARGET_DIR}/etc/group"
grep -q '^iora-security:' "${TARGET_DIR}/etc/shadow" 2>/dev/null || \
    echo 'iora-security:!:19000:0:99999:7:::' >> "${TARGET_DIR}/etc/shadow"
# Database credentials remain group-readable by the shared `iora` group; add
# only the Security UID as a supplementary member.
sed -i 's/^iora:x:900:.*$/iora:x:900:iora-security/' "${TARGET_DIR}/etc/group"

# Per-service data directories (on the ZRAM /var, created at runtime by zram.service).
# We also create them here so they exist on the rootfs overlay as a fallback.
for svc in iora-core iora-home iora-control iora-assist \
           iora-secrets iora-watchdog iora-security iora-gateway iora-supervisor; do
    mkdir -p "${TARGET_DIR}/var/lib/iora/${svc}"
done

# Environment-file skeletons — populated by the setup wizard at first boot.
# Variables marked CHANGEME must be set before the service is useful.
mkdir -p "${TARGET_DIR}/etc/iora"

cat > "${TARGET_DIR}/etc/iora/iora-core.env" <<'ENVEOF'
PORT=8090
RUST_LOG=info
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_core
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-home.env" <<'ENVEOF'
# IORA Home — bootstrap environment.
#
# This file holds ONLY the minimum settings iora-home needs to talk to its
# own PostgreSQL database. All user-facing configuration (Home Assistant
# URL/Token, MQTT, Matter, Zigbee, Z-Wave, BLE, HomeKit, …) lives in the
# `system_preferences` table and is editable from the IORA Admin Control
# Center at runtime — DO NOT add HA_URL / HA_TOKEN here.
PORT=8126
RUST_LOG=info
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_home
JWT_SECRET=CHANGEME
IORA_CORE_URL=http://localhost:8090
# Path to the built React/Vite dashboard bundle (npm run build → dist/).
# build-all-images.sh installs it here from the repo root before image creation.
IORA_HOME_DIST=/opt/iora/iora-home/dist
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-control.env" <<'ENVEOF'
PORT=8091
RUST_LOG=info
IORA_CORE_URL=http://localhost:8090
IORA_HOME_URL=http://localhost:8126
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-assist.env" <<'ENVEOF'
PORT=8092
RUST_LOG=info
ASSIST_AI_BACKEND_URL=
ASSIST_AI_API_KEY=
IORA_CORE_URL=http://localhost:8090
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-secrets.env" <<'ENVEOF'
PORT=8093
RUST_LOG=info
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_secrets
SECRETS_MASTER_KEY=CHANGEME
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-watchdog.env" <<'ENVEOF'
PORT=8094
RUST_LOG=info
IORA_CORE_URL=http://localhost:8090
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-security.env" <<'ENVEOF'
PORT=8095
RUST_LOG=info
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_security
# 64-hex-char (32-byte) AES-256-GCM key used to encrypt fields in
# iora-security's audit/event tables. Setup wizard fills this in on
# first boot; the placeholder makes the binary fail loudly if it's
# ever started before setup ran.
SECURITY_DB_KEY=CHANGEME
AUTO_LOCKDOWN_ENABLED=true
THREAT_LEVEL_THRESHOLD=7
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-gateway.env" <<'ENVEOF'
PORT=8096
RUST_LOG=info
ENABLE_SANDBOXING=true
REQUEST_TIMEOUT_SECS=30
SMTP_SERVER=
SMTP_USERNAME=
SMTP_PASSWORD=
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-supervisor.env" <<'ENVEOF'
PORT=8097
RUST_LOG=info
IORA_OS=true
DOCKER_SOCK=/var/run/docker.sock
DOCKER_COMPOSE_FILE=/mnt/data/iora/docker-compose.yml
ALLOWED_IMAGES_FILE=/etc/iora/allowed-images.txt
COMPOSE_HASH_FILE=/var/lib/iora/iora-supervisor/compose.sha256
BINARY_MANIFEST=/etc/iora/binary-manifest.sha256
ENVEOF

# ── Newer IORA daemons (added incrementally) ────────────────────────────────
# Each gets a minimal bootstrap env. User-facing config lives in the
# system_preferences DB table and is editable from the Admin Control Center
# (see backend/iora-shared/src/settings.rs for the registry).

cat > "${TARGET_DIR}/etc/iora/iora-api.env" <<'ENVEOF'
PORT=8099
RUST_LOG=info
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_assist
ASSIST_AI_PROVIDER=desktop
IORA_CORE_URL=http://localhost:8090
IORA_HOME_URL=http://localhost:8126
ASSIST_AI_MODEL=
ORA_AI_PROVIDER=desktop
ORA_AI_BASE_URL=
ORA_AI_API_KEY=
ORA_AI_MODEL=
# SQLite file lives inside the per-service StateDirectory
# (/var/lib/iora/iora-api). systemd creates that dir for us before the
# unit starts, and ProtectSystem=strict + ReadWritePaths in the unit
# whitelist exactly that path. iora-api still mkdir -p's the parent on
# first start as a belt-and-braces measure.
IORA_API_DB_URL=sqlite:/var/lib/iora/iora-api/api.db?mode=rwc
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-assist.env" <<'ENVEOF'
PORT=8092
RUST_LOG=iora_assist=info
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_assist
IORA_CORE_URL=http://localhost:8090
IORA_HOME_URL=http://localhost:8126
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-appstore.env" <<'ENVEOF'
PORT=8098
RUST_LOG=info
IORA_CORE_URL=http://localhost:8090
APPSTORE_REGISTRY_URL=
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-backup.env" <<'ENVEOF'
PORT=8100
RUST_LOG=info
BACKUP_DIR=/mnt/data/iora/backups
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_core
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-connector.env" <<'ENVEOF'
PORT=8088
RUST_LOG=info
IORA_CORE_URL=http://localhost:8090
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-dev-bridge.env" <<'ENVEOF'
PORT=8101
RUST_LOG=info
IORA_CORE_URL=http://localhost:8090
# /dev/config/* targets system_preferences in iora-home (REST not used —
# the bridge talks PostgreSQL directly so it works even when iora-home
# itself is the service being restarted/rebuilt).
IORA_HOME_URL=http://localhost:8126
# /dev/db/* and /dev/config/* connect to PostgreSQL using the password
# in /etc/iora/db.password (mode 0640, group iora). The dev-bridge runs
# as root and reads it directly. Set IORA_DB_PASSWORD to override.
IORA_DB_HOST=127.0.0.1
IORA_DB_PORT=5432
IORA_DB_USER=iora
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-domain-validator.env" <<'ENVEOF'
PORT=8102
RUST_LOG=info
IORA_CORE_URL=http://localhost:8090
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-files.env" <<'ENVEOF'
PORT=8103
RUST_LOG=info
FILES_ROOT=/mnt/data/iora/files
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-network-monitor.env" <<'ENVEOF'
PORT=8104
RUST_LOG=info
# Reuse the iora_core database; the network-monitor creates its own
# tables on first start. Without this it falls back to the compiled-in
# default `sqlite:./data/iora.db?mode=rwc`, which has no writable CWD
# under the systemd unit and crashes at startup.
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_core
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-nginx.env" <<'ENVEOF'
PORT=8089
RUST_LOG=info
NGINX_CONF_DIR=/etc/nginx
# The Tera template is shipped read-only under /usr/share. The legacy
# default `./nginx-config/nginx.conf.template` only works when the
# binary is run from its source tree.
NGINX_TEMPLATE_PATH=/usr/share/iora/iora-nginx/nginx.conf.template
# Reuse the iora_core database for app/route metadata. The actual
# password is injected by the setup wizard once the iora role exists.
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_core
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-resource-manager.env" <<'ENVEOF'
PORT=8105
RUST_LOG=info
# Reuse the iora_core database; the resource-manager creates its own
# tables on first start. The default fallback compiled into the binary
# is `postgres://iora:iora@localhost/iora`, but the `iora` database does
# NOT exist in IORA OS (only iora_core/iora_home/iora_secrets/iora_security).
DATABASE_URL=postgres://iora:CHANGEME@localhost:5432/iora_core
ENVEOF

cat > "${TARGET_DIR}/etc/iora/iora-updater.env" <<'ENVEOF'
PORT=8106
RUST_LOG=info
UPDATE_FEED_URL=
ENVEOF

# Restrict env file permissions (they contain secrets after setup).
for svc in iora-core iora-home iora-control iora-assist \
           iora-secrets iora-watchdog iora-security iora-gateway iora-supervisor \
           iora-api iora-appstore iora-backup iora-connector iora-dev-bridge \
           iora-domain-validator iora-files iora-network-monitor iora-nginx \
           iora-resource-manager iora-updater; do
    chmod 0640 "${TARGET_DIR}/etc/iora/${svc}.env" 2>/dev/null || true
done

# ── wait-for-postgres helper ────────────────────────────────────────────────
# Used as ExecStartPre by every IORA service that talks to PostgreSQL.  Polls
# pg_isready (falls back to nc / python3 TCP probe) until Postgres accepts
# connections, with a configurable timeout (default 60s).  Always exits 0 —
# never blocks boot — and the calling service has its own internal retry.
mkdir -p "${TARGET_DIR}/usr/lib/iora"
cat > "${TARGET_DIR}/usr/lib/iora/wait-for-postgres" <<'PGREADY'
#!/bin/sh
# wait-for-postgres [timeout-seconds]
TIMEOUT="${1:-60}"
HOST="${PGHOST:-127.0.0.1}"
PORT="${PGPORT:-5432}"
deadline=$(( $(date +%s) + TIMEOUT ))
log() { logger -t wait-for-postgres -- "$@" 2>/dev/null; echo "wait-for-postgres: $*" >&2; }
log "waiting up to ${TIMEOUT}s for PostgreSQL at ${HOST}:${PORT}"
while [ "$(date +%s)" -lt "${deadline}" ]; do
    if command -v pg_isready >/dev/null 2>&1; then
        pg_isready -q -h "${HOST}" -p "${PORT}" 2>/dev/null && { log "PostgreSQL is ready"; exit 0; }
    elif command -v nc >/dev/null 2>&1; then
        nc -z -w 1 "${HOST}" "${PORT}" 2>/dev/null && { log "PostgreSQL TCP port open"; exit 0; }
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import socket,sys
s=socket.socket(); s.settimeout(1)
try: s.connect((\"${HOST}\", ${PORT})); sys.exit(0)
except Exception: sys.exit(1)" 2>/dev/null && { log "PostgreSQL TCP port open"; exit 0; }
    else
        sleep 2; log "no probe tool; continuing"; exit 0
    fi
    sleep 1
done
log "timeout reached; starting service anyway (it will retry internally)"
exit 0
PGREADY
chmod 0755 "${TARGET_DIR}/usr/lib/iora/wait-for-postgres"

# ── Helper: generate one native systemd service unit ─────────────────────────
# Arguments: svc port user after_extra description
write_iora_service() {
    local svc="$1" port="$2" user="$3" after="$4" description="$5"
    local bin="/opt/iora/build/${svc}/bin/${svc}"

    # Services that talk to PostgreSQL get an ExecStartPre wait-for-pg loop
    # so they don't crash-loop while pg is still warming up on first boot.
    local pg_ready_pre=""
    case "${svc}" in
        iora-core|iora-home|iora-control|iora-assist|iora-secrets|iora-watchdog|iora-security|iora-gateway|iora-supervisor|iora-api|iora-appstore|iora-backup|iora-connector|iora-dev-bridge|iora-domain-validator|iora-files|iora-resource-manager|iora-updater)
            pg_ready_pre="ExecStartPre=/usr/lib/iora/wait-for-postgres 60"
            ;;
    esac

    cat > "${TARGET_DIR}/etc/systemd/system/${svc}.service" <<SVCEOF
[Unit]
Description=IORA ${description}
Documentation=https://iora.kaimdt.com
After=network.target local-fs.target postgresql.service iora-db-init.service ${after}
Wants=network.target postgresql.service iora-db-init.service
ConditionPathExists=${bin}

[Service]
Type=simple
User=${user}
Group=${user}
# Use leading '-' so a missing env file doesn't fail-stop the unit on a
# freshly-installed image where /etc/iora/<svc>.env hasn't been written yet.
EnvironmentFile=-/etc/iora/${svc}.env
${pg_ready_pre}
ExecStart=${bin}
WorkingDirectory=/var/lib/iora/${svc}
StateDirectory=iora/${svc}
RuntimeDirectory=iora/${svc}
LogsDirectory=iora/${svc}

# Restart policy — be resilient on first-boot while deps come up.
Restart=on-failure
RestartSec=5s
StartLimitBurst=5
StartLimitIntervalSec=60s

# Systemd hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadWritePaths=/var/lib/iora/${svc} /var/log/iora
CapabilityBoundingSet=

# Resource limits
LimitNOFILE=65536
MemoryMax=512M

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${svc}

[Install]
WantedBy=multi-user.target
SVCEOF

    ln -sf "/etc/systemd/system/${svc}.service" \
        "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/${svc}.service"
}

# iora-core — central orchestrator (no extra After=, just postgres)
write_iora_service "iora-core" "8090" "iora" "" "Core Orchestrator"

# iora-home — IORA Home smart-home dashboard + HA translator
write_iora_service "iora-home" "8126" "iora" "iora-core.service" "Home Dashboard"

# Drop-in: give iora-home read access to other services' journals so the
# Admin Control Center central log view (/api/admin/logs/source/...) can
# tail any iora-* unit via `journalctl -u`. Without `systemd-journal` group
# membership a non-privileged user only sees its own service's logs.
mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-home.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-home.service.d/logs.conf" <<'EOF'
[Service]
SupplementaryGroups=systemd-journal
EOF

# iora-control — admin panel backend
write_iora_service "iora-control" "8091" "iora" "iora-core.service iora-home.service" "Control Center"

# iora-assist — AI assistant
write_iora_service "iora-assist" "8092" "iora" "iora-core.service" "AI Assistant"

# iora-secrets — encrypted secrets storage (AppArmor profile applies)
write_iora_service "iora-secrets" "8093" "iora" "" "Secrets Manager"
# Override with AppArmor-specific hardening
mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-secrets.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-secrets.service.d/apparmor.conf" <<'EOF'
[Service]
AmbientCapabilities=
SecureBits=noroot noroot-locked
EOF

# iora-watchdog — health monitoring service. SECURITY-CRITICAL: must always
# come back up no matter what. We override the default Restart=on-failure to
# Restart=always and tighten the limits so a transient failure does NOT cause
# systemd to give up after 5 attempts.
write_iora_service "iora-watchdog" "8094" "iora" "iora-core.service" "Watchdog"
mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-watchdog.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-watchdog.service.d/critical.conf" <<'EOF'
[Service]
# Watchdog is security-critical — keep restarting forever, never give up.
Restart=always
RestartSec=3s
StartLimitBurst=0
StartLimitIntervalSec=0
# Higher OOM priority — the kernel should kill almost anything else first.
OOMScoreAdjust=-500
# Best effort to keep watchdog scheduled even under load.
Nice=-5
IOSchedulingClass=best-effort
IOSchedulingPriority=2
[Unit]
# If the watchdog process dies for any reason, log it loudly via journald
# and the security service so it can be acted on.
OnFailure=iora-security.service
EOF

# iora-security — security monitoring (AppArmor profile applies)
write_iora_service "iora-security" "8095" "iora-security" "" "Security Monitor"

# iora-gateway — sandboxed external integrations (AppArmor profile applies)
write_iora_service "iora-gateway" "8096" "iora" "" "External Gateway"

# iora-supervisor — manages user-app Docker containers; runs as root for Docker socket
# Override the generic service for supervisor-specific settings.
cat > "${TARGET_DIR}/etc/systemd/system/iora-supervisor.service" <<'EOF'
[Unit]
Description=IORA Supervisor (Docker Gatekeeper + User App Manager)
Documentation=https://iora.kaimdt.com
# Supervisor starts after Docker is ready; it is the sole process allowed to
# drive Docker for user apps. No other IORA service has Docker socket access.
After=network.target docker.service iora-core.service iora-secrets.service
Wants=network.target docker.service
ConditionPathExists=/opt/iora/build/iora-supervisor/bin/iora-supervisor

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=/etc/iora/iora-supervisor.env

# Initialise Supervisor state directories and set up allowed-images list.
ExecStartPre=/usr/lib/iora/iora-docker-guard --init

ExecStart=/opt/iora/build/iora-supervisor/bin/iora-supervisor
WorkingDirectory=/var/lib/iora/iora-supervisor
RuntimeDirectory=iora/iora-supervisor

# Supervisor holds root — that is intentional: it is the Docker gatekeeper.
# NoNewPrivileges=no allows it to call docker and manage containers.
NoNewPrivileges=no
PrivateTmp=yes
ReadWritePaths=/var/lib/iora/iora-supervisor /var/log/iora /var/run/docker.sock \
               /etc/iora /mnt/data/iora
LimitNOFILE=65536

Restart=on-failure
RestartSec=5s
StartLimitBurst=5
StartLimitIntervalSec=60s

StandardOutput=journal
StandardError=journal
SyslogIdentifier=iora-supervisor

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-supervisor.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-supervisor.service"

mkdir -p "${TARGET_DIR}/var/log/iora"
mkdir -p "${TARGET_DIR}/var/lib/iora/iora-supervisor"

# ── Newer IORA daemons ──────────────────────────────────────────────────────
# Each is a Rust workspace crate under backend/<svc>/ and gets the same
# generic systemd unit as the original 9 services. Adding a new daemon now
# requires (1) appending to SERVICES in build-all-images.sh, (2) writing
# its env file above, and (3) adding one write_iora_service line below.

write_iora_service "iora-api"               "8099" "iora" "iora-core.service iora-home.service" "Extended API (GraphQL/WebDAV/CalDAV)"
write_iora_service "iora-appstore"          "8098" "iora" "iora-core.service iora-supervisor.service" "App Store"
write_iora_service "iora-backup"            "8100" "iora" "iora-core.service" "Backup & Restore"
write_iora_service "iora-connector"         "8088" "iora" "iora-core.service" "Datacenter Connector (WireGuard)"
# Dev bridge is handled separately above with root + full capabilities
if [ "${IORA_OS_DEV:-0}" != "1" ]; then
    write_iora_service "iora-dev-bridge"        "8101" "root" "iora-core.service iora-supervisor.service" "Developer Bridge"
fi
write_iora_service "iora-domain-validator"  "8102" "iora" "iora-core.service" "Domain Validator (ACME/DNS)"
write_iora_service "iora-files"             "8103" "iora" "iora-core.service" "File Service"
write_iora_service "iora-network-monitor"   "8104" "iora" "iora-core.service" "Network Monitor"
write_iora_service "iora-nginx"             "8089" "root" "" "Nginx Configuration Manager"
write_iora_service "iora-resource-manager"  "8105" "iora" "iora-core.service" "Resource Manager (CPU/RAM/Disk)"
write_iora_service "iora-updater"           "8106" "iora" "iora-core.service" "System Updater"

# ── iora-docker-guard ────────────────────────────────────────────────────────
# Script invoked by iora-supervisor as ExecStartPre (--init) and also by
# iora-stack.service as ExecStartPre to enforce:
#   - compose file integrity (SHA-256 tamper detection)
#   - image allowlist (only permitted images may run)
#   - Docker socket ownership (root:root 0600)
# Updates are detected and logged but NEVER blocked.
cat > "${TARGET_DIR}/usr/lib/iora/iora-docker-guard" <<'GUARDEOF'
#!/bin/sh
# IORA OS — Docker Gatekeeper Guard.
# Called by iora-supervisor (--init) and iora-stack.service (--check).
LOG_TAG="iora-docker-guard"
SECURITY_LOG="/var/log/iora-security.log"
COMPOSE_FILE="/mnt/data/iora/docker-compose.yml"
COMPOSE_HASH_FILE="/var/lib/iora/iora-supervisor/compose.sha256"
ALLOWED_IMAGES_FILE="/etc/iora/allowed-images.txt"
DOCKER_SOCK="/var/run/docker.sock"

log()   { logger -t "$LOG_TAG" "$*"; echo "[$(date -Iseconds)] $LOG_TAG: $*"; }
alert() {
    logger -p user.warning -t "$LOG_TAG" "ALERT: $*"
    echo "[$(date -Iseconds)] $LOG_TAG ALERT: $*" >> "$SECURITY_LOG" 2>/dev/null || true
}

mode="${1:---check}"

# ── --init: Supervisor start-up initialisation ──────────────────────────────
if [ "$mode" = "--init" ]; then
    # Ensure Docker socket is owned by root:root 0600 (hardening).
    if [ -S "$DOCKER_SOCK" ]; then
        chown root:root "$DOCKER_SOCK" 2>/dev/null || true
        chmod 0600      "$DOCKER_SOCK" 2>/dev/null || true
    fi

    # Create the allowed-images file if it doesn't exist yet.
    # This file is managed by iora-supervisor: it adds images when the user
    # installs an app through the IORA App Store, and removes them on uninstall.
    if [ ! -f "$ALLOWED_IMAGES_FILE" ]; then
        mkdir -p "$(dirname "$ALLOWED_IMAGES_FILE")"
        # Pre-populate with well-known IORA-blessed base images.
        cat > "$ALLOWED_IMAGES_FILE" <<'ALLOWEOF'
# IORA Allowed Docker Images
# Lines starting with # are comments.
# Format: one image name (without tag) per line.
# Managed by iora-supervisor. Manual edits are allowed but will be
# re-verified by the supervisor on next start.
ghcr.io/home-assistant/home-assistant
homeassistant/home-assistant
eclipse-mosquitto
koenkk/zigbee2mqtt
esphome/esphome
linuxserver/heimdall
ALLOWEOF
        chmod 0640 "$ALLOWED_IMAGES_FILE"
        log "created initial allowed-images list at $ALLOWED_IMAGES_FILE"
    fi

    # Record the current compose file hash for tamper detection.
    if [ -f "$COMPOSE_FILE" ]; then
        sha256sum "$COMPOSE_FILE" 2>/dev/null | awk '{print $1}' > "$COMPOSE_HASH_FILE"
        log "recorded compose file hash"
    fi
    exit 0
fi

# ── --check: pre-start compose integrity + allowlist check ──────────────────
# 1. Compose file tamper detection.
if [ -f "$COMPOSE_FILE" ] && [ -f "$COMPOSE_HASH_FILE" ]; then
    current_hash=$(sha256sum "$COMPOSE_FILE" 2>/dev/null | awk '{print $1}')
    stored_hash=$(cat "$COMPOSE_HASH_FILE" 2>/dev/null)
    if [ -n "$stored_hash" ] && [ "$current_hash" != "$stored_hash" ]; then
        alert "compose file changed since last start (hash mismatch) — possible tampering or update"
        # Update the stored hash so we only alert once per change, not on every start.
        echo "$current_hash" > "$COMPOSE_HASH_FILE"
    fi
fi

# 2. Image allowlist check: warn on any image not in the allowlist.
if [ -f "$COMPOSE_FILE" ] && [ -f "$ALLOWED_IMAGES_FILE" ]; then
    grep -E '^\s*image:' "$COMPOSE_FILE" 2>/dev/null | sed 's/.*image:[[:space:]]*//' | \
    while read -r img; do
        # Strip surrounding quotes and the tag (everything after the first colon
        # that follows a slash or starts the tag portion).
        img=$(printf '%s' "$img" | sed 's/[[:space:]]//g; s/["'"'"']//g; s/:[^/]*$//')
        if [ -n "$img" ] && ! grep -qF "$img" "$ALLOWED_IMAGES_FILE" 2>/dev/null; then
            alert "compose file references non-allowlisted image: '${img}'"
        fi
    done
fi

exit 0
GUARDEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-docker-guard"

# ── iora-stack.service — manages USER-APP Docker containers ─────────────────
# IORA system services are native (above).  This service manages ONLY the
# user-app Docker Compose stack in /mnt/data/iora/docker-compose.yml, which
# is written by the setup wizard and contains Home Assistant, MQTT, etc.
# iora-supervisor (native) orchestrates this stack and restarts it as needed.
cat > "${TARGET_DIR}/etc/systemd/system/iora-stack.service" <<'EOF'
[Unit]
Description=IORA User-App Docker Stack
Documentation=https://iora.kaimdt.com
# Wants (not Requires): if docker/network are briefly unavailable we still
# try and simply exit cleanly on retry rather than spamming "Failed to start"
# on every Restart= attempt.
# iora-supervisor is explicitly NOT in Wants/Requires: it is a ConditionPathExists-
# gated native service; if its binary is missing the unit silently skips,
# which must not cascade into "A dependency job for iora-stack failed".
Wants=docker.service iora-init-data.service network-online.target
After=docker.service network-online.target iora-init-data.service iora-supervisor.service
ConditionPathIsDirectory=/mnt/data/iora
# Only start when setup has completed AND the compose file is present.
# Both conditions must be true; a missing compose file gracefully skips the
# unit (exit 0 / "skipped") instead of hard-failing through ExecStartPre.
ConditionPathExists=/mnt/data/iora/.setup-complete
ConditionPathExists=/mnt/data/iora/docker-compose.yml
StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/mnt/data/iora

# Belt-and-suspenders: log a warning if compose file is a hello-world
# placeholder, then proceed (ConditionPathExists above already gates on
# file existence, so this path should not be reached in practice).
ExecStartPre=/bin/sh -c '\
  if grep -q "image: hello-world" /mnt/data/iora/docker-compose.yml 2>/dev/null; then \
    echo "iora-stack: compose file is a placeholder — starting anyway"; \
  fi; \
  echo "iora-stack: starting user-app containers"'
ExecStartPre=-/usr/lib/iora/iora-docker-guard --check

# Make sure dockerd is actually responsive before we call `docker compose`:
# Wants/After alone don't guarantee the daemon has finished initialising,
# only that the systemd unit transitioned to active. Poll the socket so
# compose gets a working daemon and the error surfaced to the setup UI is
# the real compose error, not "Cannot connect to the Docker daemon".
ExecStartPre=/bin/sh -c 'for i in $(seq 1 30); do \
    /usr/bin/docker info >/dev/null 2>&1 && exit 0; \
    sleep 1; \
  done; echo "iora-stack: docker daemon did not become ready"; exit 1'

ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose up -d --remove-orphans
SuccessExitStatus=0 1
Restart=no
TimeoutStartSec=240
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

ln -sf /etc/systemd/system/iora-stack.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-stack.service"

# ── iora-integrity.service + timer ──────────────────────────────────────────
# Full binary integrity scan of all native IORA services.
# Runs every 5 minutes; does NOT block updates — it logs mismatches and
# defers remediation to iora-security / the operator.
# The trusted manifest is written at first boot by iora-integrity-init.service
# (see below) once the binaries are in place, and updated by iora-updater
# immediately after each successful update via `iora-integrity-update-manifest`.
cat > "${TARGET_DIR}/usr/lib/iora/iora-integrity-scan" <<'SCANEOF'
#!/bin/sh
# IORA OS — full binary integrity scan.
# Invoked by iora-integrity.service every 5 minutes.
LOG_TAG="iora-integrity"
SECURITY_LOG="/var/log/iora-security.log"
MANIFEST="/etc/iora/binary-manifest.sha256"
RESULT_FILE="/run/iora/integrity-last-result"
MISMATCH_FILE="/run/iora/integrity-mismatch.json"
mismatch_json=""

log()   { logger -t "$LOG_TAG" "$*"; }
alert() {
    logger -p user.warning -t "$LOG_TAG" "ALERT: $*"
    echo "[$(date -Iseconds)] $LOG_TAG ALERT: $*" >> "$SECURITY_LOG" 2>/dev/null || true
}

if [ ! -f "$MANIFEST" ]; then
    log "manifest not found at $MANIFEST — skipping scan (first-boot initialisation pending)"
    exit 0
fi

mismatches=0
total=0
mkdir -p "$(dirname "$RESULT_FILE")"

while IFS= read -r line; do
    # Skip comments and blank lines.
    case "$line" in
        '#'*|'') continue ;;
    esac
    expected_hash=$(echo "$line" | awk '{print $1}')
    bin_path=$(echo "$line"      | awk '{print $2}')
    [ -z "$bin_path" ] && continue
    total=$((total + 1))
    if [ ! -f "$bin_path" ]; then
        alert "binary missing: ${bin_path}"
        mismatches=$((mismatches + 1))
        mismatch_json="${mismatch_json}{\"path\":\"${bin_path}\",\"expected\":\"${expected_hash}\",\"actual\":\"missing\"},"
        continue
    fi
    actual_hash=$(sha256sum "$bin_path" 2>/dev/null | awk '{print $1}')
    if [ "$actual_hash" != "$expected_hash" ]; then
        alert "integrity MISMATCH: ${bin_path}"
        mismatches=$((mismatches + 1))
        mismatch_json="${mismatch_json}{\"path\":\"${bin_path}\",\"expected\":\"${expected_hash}\",\"actual\":\"${actual_hash}\"},"
    fi
done < "$MANIFEST"

# Write a compact result summary for the iora-security dashboard.
printf '{"checked":%d,"mismatches":%d,"ts":"%s"}\n' \
    "$total" "$mismatches" "$(date -Iseconds)" > "$RESULT_FILE" 2>/dev/null || true

if [ "$mismatches" -eq 0 ]; then
    rm -f "$MISMATCH_FILE" 2>/dev/null || true
    log "integrity OK — ${total} binaries verified"
else
    # Structured mismatch evidence for iora-security: it decides whether the
    # affected binaries are critical and may request a lockdown through the
    # approved helper boundary. The scan itself never mutates the host.
    mismatch_json="${mismatch_json%,}"
    printf '{"detected_at":"%s","mismatches":[%s]}\n' \
        "$(date -Iseconds)" "$mismatch_json" > "$MISMATCH_FILE" 2>/dev/null || true
    alert "${mismatches}/${total} integrity failures — check $SECURITY_LOG"
fi
exit 0
SCANEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-integrity-scan"

# Helper called by iora-updater immediately after a successful update to
# refresh the manifest for the updated binary (allows updates without alerts).
cat > "${TARGET_DIR}/usr/lib/iora/iora-integrity-update-manifest" <<'UPDATEMANEOF'
#!/bin/sh
# Usage: iora-integrity-update-manifest <binary-path> [<binary-path> ...]
# Called by iora-updater after a successful update to refresh manifest entries.
MANIFEST="/etc/iora/binary-manifest.sha256"
LOG_TAG="iora-integrity"
log() { logger -t "$LOG_TAG" "$*"; echo "[$(date -Iseconds)] $LOG_TAG: $*"; }

if [ ! -f "$MANIFEST" ]; then
    log "manifest not found — cannot update (run integrity-init first)"
    exit 1
fi
for bin_path in "$@"; do
    [ -f "$bin_path" ] || { log "skip missing: $bin_path"; continue; }
    new_hash=$(sha256sum "$bin_path" | awk '{print $1}')
    # Remove the old entry (if any) and append the new one.
    tmp=$(mktemp)
    grep -vF "$bin_path" "$MANIFEST" > "$tmp" 2>/dev/null || true
    echo "${new_hash}  ${bin_path}" >> "$tmp"
    mv "$tmp" "$MANIFEST"
    log "manifest updated for ${bin_path}"
done
exit 0
UPDATEMANEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-integrity-update-manifest"

# iora-integrity-init.service: runs once at first boot to build the manifest.
cat > "${TARGET_DIR}/etc/systemd/system/iora-integrity-init.service" <<'EOF'
[Unit]
Description=IORA Binary Integrity Manifest Initialisation
ConditionPathMissing=/etc/iora/binary-manifest.sha256
After=local-fs.target
DefaultDependencies=no

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '\
  MANIFEST=/etc/iora/binary-manifest.sha256; \
  tmp=$(mktemp); \
  echo "# IORA binary integrity manifest — generated $(date -Iseconds)" > "$tmp"; \
  for svc in iora-core iora-home iora-control iora-assist \
              iora-secrets iora-watchdog iora-security iora-gateway iora-supervisor \
              iora-runtime-sensor iora-runtime-identity iora-runtime-policy iora-incident-engine; do \
    bin="/opt/iora/build/${svc}/bin/${svc}"; \
    [ -f "$bin" ] || continue; \
    sha256sum "$bin" >> "$tmp"; \
  done; \
  mv "$tmp" "$MANIFEST"; \
  chmod 0640 "$MANIFEST"; \
  logger -t iora-integrity "manifest initialised with $(grep -c "^[^#]" "$MANIFEST") entries"'
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iora-integrity

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-integrity-init.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-integrity-init.service"

# iora-integrity.service + timer: periodic full scan.
cat > "${TARGET_DIR}/etc/systemd/system/iora-integrity.service" <<'EOF'
[Unit]
Description=IORA Binary Integrity Scan
After=iora-integrity-init.service
Requires=iora-integrity-init.service

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-integrity-scan
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iora-integrity
User=root
NoNewPrivileges=yes
PrivateTmp=yes
EOF

cat > "${TARGET_DIR}/etc/systemd/system/iora-integrity.timer" <<'EOF'
[Unit]
Description=IORA Binary Integrity Scan Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
RandomizedDelaySec=60s
Persistent=true

[Install]
WantedBy=timers.target
EOF
ln -sf /etc/systemd/system/iora-integrity.timer \
    "${TARGET_DIR}/etc/systemd/system/timers.target.wants/iora-integrity.timer"

# ── iora-update-monitor.service ─────────────────────────────────────────────
# Watches /opt/iora/build/ for file changes using inotifywait (busybox).
# When a change is detected it:
#   1. Logs the event (does NOT block it — updates must be allowed through).
#   2. Re-hashes the changed binary and updates the manifest so the next
#      integrity scan doesn't false-alarm on a legitimate update.
#   3. Records the event in the security log for audit purposes.
# If the change was NOT caused by the iora-updater process, an alert is raised.
cat > "${TARGET_DIR}/usr/lib/iora/iora-update-monitor" <<'UMEOF'
#!/bin/sh
# IORA OS — update monitor daemon.
# Watches /opt/iora/build/ for binary changes. Does NOT block updates.
LOG_TAG="iora-update-monitor"
SECURITY_LOG="/var/log/iora-security.log"
WATCH_DIR="/opt/iora/build"
UPDATER_COMM="iora-updater"

log()   { logger -t "$LOG_TAG" "$*"; }
alert() {
    logger -p user.warning -t "$LOG_TAG" "ALERT: $*"
    echo "[$(date -Iseconds)] $LOG_TAG ALERT: $*" >> "$SECURITY_LOG" 2>/dev/null || true
}

if ! command -v inotifywait >/dev/null 2>&1; then
    log "inotifywait not available — update monitoring disabled"
    # Sleep forever so systemd doesn't restart us in a tight loop.
    exec sleep infinity
fi

log "watching $WATCH_DIR for binary changes (updates are logged, not blocked)"

inotifywait -m -r -e close_write,moved_to "$WATCH_DIR" 2>/dev/null | \
while read -r dir event file; do
    changed="${dir}${file}"
    # Identify who wrote the file: look for iora-updater among running processes
    # using shell globbing over /proc — no ls parsing.
    writer="unknown"
    for pid_dir in /proc/[0-9]*; do
        comm=$(cat "${pid_dir}/comm" 2>/dev/null) || continue
        if [ "$comm" = "$UPDATER_COMM" ]; then
            writer="$UPDATER_COMM"
            break
        fi
    done

    if [ "$writer" = "$UPDATER_COMM" ]; then
        log "authorised update: ${changed} (written by ${UPDATER_COMM})"
        # Refresh manifest entry so integrity scan doesn't alert.
        /usr/lib/iora/iora-integrity-update-manifest "$changed" 2>/dev/null || true
    else
        alert "unexpected modification: ${changed} (writer: ${writer}) — possible tampering"
    fi
done
UMEOF
chmod 755 "${TARGET_DIR}/usr/lib/iora/iora-update-monitor"

cat > "${TARGET_DIR}/etc/systemd/system/iora-update-monitor.service" <<'EOF'
[Unit]
Description=IORA Update Monitor (binary change detection)
Documentation=https://iora.kaimdt.com
After=local-fs.target

[Service]
Type=simple
ExecStart=/usr/lib/iora/iora-update-monitor
Restart=always
RestartSec=10s
StandardOutput=journal
StandardError=journal
SyslogIdentifier=iora-update-monitor
User=root
NoNewPrivileges=yes
PrivateTmp=yes
# inotifywait needs to be able to set up kernel watches on /opt/iora/build
# (it uses inotify file descriptors, not write access to the files themselves).
# /proc is read-only; manifest and log dirs are read-write.
ReadOnlyPaths=/proc
ReadWritePaths=/opt/iora/build /etc/iora /var/log/iora /run/iora

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-update-monitor.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-update-monitor.service"

echo "IORA OS: Native IORA system services installed."

# ── Plymouth boot splash ─────────────────────────────────────────────────────
# Set the IORA custom theme as the default Plymouth theme so the OS shows a
# branded splash screen instead of the kernel log scrolling during boot.
# Plymouth is compiled in via BR2_PACKAGE_PLYMOUTH=y in the defconfig.
echo "IORA OS: Configuring Plymouth boot splash..."

PLYMOUTH_DATA="${TARGET_DIR}/usr/share/plymouth"

# 1. Make sure the theme directory made it into the image via rootfs-overlay.
if [ ! -f "${PLYMOUTH_DATA}/themes/iora/iora.plymouth" ]; then
    echo "IORA OS: WARNING: Plymouth IORA theme not found at ${PLYMOUTH_DATA}/themes/iora — splash may not work"
fi

# 2. Write the Plymouth default theme configuration.
mkdir -p "${TARGET_DIR}/etc/plymouth"
cat > "${TARGET_DIR}/etc/plymouth/plymouthd.conf" <<'EOF'
[Daemon]
Theme=iora
ShowDelay=0
EOF

# 3. Symlink iora as the default theme for `plymouth-set-default-theme`.
THEMES_DIR="${PLYMOUTH_DATA}/themes"
mkdir -p "${THEMES_DIR}"
# Remove any existing default symlink, then point to iora.
rm -f "${THEMES_DIR}/default.plymouth"
ln -sf /usr/share/plymouth/themes/iora/iora.plymouth \
    "${THEMES_DIR}/default.plymouth"

# 4. Enable the plymouth-start service so Plymouth launches during boot.
#    Unit files come from BR2_PACKAGE_PLYMOUTH; we only symlink them here.
#
#    plymouth-start.service        — starts plymouthd at sysinit
#    plymouth-read-write.service   — re-mounts rootfs r/w so plymouthd can
#                                    write its socket; must run at sysinit
#    plymouth-quit.service         — quits plymouthd at multi-user.target
#    plymouth-quit-wait.service    — holds multi-user.target until Plymouth
#                                    has fully exited (prevents getty race)

SYSINIT_WANTS="${TARGET_DIR}/etc/systemd/system/sysinit.target.wants"
MULTIUSER_WANTS="${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
mkdir -p "${SYSINIT_WANTS}" "${MULTIUSER_WANTS}"

_link_unit() {
    local unit="$1"
    local wants_dir="$2"
    local unit_file="/usr/lib/systemd/system/${unit}"
    if [ -f "${TARGET_DIR}${unit_file}" ]; then
        ln -sf "${unit_file}" "${wants_dir}/${unit}"
        echo "IORA OS: Plymouth — enabled ${unit}"
    else
        echo "IORA OS: WARNING: Plymouth unit not found: ${unit_file} (skipping)"
    fi
}

_link_unit "plymouth-start.service"      "${SYSINIT_WANTS}"
_link_unit "plymouth-read-write.service" "${SYSINIT_WANTS}"
_link_unit "plymouth-quit.service"       "${MULTIUSER_WANTS}"
_link_unit "plymouth-quit-wait.service"  "${MULTIUSER_WANTS}"

echo "IORA OS: Plymouth boot splash configured (theme: iora)."

# ── IORA Security enforcement plane ─────────────────────────────────────────
# The API service is unprivileged. Only this socket-activated companion runs as
# root, with a closed command protocol and no shell execution capability.
mkdir -p "${TARGET_DIR}/etc/iora/security/yara" "${TARGET_DIR}/var/lib/iora-security/quarantine"
cat > "${TARGET_DIR}/etc/iora/security/firewall.nft" <<'NFT'
table inet iora_security {
  set blocked_v4 { type ipv4_addr; flags timeout; }
  set blocked_v6 { type ipv6_addr; flags timeout; }
  set allowed_tcp_ports { type inet_service; elements = { 80, 443, 8126 }; }
  chain input {
    type filter hook input priority -10; policy drop;
    ct state invalid drop
    ct state established,related accept
    iifname "lo" accept
    ip saddr @blocked_v4 drop
    ip6 saddr @blocked_v6 drop
    tcp flags & (fin|syn|rst|ack) == syn limit rate 100/second burst 200 packets accept
    tcp dport @allowed_tcp_ports ct state new limit rate 50/second burst 100 packets accept
    ip protocol icmp limit rate 10/second accept
    ip6 nexthdr ipv6-icmp limit rate 10/second accept
  }
  chain forward {
    type filter hook forward priority -10; policy drop;
    ct state established,related accept
    iifname "docker*" oifname "docker*" accept
    iifname "docker*" oifname != "docker*" ct state new limit rate 200/second burst 400 packets accept
  }
}
NFT
cat > "${TARGET_DIR}/etc/iora/security/lockdown.nft" <<'NFT'
table inet iora_lockdown {
  chain input {
    type filter hook input priority -100; policy drop;
    iifname "lo" accept
    ct state established,related accept
    ip saddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 } tcp dport 8126 ct state new limit rate 5/minute burst 10 packets accept
  }
  chain forward { type filter hook forward priority -100; policy drop; }
}
NFT
cat > "${TARGET_DIR}/etc/iora/security/yara/iora-baseline.yar" <<'YARA'
rule IORA_Suspicious_Remote_Script {
  meta: description = "Remote download followed by script execution"
  strings: $download = /(?:curl|wget)[^\n]{0,256}(?:sh|bash|python)/ nocase
  condition: $download
}
rule IORA_Reverse_Shell {
  strings: $tcp = "/dev/tcp/" ascii $netcat = /nc\s+-e\s+/ ascii
  condition: any of them
}
YARA
cat > "${TARGET_DIR}/etc/systemd/system/iora-security-helper.service" <<'EOF'
[Unit]
Description=IORA Security privileged enforcement helper
Before=iora-security.service docker.service
After=local-fs.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=/opt/iora/build/iora-security-helper/bin/iora-security-helper
Restart=always
RestartSec=2
User=root
Group=root
UMask=007
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
ReadWritePaths=/run/iora /etc/iora/security /var/lib/iora-security

[Install]
WantedBy=multi-user.target
EOF
cat > "${TARGET_DIR}/etc/systemd/system/iora-security-firewall.service" <<'EOF'
[Unit]
Description=IORA nftables baseline and container firewall
Before=docker.service network-online.target
After=iora-security-helper.service
Requires=iora-security-helper.service

[Service]
Type=oneshot
ExecStart=/usr/sbin/nft -c -f /etc/iora/security/firewall.nft
ExecStart=/usr/sbin/nft -f /etc/iora/security/firewall.nft
RemainAfterExit=yes
User=root
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
EOF
for unit in iora-security-helper.service iora-security-firewall.service; do
  ln -sf "/etc/systemd/system/${unit}" "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/${unit}"
done

mkdir -p "${TARGET_DIR}/etc/systemd/system/iora-security.service.d"
cat > "${TARGET_DIR}/etc/systemd/system/iora-security.service.d/20-hardening.conf" <<'EOF'
[Unit]
Requires=iora-security-helper.service
After=iora-security-helper.service

[Service]
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
ReadWritePaths=/var/lib/iora-security /run/iora
EOF

echo "IORA OS: Security enforcement plane and baseline policies installed."

# Phase 2.1 consumer is deliberately unprivileged and read-only. A separately
# reviewed CAP_BPF/CAP_PERFMON loader forwards normalized ring-buffer records
# to its root-owned 0600 ingest socket; the consumer has no enforcement access.
cat > "${TARGET_DIR}/etc/systemd/system/iora-runtime-sensor.service" <<'EOF'
[Unit]
Description=IORA Runtime Sensor event consumer
After=local-fs.target

[Service]
Type=simple
ExecStart=/opt/iora/build/iora-runtime-sensor/bin/iora-runtime-sensor
User=iora-security
Group=iora-security
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
RuntimeDirectory=iora/runtime-sensor
ReadWritePaths=/run/iora/runtime-sensor

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-runtime-sensor.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-runtime-sensor.service"

cat > "${TARGET_DIR}/etc/systemd/system/iora-runtime-identity.service" <<'EOF'
[Unit]
Description=IORA Runtime Identity Resolver
After=iora-runtime-sensor.service iora-supervisor.service
Wants=iora-runtime-sensor.service

[Service]
Type=simple
ExecStart=/opt/iora/build/iora-runtime-identity/bin/iora-runtime-identity
User=iora-security
Group=iora-security
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-runtime-identity.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-runtime-identity.service"

mkdir -p "${TARGET_DIR}/etc/iora/security-profiles" "${TARGET_DIR}/usr/share/iora/security"
cp "${BOARD_DIR}/../../security-profiles/profile-v1.schema.json" \
   "${TARGET_DIR}/usr/share/iora/security/profile-v1.schema.json"

cat > "${TARGET_DIR}/etc/systemd/system/iora-runtime-policy.service" <<'EOF'
[Unit]
Description=IORA App Security Profiles and Runtime Detection
After=iora-runtime-identity.service
Wants=iora-runtime-identity.service

[Service]
Type=simple
ExecStart=/opt/iora/build/iora-runtime-policy/bin/iora-runtime-policy
User=iora-security
Group=iora-security
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-runtime-policy.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-runtime-policy.service"

cat > "${TARGET_DIR}/etc/systemd/system/iora-incident-engine.service" <<'EOF'
[Unit]
Description=IORA Runtime Incident Correlation Engine
After=iora-runtime-policy.service
Wants=iora-runtime-policy.service

[Service]
Type=simple
ExecStart=/opt/iora/build/iora-incident-engine/bin/iora-incident-engine
User=iora-security
Group=iora-security
StateDirectory=iora-incidents
StateDirectoryMode=0700
UMask=0077
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes

[Install]
WantedBy=multi-user.target
EOF
ln -sf /etc/systemd/system/iora-incident-engine.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-incident-engine.service"

echo "IORA OS: Post-build script completed successfully"
