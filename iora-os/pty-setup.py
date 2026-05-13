#!/usr/bin/env python3
"""Send setup commands to VM via serial PTY."""
import os, sys, time

PTY = sys.argv[1] if len(sys.argv) > 1 else None
if not PTY or not os.path.exists(PTY):
    print(f"ERROR: PTY {PTY} not found", file=sys.stderr)
    sys.exit(1)

print(f"[pty-setup] Opening {PTY}...")
fd = os.open(PTY, os.O_RDWR)
print("[pty-setup] Connected. Sending commands...")

def send(cmd, wait=1):
    os.write(fd, cmd.encode() + b'\n')
    time.sleep(wait)

send('', 0.5)         # Wake up console
send('root', 4)       # Login (no password on Debian serial)
send("echo 'root:iora' | chpasswd", 1)
send("sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config", 1)
send("systemctl restart sshd", 4)
send("useradd -m -s /bin/bash -G sudo iora 2>/dev/null; echo 'iora:iora' | chpasswd", 1)
send("mkdir -p /etc/iora && touch /etc/iora/ssh-ready && echo SETUP-OK", 1)

os.close(fd)
print("[pty-setup] Done!")
