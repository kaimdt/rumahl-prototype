#!/usr/bin/env bash
# login-vm.sh – Auto-login to Debian VM via serial PTY
# Usage: ./login-vm.sh $QEMU_PID $CACHE_DIR
set -e

QEMU_PID="$1"
CACHE="$2"
[ -z "$QEMU_PID" ] && { echo "Usage: $0 <qemu_pid> <cache_dir>"; exit 1; }
[ -d "$CACHE" ] || CACHE="/tmp"

echo "[serial] Waiting for QEMU PTY..."

# Find QEMU's PTY: diff /dev/ttys before/after
TTYS_BEFORE=$(ls /dev/ttys* 2>/dev/null | sort)
sleep 2
TTYS_AFTER=$(ls /dev/ttys* 2>/dev/null | sort)
PTY=$(comm -13 <(echo "$TTYS_BEFORE") <(echo "$TTYS_AFTER") | head -1)

# Fallback: scan by QEMU stderr log
if [ -z "$PTY" ]; then
    for t in $(ls -t /dev/ttys[0-9]* 2>/dev/null); do
        if fuser "$t" 2>/dev/null | tr ' ' '\n' | grep -q "^${QEMU_PID}$"; then
            PTY="$t"; break
        fi
    done
fi

# Fallback: lsof
if [ -z "$PTY" ] && command -v lsof >/dev/null 2>&1; then
    PTY=$(lsof -p "$QEMU_PID" 2>/dev/null | grep '/dev/ttys' | awk '{print $NF}' | head -1)
fi

if [ -z "$PTY" ] || [ ! -c "$PTY" ]; then
    echo "[serial] Could not find QEMU PTY. QEMU PID=$QEMU_PID"
    echo "[serial] Available ttys: $(ls /dev/ttys* 2>/dev/null | tr '\n' ' ')"
    exit 1
fi

echo "[serial] QEMU console: $PTY"

# Wait for login prompt (read PTY output)
echo "[serial] Waiting for login prompt..."
python3 -c "
import os, time, sys, fcntl
fd = os.open('$PTY', os.O_RDONLY | os.O_NOCTTY)
fl = fcntl.fcntl(fd, fcntl.F_GETFL)
fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
buf = b''
start = time.time()
while time.time() - start < 120:
    try:
        data = os.read(fd, 4096)
        if data:
            buf += data
            sys.stdout.buffer.write(data)
            sys.stdout.flush()
            if b'login:' in buf:
                break
    except BlockingIOError:
        time.sleep(0.5)
os.close(fd)
" 2>/dev/null || true

echo ""
echo "[serial] Sending setup commands to $PTY..."

# Send setup via Python
python3 -c "
import os, time
fd = os.open('$PTY', os.O_WRONLY | os.O_NOCTTY)
# Root login (Debian cloud: no password on serial)
time.sleep(0.5)
os.write(fd, b'\n')
time.sleep(0.5)
os.write(fd, b'root\n')
time.sleep(3)
# Set passwords + enable SSH
os.write(fd, b'echo \"root:iora\" | chpasswd\n')
time.sleep(1)
os.write(fd, b'sed -i \"s/^PasswordAuthentication no/PasswordAuthentication yes/\" /etc/ssh/sshd_config\n')
time.sleep(1)
os.write(fd, b'systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null\n')
time.sleep(3)
# Create iora user
os.write(fd, b'useradd -m -s /bin/bash -G sudo,docker iora 2>/dev/null; echo \"iora:iora\" | chpasswd\n')
time.sleep(1)
os.write(fd, b'mkdir -p /etc/iora && touch /etc/iora/ssh-ready\n')
os.write(fd, b'echo DONE\n')
time.sleep(1)
os.close(fd)
" 2>/dev/null

echo "[serial] Setup complete. SSH should be ready."
exit 0
