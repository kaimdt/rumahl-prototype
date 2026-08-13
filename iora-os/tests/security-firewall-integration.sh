#!/bin/sh
# Destructive appliance integration test. Run only in a disposable ORA OS VM.
set -eu

[ "${ORA_SECURITY_DESTRUCTIVE_TEST:-}" = "1" ] || {
  echo "set ORA_SECURITY_DESTRUCTIVE_TEST=1 in a disposable ORA OS VM" >&2
  exit 77
}
[ "$(id -u)" = 0 ] || { echo "root required" >&2; exit 77; }
command -v nft >/dev/null && command -v docker >/dev/null || exit 77

cleanup() { docker rm -f iora-security-firewall-test >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

systemctl restart iora-security-firewall.service
nft list table inet iora_security >/tmp/iora-security-before.nft
HOST_IP="$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')"
[ -n "$HOST_IP" ] || { echo "no externally routed IPv4 address" >&2; exit 77; }
docker run -d --name iora-security-firewall-test -p 39091:80 nginx:alpine >/dev/null
docker restart iora-security-firewall-test >/dev/null
nft list table inet iora_security >/tmp/iora-security-after.nft

# Docker may update its own tables, but must not delete or weaken ORA hooks.
grep -q 'hook input priority filter - 10; policy drop;' /tmp/iora-security-after.nft
grep -q 'hook forward priority filter - 10; policy drop;' /tmp/iora-security-after.nft
grep -q 'allowed_tcp_ports' /tmp/iora-security-after.nft
grep -q 'blocked_v4' /tmp/iora-security-after.nft
grep -q 'blocked_v6' /tmp/iora-security-after.nft
grep -q 'ip6 saddr @blocked_v6 drop' /tmp/iora-security-after.nft

# A Docker-published port absent from the ORA allow-list must not be reachable.
if curl --silent --fail --max-time 2 "http://${HOST_IP}:39091/" >/dev/null; then
  echo "Docker-published port bypassed ORA firewall policy" >&2
  exit 1
fi

echo "Docker restart preserved ORA policy and unapproved published port remained blocked"
