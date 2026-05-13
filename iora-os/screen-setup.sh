#!/usr/bin/env bash
# Start QEMU in screen session + auto-login via screen stuff
set -e

QEMU_PID="$1"
CACHE="$2"
SSH_PORT="${3:-2222}"

log()  { echo "[setup] $*"; }

log "Waiting for Debian to boot..."
log "Connect to console: screen -r iora-vm"

# Wait 60s for boot
for i in $(seq 1 30); do sleep 2; echo -n "."; done
echo ""

# Send setup via screen
log "Sending setup commands..."
screen -S iora-vm -X stuff "root"
sleep 3
screen -S iora-vm -X stuff "echo 'root:iora' | chpasswd"
sleep 1
screen -S iora-vm -X stuff "sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config"
sleep 1
screen -S iora-vm -X stuff "systemctl restart sshd"
sleep 3
screen -S iora-vm -X stuff "useradd -m -s /bin/bash -G sudo,docker iora 2>/dev/null; echo 'iora:iora' | chpasswd"
sleep 1
screen -S iora-vm -X stuff "mkdir -p /etc/iora && touch /etc/iora/ssh-ready && echo SETUP-DONE"
sleep 1

log "Setup complete. Waiting for SSH..."
for i in $(seq 1 30); do
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o BatchMode=yes \
         -p "$SSH_PORT" root@localhost "exit" 2>/dev/null; then
        log "SSH reachable!"
        exit 0
    fi
    sleep 2
    echo -n "."
done
echo ""
log "SSH not reachable. Check: screen -r iora-vm"
exit 1
