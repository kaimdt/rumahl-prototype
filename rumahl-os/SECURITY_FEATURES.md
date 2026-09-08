# rumahl OS Security Features

## Overview

rumahl OS implements multiple layers of security to protect your smart home infrastructure. This document describes the security features available on different hardware platforms.

## Platform-Specific Security

### x86_64 Platform (Full Security Stack)

The x86_64 build includes comprehensive security features:

#### 1. Trusted Platform Module (TPM 2.0)

**Available Packages:**
- `tpm2-tools` - Command-line tools for TPM 2.0
- `tpm2-tss` - TPM 2.0 Software Stack
- `tpm2-abrmd` - TPM 2.0 Access Broker & Resource Manager

**TPM Use Cases:**
- Secure key storage and generation
- Platform attestation (verify boot integrity)
- Sealed secrets (decrypt data only on trusted system state)
- Random number generation (hardware RNG)

**Basic TPM Commands:**

```bash
# Check TPM status
tpm2_getcap properties-fixed

# Generate and store a key
tpm2_createprimary -C o -g sha256 -G rsa -c primary.ctx
tpm2_create -C primary.ctx -g sha256 -G rsa -u key.pub -r key.priv

# Get random bytes from TPM
tpm2_getrandom 32 --hex
```

#### 2. Secure Boot

**Available Packages:**
- `efivar` - EFI variable manipulation
- `mokutil` - Machine Owner Key management
- `sbsigntool` - Signing tools for UEFI binaries

**Secure Boot Status:**

```bash
# Check Secure Boot status
mokutil --sb-state

# List enrolled keys
efivar -l | grep -i key
```

**Key Enrollment:**
To enroll your own keys for Secure Boot, see the Buildroot documentation on signing kernels and bootloaders.

#### 3. Full Disk Encryption (LUKS)

**Available Package:**
- `cryptsetup` - LUKS encryption management

**Encrypting Data Partition:**

```bash
# Create encrypted partition
cryptsetup luksFormat /dev/sda5

# Open encrypted partition
cryptsetup luksOpen /dev/sda5 rumahl-data

# Mount encrypted partition
mount /dev/mapper/rumahl-data /mnt
```

#### 4. Hardware Security

**Available Packages:**
- `rng-tools` - Hardware random number generator daemon
- `haveged` - Entropy harvesting daemon
- `libgcrypt` - Cryptographic library
- `libtasn1` - ASN.1 library for certificate handling

### ARM64/Raspberry Pi Platform (Optimized Security)

The Raspberry Pi build includes security features suitable for ARM hardware:

#### 1. Hardware Random Number Generation

**Available Packages:**
- `rng-tools` - Uses Raspberry Pi hardware RNG
- `haveged` - Backup entropy source

The Raspberry Pi has a built-in hardware random number generator that provides high-quality entropy for cryptographic operations.

**Check RNG Status:**

```bash
# Check available entropy
cat /proc/sys/kernel/random/entropy_avail

# Start rngd if not running
systemctl start rngd
```

#### 2. Limited TPM Support

Most Raspberry Pi models do not include a TPM by default. However, you can add TPM support via:

- **External TPM Modules:** Add-on boards like Infineon OPTIGA TPM SLB 9670
- **Software TPM:** Use `swtpm` for development/testing (not for production security)

#### 3. AppArmor Support

**Available on Both Platforms:**
- `apparmor` - Mandatory Access Control (MAC)
- `apparmor-utils` - Profile management tools

**Managing AppArmor:**

```bash
# Check AppArmor status
aa-status

# Enable/disable profiles
aa-enforce /etc/apparmor.d/usr.bin.docker
aa-complain /etc/apparmor.d/usr.bin.docker
aa-disable /etc/apparmor.d/usr.bin.docker

# Generate profile for application
aa-genprof /usr/bin/myapp
```

## System Hardening

### 1. Update System (RAUC)

rumahl OS uses RAUC for secure, atomic system updates with rollback capability.

**Available Packages:**
- `rauc` - Update client
- `rauc-service` - D-Bus service
- `rauc-network` - Network update support

**Update Commands:**

```bash
# Check current system slot
rauc status

# Install update bundle
rauc install /path/to/update.raucb

# Mark slot as good (after testing)
rauc status mark-good

# Rollback to previous version
rauc status mark-bad
reboot
```

### 2. Network Security

**Available Packages:**
- `openssh` - Secure remote access
- `openssl` - TLS/SSL library
- `ca-certificates` - Trusted certificate authorities
- `iptables` - Firewall

**SSH Hardening:**

Edit `/etc/ssh/sshd_config`:

```
# Disable password authentication (use keys only)
PasswordAuthentication no
PubkeyAuthentication yes

# Disable root login
PermitRootLogin no

# Use only strong ciphers
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
```

Restart SSH:
```bash
systemctl restart sshd
```

**Firewall Setup:**

```bash
# Default deny incoming
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow established connections
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Allow SSH (change port as needed)
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow Home Assistant (if applicable)
iptables -A INPUT -p tcp --dport 8123 -j ACCEPT

# Save rules
iptables-save > /etc/iptables.rules
```

### 3. SD Card Longevity Optimizations

When rumahl OS is installed on SD cards, USB flash drives, or eMMC storage, the installer automatically applies optimizations to extend storage lifespan.

**Automatic Optimizations:**

1. **Mount Options:**
   - `noatime` - Don't update access times (reduces writes)
   - `commit=600` - Batch filesystem commits every 10 minutes

2. **ZRAM for Temporary Storage:**
   - Compressed RAM disk for `/tmp`
   - Reduces physical writes to storage
   - 512MB allocated for temporary files

3. **Log Rotation:**
   - Daily rotation with compression
   - Keep only 3 days of logs
   - Reduces log write amplification

4. **Status File:**
   Check if optimizations are active:
   ```bash
   cat /etc/rumahl-storage.conf
   ```

**Manual Optimization Commands:**

```bash
# Check ZRAM status
zramctl

# Monitor disk writes
iostat -x 5

# Check SMART health (if supported)
smartctl -a /dev/mmcblk0
```

## Security Best Practices

### 1. Change Default Password

**During Installation:**
The installer prompts for a new root password. Never use the default password in production.

**After Installation:**
```bash
passwd root
```

### 2. Enable Automatic Updates

Configure RAUC to check for updates regularly:

```bash
# Edit RAUC configuration
nano /etc/rauc/system.conf

# Add update URL and enable automatic checks
[system]
compatible=rumahl-OS-RPI4
bootloader=uboot

[handlers]
system-info=/usr/lib/rauc/system-info

[network]
update-url=https://updates.ora.example.com/
auto-install=true
check-interval=3600
```

### 3. Docker Security

rumahl OS includes Docker with AppArmor support. Enable container security:

```bash
# Run containers with security options
docker run --security-opt apparmor=docker-default \
           --read-only \
           --tmpfs /tmp \
           --cap-drop ALL \
           --cap-add NET_BIND_SERVICE \
           mycontainer
```

### 4. Monitor System Logs

```bash
# View system logs
journalctl -xe

# Follow logs in real-time
journalctl -f

# Check authentication logs
journalctl -u ssh

# Check for failed login attempts
journalctl | grep "Failed password"
```

### 5. Regular Security Audits

```bash
# Check for listening services
ss -tulpn

# Check for unauthorized users
cat /etc/passwd

# Review sudo access
cat /etc/sudoers

# Check file permissions on sensitive files
ls -la /etc/shadow /etc/ssh/sshd_config
```

## Compliance and Standards

rumahl OS security features align with:

- **NIST Cybersecurity Framework** - Identify, Protect, Detect, Respond, Recover
- **CIS Benchmarks** - Hardened system configuration
- **OWASP IoT Top 10** - Secure IoT device development

## Hardware Security Recommendations

### For x86_64 Systems:

1. **Enable Secure Boot** in UEFI/BIOS settings
2. **Enable TPM** in UEFI/BIOS settings (if available)
3. **Set BIOS/UEFI password** to prevent tampering
4. **Disable unused boot devices** (USB, network boot)

### For Raspberry Pi:

1. **Use high-quality SD cards** (Class 10, UHS-I or better)
2. **Consider external TPM module** for critical deployments
3. **Disable unused interfaces** (GPIO, I2C, SPI if not needed)
4. **Physical security** - Secure device in locked enclosure

## Troubleshooting

### TPM Not Detected (x86_64)

```bash
# Check if TPM device exists
ls /dev/tpm*

# Check kernel module
lsmod | grep tpm

# Load TPM module if needed
modprobe tpm_tis
```

### Secure Boot Verification Failed

```bash
# Check Secure Boot status
mokutil --sb-state

# If disabled, enable in UEFI settings
# If enabled but failing, check key enrollment

# List enrolled keys
mokutil --list-enrolled
```

### AppArmor Blocking Application

```bash
# Check AppArmor denials
dmesg | grep -i apparmor

# Put profile in complain mode (learning)
aa-complain /etc/apparmor.d/profile-name

# After testing, enforce again
aa-enforce /etc/apparmor.d/profile-name
```

## Additional Resources

- [Buildroot Security Documentation](https://buildroot.org/downloads/manual/manual.html#_security)
- [TPM 2.0 Tools Documentation](https://tpm2-tools.readthedocs.io/)
- [AppArmor Documentation](https://gitlab.com/apparmor/apparmor/-/wikis/home)
- [RAUC Documentation](https://rauc.readthedocs.io/)

## Getting Help

For security issues or questions:

1. Check system logs: `journalctl -xe`
2. Review this documentation
3. Consult Buildroot and package-specific documentation
4. Report security vulnerabilities responsibly

---

**Last Updated:** 2026-04-22
**rumahl OS Version:** Based on Buildroot with Linux 6.6.15
