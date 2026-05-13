#!/usr/bin/env python3
"""Inject SSH authorized_keys + enable password auth into Debian cloud qcow2."""
import subprocess, sys, os, tempfile

def main():
    if len(sys.argv) < 2:
        print("Usage: inject-ssh.py <disk.qcow2> [ssh_pubkey]", file=sys.stderr)
        sys.exit(1)
    
    qcow2 = os.path.abspath(sys.argv[1])
    if not os.path.isfile(qcow2):
        print(f"ERROR: {qcow2} not found", file=sys.stderr)
        sys.exit(1)
    
    # Read or generate SSH public key
    ssh_dir = os.path.join(os.path.dirname(qcow2))
    key_file = os.path.join(ssh_dir, "iora-dev-key.pub")
    
    if len(sys.argv) > 2 and os.path.isfile(sys.argv[2]):
        with open(sys.argv[2]) as f:
            pubkey = f.read().strip()
    elif os.path.isfile(key_file):
        with open(key_file) as f:
            pubkey = f.read().strip()
    else:
        print("Generating SSH key...")
        subprocess.run(["ssh-keygen", "-t", "ed25519", "-f", 
                       key_file.replace(".pub", ""), "-N", "", "-C", "iora-dev"],
                      check=False)
        if os.path.isfile(key_file):
            with open(key_file) as f:
                pubkey = f.read().strip()
        else:
            print("ERROR: Could not generate SSH key", file=sys.stderr)
            sys.exit(1)
    
    script = f'''#!/bin/sh
echo "[inject] Starting..."
modprobe nbd max_part=16 2>/dev/null
echo "[inject] Connecting nbd..."
qemu-nbd --connect=/dev/nbd0 /disk.qcow2
sleep 1
echo "[inject] Finding root partition..."
for p in /dev/nbd0p1 /dev/nbd0p2 /dev/nbd0p3; do
    [ -b "$p" ] || continue
    echo "[inject] Trying $p..."
    mkdir -p /mnt/root
    if mount "$p" /mnt/root 2>/dev/null; then
        if [ -f /mnt/root/etc/ssh/sshd_config ]; then
            echo "[inject] Found root at $p"
            ROOT_OK=1
            break
        fi
        umount /mnt/root 2>/dev/null
    fi
done
if [ -z "$ROOT_OK" ]; then
    echo "[inject] ERROR: Could not find root partition"
    exit 1
fi
echo "[inject] Writing SSH config..."
mkdir -p /mnt/root/root/.ssh
echo '{pubkey}' >> /mnt/root/root/.ssh/authorized_keys
chmod 700 /mnt/root/root/.ssh
chmod 600 /mnt/root/root/.ssh/authorized_keys
sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /mnt/root/etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /mnt/root/etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/^PermitRootLogin.*/PermitRootLogin yes/' /mnt/root/etc/ssh/sshd_config 2>/dev/null || true
echo "[inject] Done. Unmounting..."
umount /mnt/root
qemu-nbd --disconnect /dev/nbd0 2>/dev/null
echo "[inject] SUCCESS"
'''
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as f:
        f.write(script)
        spath = f.name
    
    try:
        print("[inject] Running via Docker...")
        result = subprocess.run(
            ["docker", "run", "--rm", "--privileged",
             "-v", f"{qcow2}:/disk.qcow2",
             "-v", f"{spath}:/inject.sh",
             "alpine:latest", "sh", "-c",
             "apk add --no-cache qemu-img qemu-system-x86_64 >/dev/null 2>&1; sh /inject.sh"],
            capture_output=True, text=True, timeout=60
        )
        for line in result.stdout.split('\n'):
            if line.strip():
                print(line.strip())
        if result.returncode != 0:
            print(result.stderr, file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        os.unlink(spath)

if __name__ == "__main__":
    main()
