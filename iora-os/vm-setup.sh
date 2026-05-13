#!/usr/bin/env bash
# Minimal SSH setup helper – run THIS inside the VM after first boot
# Usage: curl -sSL http://10.0.2.2:8000/setup.sh | bash
# Or type these commands manually in the QEMU console

echo "IORA Dev VM – First Boot Setup"
echo "==============================="

# Set root password
echo "root:iora" | chpasswd 2>/dev/null
echo "[OK] Root password set"

# Enable SSH password login
sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null
echo "[OK] SSH password auth enabled"

# Enable root SSH login
sed -i 's/^#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null
sed -i 's/^PermitRootLogin without-password/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null
echo "[OK] Root SSH login enabled"

# Create iora user
useradd -m -s /bin/bash -G sudo,docker iora 2>/dev/null
echo "iora:iora" | chpasswd 2>/dev/null
echo "[OK] iora user created"

# Restart SSH
systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null
echo "[OK] SSH restarted"

# Mark as ready
mkdir -p /etc/iora
touch /etc/iora/ssh-ready

echo ""
echo "==============================="
echo "Setup complete! SSH is ready."
echo "  ssh -p 2222 root@localhost"
echo "  ssh -p 2222 iora@localhost"
echo "Password: iora"
