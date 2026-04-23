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
[Match]
Name=eth* en* eno* ens* enp* enx*
Type=ether

[Network]
DHCP=yes
IPv6AcceptRA=yes
LLMNR=no
MulticastDNS=no

[DHCPv4]
UseDNS=yes
UseNTP=yes
UseHostname=no
RouteMetric=100

[DHCPv6]
UseDNS=yes
UseNTP=yes

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
# JSON schema (POST /api/network in the Control Center would send this):
#   {"mode":"dhcp"|"static","ipv4":"…/…","gateway4":"…","ipv6":"…/…",
#    "gateway6":"…","dns":["…","…"],"accept_ra":true,
#    "match":"eth* en* eno* ens* enp* enx*","hostname":"foo"}
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


def cfg_to_ini(cfg):
    mode = cfg.get("mode", "dhcp").lower()
    if mode not in ("dhcp", "static"):
        die(f"invalid mode {mode!r}")
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

    if mode == "dhcp":
        lines.append("DHCP=yes")
        lines.append(f"IPv6AcceptRA={'yes' if accept_ra else 'no'}")
        for s in dns:
            lines.append(f"DNS={s}")
        lines += [
            "", "[DHCPv4]",
            f"UseDNS={'false' if dns else 'true'}",
            "UseNTP=true",
            "UseHostname=no",
            "RouteMetric=100",
            "", "[DHCPv6]",
            f"UseDNS={'false' if dns else 'true'}",
            "UseNTP=true",
        ]
    else:  # static
        v4 = cfg.get("ipv4")
        gw4 = cfg.get("gateway4")
        v6 = cfg.get("ipv6")
        gw6 = cfg.get("gateway6")
        if not v4 and not v6:
            die("static mode requires at least one of ipv4/ipv6")
        if v4:
            v4 = validate_cidr(v4, "v4")
            lines.append(f"Address={v4}")
            if gw4:
                gw4 = validate_ip(gw4, "v4")
                lines.append(f"Gateway={gw4}")
        if v6:
            v6 = validate_cidr(v6, "v6")
            lines.append(f"Address={v6}")
            if gw6:
                gw6 = validate_ip(gw6, "v6")
                lines.append(f"Gateway={gw6}")
            lines.append(f"IPv6AcceptRA={'yes' if accept_ra and not gw6 else 'no'}")
        else:
            lines.append(f"IPv6AcceptRA={'yes' if accept_ra else 'no'}")
        for s in dns:
            lines.append(f"DNS={s}")

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
    s.add_argument("--dhcp", action="store_true")
    s.add_argument("--static", action="store_true")
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
            if args.dhcp and args.static:
                die("--dhcp and --static are mutually exclusive")
            cfg = {"mode": "dhcp" if args.dhcp or not args.static else "static"}
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
  "exec-opts": ["native.cgroupdriver=systemd"]
}
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

# Auto-mount data partition at /mnt/data.
# `nofail` is critical: on a freshly-dd'd disk, in VMs where the iora-data
# label is not present yet, or when the installer hasn't run, a missing
# label would drop the system into emergency.target. With nofail the mount
# unit simply stays inactive and dependent services skip via their
# ConditionPathIsMountPoint=/mnt/data.
cat > "${TARGET_DIR}/etc/systemd/system/mnt-data.mount" <<'EOF'
[Unit]
Description=IORA Data Partition
DefaultDependencies=no
After=systemd-fsck@dev-disk-by\x2dlabel-iora\x2ddata.service
Before=local-fs.target
# Don't consider a missing data label a boot failure.
ConditionPathExists=/dev/disk/by-label/iora-data

[Mount]
What=/dev/disk/by-label/iora-data
Where=/mnt/data
Type=ext4
Options=defaults,noatime,nofail,x-systemd.device-timeout=10s

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
RequiresMountsFor=/mnt/data
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

# Install systemd service for Docker Compose
cat > "${TARGET_DIR}/etc/systemd/system/iora-stack.service" <<'EOF'
[Unit]
Description=IORA Docker Stack
# Wants (not Requires): if docker/network are briefly unavailable we still
# try and simply exit cleanly on retry rather than spamming "Failed to start"
# on every Restart= attempt.
Wants=docker.service iora-init-data.service network-online.target
After=docker.service network-online.target iora-init-data.service
ConditionPathIsDirectory=/mnt/data/iora
StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/mnt/data/iora
# Skip everything when we're running on the hello-world placeholder —
# otherwise `docker compose pull` downloads hello-world + sleeps 15s +
# retries, adding a minute to every boot on a fresh install that the
# user hasn't populated yet. Once real services are dropped in this
# pre-check exits 0 and the rest of ExecStartPre runs normally.
ExecStartPre=/bin/sh -c '\
  if [ ! -f /mnt/data/iora/docker-compose.yml ]; then \
    printf "version: \\"3.8\\"\\nservices:\\n  placeholder:\\n    image: hello-world\\n" \
      > /mnt/data/iora/docker-compose.yml; \
  fi; \
  if grep -q "image: hello-world" /mnt/data/iora/docker-compose.yml \
     && ! grep -q "ghcr.io/.*iora" /mnt/data/iora/docker-compose.yml; then \
    echo "iora-stack: placeholder compose detected, skipping pull/up"; \
    exit 0; \
  fi; \
  # Retry pulls if the network is flaky (best-effort; exit 0 anyway). \
  for i in 1 2 3; do /usr/bin/docker compose pull && break || sleep 5; done; \
  exit 0'
ExecStart=/bin/sh -c '\
  if grep -q "image: hello-world" /mnt/data/iora/docker-compose.yml \
     && ! grep -q "ghcr.io/.*iora" /mnt/data/iora/docker-compose.yml; then \
    echo "iora-stack: placeholder compose, not starting containers"; \
    exit 0; \
  fi; \
  /usr/bin/docker compose up -d --remove-orphans || true'
# Only reconcile a second time when we have a real stack.
ExecStartPost=/bin/sh -c '\
  if grep -q "image: hello-world" /mnt/data/iora/docker-compose.yml \
     && ! grep -q "ghcr.io/.*iora" /mnt/data/iora/docker-compose.yml; then \
    exit 0; \
  fi; \
  sleep 10 && /usr/bin/docker compose up -d --remove-orphans || true'
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose up -d --remove-orphans
# Don't cascade "Failed to start" on every retry when the user simply
# hasn't populated /mnt/data/iora yet or docker is briefly unavailable:
# exit 0 on compose errors, let iora-stack-watchdog.timer pick it up later.
SuccessExitStatus=0 1
Restart=no
# Generous but not crazy: 3 min covers a normal pull+up of a real stack.
# Placeholder path returns in <1s.
TimeoutStartSec=180
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

# Periodic watchdog for the stack: if any compose service has exited, run
# `compose up -d` again.  Complements the in-container iora-watchdog.
cat > "${TARGET_DIR}/etc/systemd/system/iora-stack-watchdog.service" <<'EOF'
[Unit]
Description=IORA Stack Watchdog
After=iora-stack.service docker.service
Wants=docker.service
ConditionPathIsDirectory=/mnt/data/iora
ConditionPathExists=/mnt/data/iora/docker-compose.yml

[Service]
Type=oneshot
WorkingDirectory=/mnt/data/iora
ExecStart=/bin/sh -c '\
  STOPPED=$(/usr/bin/docker compose ps --status exited --services 2>/dev/null | wc -l); \
  if [ "$STOPPED" -gt 0 ]; then \
    echo "[iora-stack-watchdog] restarting $STOPPED stopped service(s)"; \
    /usr/bin/docker compose up -d --remove-orphans || true; \
  fi; \
  exit 0'
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

# Enable IORA stack service
ln -sf /etc/systemd/system/iora-stack.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-stack.service"

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

# ── Hardened Chrony drop-in ─────────────────────────────────────────────────
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
cat > "${TARGET_DIR}/etc/apparmor.d/iora-supervisor" <<'EOF'
#include <tunables/global>

/app/iora-supervisor {
  #include <abstractions/base>

  # Docker socket access
  /var/run/docker.sock rw,

  # Binary execution
  /app/iora-supervisor r,

  # Network
  network inet stream,
  network inet6 stream,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-security" <<'EOF'
#include <tunables/global>

/app/iora-security {
  #include <abstractions/base>

  # Binary execution
  /app/iora-security r,

  # Security database
  /var/lib/iora/security.db rwk,

  # Network
  network inet stream,
  network inet6 stream,

  # PostgreSQL client
  /usr/lib/** rm,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-secrets" <<'EOF'
#include <tunables/global>

/app/iora-secrets {
  #include <abstractions/base>

  # Binary execution
  /app/iora-secrets r,

  # Network
  network inet stream,
  network inet6 stream,

  # PostgreSQL client
  /usr/lib/** rm,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-gateway" <<'EOF'
#include <tunables/global>

/app/iora-gateway {
  #include <abstractions/base>

  # Binary execution
  /app/iora-gateway r,

  # Gateway database
  /var/lib/iora/gateway.db rwk,

  # Network (restricted)
  network inet stream,
  network inet6 stream,

  # Deny certain capabilities
  deny capability sys_admin,
  deny capability sys_module,
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

# Create iora-setup.service (first-boot setup wizard)
cat > "${TARGET_DIR}/etc/systemd/system/iora-setup.service" <<'EOF'
[Unit]
Description=IORA Home First-Boot Setup Wizard
After=network-online.target iora-init-data.service docker.service
Wants=network-online.target
Before=iora-stack.service
ConditionPathExists=!/mnt/data/iora/.setup-complete
ConditionPathIsDirectory=/mnt/data/iora

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/iora/setup/setup-server.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable iora-setup service
ln -sf /etc/systemd/system/iora-setup.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-setup.service"

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
        printf "  %-14s http://%s:8080\n" "Control Center:" "$hostpart"
    fi
    printf "  %-14s /opt/iora/docs\n" "Documentation:"
    printf "\n"
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

# The recovery service boots from a secondary grub entry.  When the user
# selects it, grub passes `iora.recovery=1` on the kernel command line; a
# tiny unit checks for that and, if present, runs iora-updater with a
# --recover flag that forces a RAUC install of the latest stable bundle.
cat > "${TARGET_DIR}/etc/systemd/system/iora-recovery.service" <<'EOF'
[Unit]
Description=IORA OS online recovery
After=network-online.target iora-init-data.service
Wants=network-online.target
ConditionKernelCommandLine=iora.recovery=1

[Service]
Type=oneshot
ExecStart=/usr/bin/iora-updater --yes --channel stable
ExecStartPost=/bin/systemctl reboot
StandardOutput=journal
StandardError=journal

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
    echo "IORA OS: Installing OS dev bridge..."
    mkdir -p "${TARGET_DIR}/etc/iora"

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
    # share credentials.
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' \
        > "${TARGET_DIR}/etc/iora/dev-token"
    chmod 0600 "${TARGET_DIR}/etc/iora/dev-token"

    cat > "${TARGET_DIR}/etc/systemd/system/iora-dev-bridge.service" <<'EOF'
[Unit]
Description=IORA Developer Bridge (OS dev images only)
After=network.target docker.service iora-init-data.service
Wants=network.target
ConditionPathExists=/etc/iora/os-dev-mode
ConditionPathExists=/usr/bin/iora-dev-bridge

[Service]
Type=simple
Environment=IORA_DEV_BIND=127.0.0.1:8099
EnvironmentFile=-/etc/iora/dev-bridge.env
ExecStart=/usr/bin/iora-dev-bridge
Restart=on-failure
RestartSec=2
# Dev mode needs broad rights to swap binaries and talk to docker/systemctl,
# but we still strip the obvious sharp edges.
ProtectHome=yes
NoNewPrivileges=no
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    ln -sf /etc/systemd/system/iora-dev-bridge.service \
        "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-dev-bridge.service"
else
    # Defence in depth: on a production build, make absolutely sure no
    # stale dev artefacts from a previous build survive in the rootfs.
    rm -f "${TARGET_DIR}/etc/iora/os-dev-mode" \
          "${TARGET_DIR}/etc/iora/dev-mode" \
          "${TARGET_DIR}/etc/iora/dev-token" \
          "${TARGET_DIR}/etc/systemd/system/iora-dev-bridge.service" \
          "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-dev-bridge.service" \
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

echo "IORA OS: Post-build script completed successfully"
