#!/bin/sh
# Destructive appliance integration test. Run only in a disposable rumahl OS VM.
set -eu

[ "${RUMAHL_SECURITY_DESTRUCTIVE_TEST:-}" = "1" ] || {
  echo "set RUMAHL_SECURITY_DESTRUCTIVE_TEST=1 in a disposable rumahl OS VM" >&2
  exit 77
}
[ "$(id -u)" = 0 ] || { echo "root required" >&2; exit 77; }
command -v nft >/dev/null && command -v docker >/dev/null || exit 77

cleanup() { docker rm -f rumahl-security-firewall-test >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

systemctl restart rumahl-security-firewall.service
nft list table inet rumahl_security >/tmp/rumahl-security-before.nft
HOST_IP="$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
[ -n "$HOST_IP" ] || { echo "no externally routed IPv4 address" >&2; exit 77; }
docker run -d --name rumahl-security-firewall-test -p 39091:80 nginx:alpine >/dev/null
docker restart rumahl-security-firewall-test >/dev/null
nft list table inet rumahl_security >/tmp/rumahl-security-after.nft

# Docker may update its own tables, but must not delete or weaken rumahl hooks.
grep -q 'hook input priority filter - 10; policy drop;' /tmp/rumahl-security-after.nft
grep -q 'hook forward priority filter - 10; policy drop;' /tmp/rumahl-security-after.nft
grep -q 'allowed_tcp_ports' /tmp/rumahl-security-after.nft
grep -q 'blocked_v4' /tmp/rumahl-security-after.nft
grep -q 'blocked_v6' /tmp/rumahl-security-after.nft
grep -q 'ip6 saddr @blocked_v6 drop' /tmp/rumahl-security-after.nft

# A Docker-published port absent from the rumahl allow-list must not be reachable.
if curl --silent --fail --max-time 2 "http://${HOST_IP}:39091/" >/dev/null; then
  echo "Docker-published port bypassed rumahl firewall policy" >&2
  exit 1
fi

echo "Docker restart preserved rumahl policy and unapproved published port remained blocked"
