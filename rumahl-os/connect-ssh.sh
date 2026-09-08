#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# connect-ssh.sh – SSH into the rumahl dev VM
# ═══════════════════════════════════════════════════════════════════
# Usage: ./connect-ssh.sh [port] [user]
#   ./connect-ssh.sh              # root@127.0.0.1:2222
#   ./connect-ssh.sh 2222 ora    # ora@127.0.0.1:2222
# ═══════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_KEY="$SCRIPT_DIR/.cache/rumahl-dev-key"
PORT="${1:-2222}"
USER="${2:-root}"

if [ ! -f "$SSH_KEY" ]; then
    echo -e "\033[0;31m[X]\033[0m SSH key not found: $SSH_KEY"
    echo "    Start the VM first: ./dev-local.sh"
    exit 1
fi

chmod 600 "$SSH_KEY" 2>/dev/null || true

echo -e "\033[0;36m[*]\033[0m Connecting to rumahl Dev VM..."
echo "    User: $USER"
echo "    Port: $PORT"
echo "    Key:  $SSH_KEY"
echo ""

exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o AddressFamily=inet -i "$SSH_KEY" -p "$PORT" "${USER}@127.0.0.1"
