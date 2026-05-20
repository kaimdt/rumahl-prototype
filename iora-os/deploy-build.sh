#!/usr/bin/env bash
# ============================================================================
# deploy-build.sh – Deploy built Rust binaries from VM to system paths
# ============================================================================
set -euo pipefail

SSH_KEY="${HOME}/Documents/GitHub/home-assistant-dashb/iora-os/.cache/iora-dev-key"
VM_PORT=2222
VM_HOST="127.0.0.1"
BACKEND="/home/iora/iora/iora-os/backend"
TARGET_DIR="$BACKEND/target/debug"

SSH_OPTS=(
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
  -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=5
  -o LogLevel=ERROR -i "$SSH_KEY"
)

ssh_vm() { ssh "${SSH_OPTS[@]}" -p "$VM_PORT" "root@$VM_HOST" "$@"; }

echo "[*] Checking build status..."
STATUS=$(ssh_vm "cat /tmp/iora-build.status 2>/dev/null" || echo "")
if [ -z "$STATUS" ]; then
    echo "[!] Build still running. Check: ssh ... 'tail -f /tmp/iora-build.log'"
    echo "    Or attach: ssh ... 'tmux attach -t iora-build'"
    exit 1
fi
echo "[+] Build status: $STATUS"

echo "[*] Deploying binaries..."
BINARIES=$(ssh_vm "find $TARGET_DIR -maxdepth 1 -type f -executable -name 'iora-*' 2>/dev/null" || echo "")

if [ -z "$BINARIES" ]; then
    echo "[X] No iora-* binaries found in $TARGET_DIR"
    exit 1
fi

for bin_path in $BINARIES; do
    bin_name=$(basename "$bin_path")
    echo -n "    $bin_name ... "
    if ssh_vm "install -m 0755 '$bin_path' /usr/bin/'$bin_name'"; then
        echo "OK"
    else
        echo "FAILED"
    fi
done

echo "[*] Fixing systemd service files..."
# Fix StartLimitIntervalSec issue (should be in [Unit] section, not [Service])
ssh_vm bash << 'SVCFFIX'
# Move StartLimitIntervalSec from [Service] to [Unit] in the drop-in
sed -i 's/StartLimitIntervalSec=0//' /etc/systemd/system/iora-home.service.d/*.conf 2>/dev/null || true
sed -i '/^\[Unit\]$/a StartLimitIntervalSec=0' /etc/systemd/system/iora-home.service.d/*.conf 2>/dev/null || true

# Ensure ConditionPathExists checks /usr/bin/iora-home
if ! grep -q 'ConditionPathExists' /etc/systemd/system/iora-home.service 2>/dev/null; then
    sed -i '/^\[Unit\]$/a ConditionPathExists=/usr/bin/iora-home' /etc/systemd/system/iora-home.service 2>/dev/null
fi

systemctl daemon-reload
SVCFFIX

echo "[*] Starting iora-home..."
ssh_vm "systemctl start iora-home 2>&1"
sleep 3

echo "[*] Checking iora-home status..."
ssh_vm "systemctl is-active iora-home"

echo
echo "[*] Testing health endpoint..."
curl -sf --max-time 5 "http://${VM_HOST}:8126/api/health" 2>/dev/null && echo "[+] Health OK" || \
curl -sf --max-time 5 "http://${VM_HOST}:8126/health" 2>/dev/null && echo "[+] Health OK" || \
echo "[!] Health check failed. Check: ssh ... 'journalctl -u iora-home -n 50'"

echo
echo "[+] Done! Dashboard: https://localhost"
