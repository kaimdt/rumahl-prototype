# IORA Dev VM - 100% IORA OS Compatibility Guide

This document describes how IORA Dev VM achieves 100% compatibility with IORA OS, ensuring that programs and services run identically on both platforms.

## Overview

IORA Dev VM is a development environment that perfectly mirrors IORA OS in terms of:
- **File system structure** (paths, directories)
- **Service management** (systemd units, startup order)
- **Configuration access** (Global Config API)
- **Logging** (journald, live streaming)
- **Environment variables** (identical to IORA OS)
- **Network configuration** (systemd-networkd)
- **Docker setup** (daemon.json, security settings)

## Compatibility Guarantees

### 1. Identical Path Structure

Both IORA OS and Dev VM use the same paths:

```
/etc/iora/              # OS configuration
/opt/iora/data/         # Service data directories
/opt/iora/build/        # Built binaries and frontend
/usr/bin/iora-*         # System tools and CLI
/usr/lib/iora/          # Helper scripts and libraries
/mnt/data/iora/         # Data partition (tmpfs in Dev VM)
/var/lib/iora/          # Runtime state
/tmp/iora-sandboxes/    # Plugin sandboxes
```

**Verification:**
```bash
# Check all critical paths exist
ls -la /etc/iora /opt/iora /usr/lib/iora /mnt/data/iora
```

### 2. Service Management

All services are managed via systemd with identical unit files:

```bash
# List all IORA services
systemctl list-units 'iora-*'

# Check service status
systemctl status iora-home

# Restart a service
systemctl restart iora-core
```

**Service naming:** `iora-<service>.service`
- `iora-core` - Service registry (port 8090)
- `iora-home` - Main API (port 8126)
- `iora-assist` - AI assistant (port 8092)
- `iora-supervisor` - Container management (port 8097)
- `iora-appstore` - App store (port 8098)
- etc.

### 3. Global Config Access

#### For Services (Rust)

Services automatically access Global Config via the settings cache:

```rust
use iora_shared::system_config::get_cached_setting;

// Get a setting from Global Config
let ha_url = get_cached_setting("ha.url")
    .unwrap_or_else(|| std::env::var("HA_URL").unwrap_or_default());
```

#### Environment Variables

All services automatically load:
1. `/etc/iora/service.env` - Global environment for all services
2. `/etc/iora/<service>.env` - Service-specific overrides (optional)

**Example `/etc/iora/service.env`:**
```bash
# IORA Home API (Global Config source)
IORA_HOME_URL=http://127.0.0.1:8126

# IORA Core (Service Registry)
IORA_CORE_URL=http://127.0.0.1:8090

# Environment
IORA_ENV=development
IORA_OS_DEV=1

# Logging
RUST_LOG=info
RUST_BACKTRACE=1
```

#### Command Line Helper

Use the `iora-get-config` helper to fetch settings:

```bash
# Get a config value
iora-get-config ha.url

# With default value
iora-get-config mqtt.broker tcp://localhost:1883

# Use in scripts
HA_URL=$(iora-get-config ha.url)
echo "Home Assistant URL: $HA_URL"
```

#### API Access

```bash
# GET a setting
curl http://localhost:8126/api/settings/ha.url

# PUT a setting
curl -X PUT http://localhost:8126/api/settings/ha.url \
  -H "Content-Type: application/json" \
  -d '{"value": "http://homeassistant.local:8123"}'

# List all settings
curl http://localhost:8126/api/settings
```

## Live Log Access

### Journalctl (Standard)

IORA Dev VM uses journald for all logs, exactly like IORA OS:

```bash
# Follow all IORA services
journalctl -u 'iora-*' -f

# Follow specific service
journalctl -u iora-home -f

# Last 100 lines
journalctl -u iora-home -n 100

# Since 5 minutes ago
journalctl -u iora-home --since "5 min ago"

# With timestamps
journalctl -u iora-home -f -o short-iso

# JSON output (for parsing)
journalctl -u iora-home -f -o json
```

### Helper Script

Use the `iora-dev-logs.sh` helper:

```bash
# Show last 100 lines from all IORA services
./iora-dev-logs.sh

# Follow all services
./iora-dev-logs.sh -f

# Show logs from specific service
./iora-dev-logs.sh iora-home

# Follow specific service
./iora-dev-logs.sh iora-home -f

# Last 5 minutes
./iora-dev-logs.sh --since "5m ago"
```

### Remote Access (From Host)

```powershell
# Windows (PowerShell)
ssh root@127.0.0.1 -p 2222 -i .cache/iora-dev-key 'journalctl -u iora-* -f'

# Follow specific service
ssh root@127.0.0.1 -p 2222 -i .cache/iora-dev-key 'journalctl -u iora-home -f'
```

```bash
# Linux/macOS
ssh -i .cache/iora-dev-key -p 2222 root@127.0.0.1 'journalctl -u iora-* -f'
```

### Log Streaming API

For programmatic access, use the log streaming helper:

```bash
# Stream logs as JSON (for tools/IDEs)
/usr/lib/iora/iora-logs-stream iora-home

# Stream all services
/usr/lib/iora/iora-logs-stream
```

## Building New Services

When you build a new service, it automatically gets Global Config access:

### 1. Build Process

```bash
# In Dev VM
cd /home/iora/iora/iora-os/backend
cargo build --release-fast -p iora-<your-service>
```

### 2. Install Binary

```bash
# Copy to /usr/bin (like IORA OS)
sudo cp target/release-fast/iora-<your-service> /usr/bin/
sudo chmod 755 /usr/bin/iora-<your-service>
```

### 3. Service Unit

The service unit is auto-generated by `iora-dev-services.sh`, but if you need a custom one:

```bash
# Create service unit
sudo tee /etc/systemd/system/iora-<your-service>.service <<EOF
[Unit]
Description=IORA <Your Service>
After=iora-core.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/iora/data/iora-<your-service>
ExecStart=/usr/bin/iora-<your-service>
Restart=always
RestartSec=2
Environment=PORT=<port>
EnvironmentFile=-/etc/iora/service.env
EnvironmentFile=-/etc/iora/iora-<your-service>.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Reload and start
sudo systemctl daemon-reload
sudo systemctl enable --now iora-<your-service>
```

### 4. Config Access

Your service automatically has access to:
- `IORA_HOME_URL` - For Global Config API
- `IORA_CORE_URL` - For service registry
- `DATABASE_URL` - If it needs database access

Use the Rust helper:

```rust
use iora_shared::system_config::get_cached_setting;

fn main() {
    // Will check Global Config first, then fall back to env var
    let my_setting = get_cached_setting("my.service.setting")
        .unwrap_or_default();

    println!("Setting value: {}", my_setting);
}
```

## Verification Checklist

Use this checklist to verify 100% compatibility:

### File System
- [ ] `/etc/iora/` exists and contains config files
- [ ] `/opt/iora/data/` exists for service data
- [ ] `/usr/bin/iora-*` binaries are executable
- [ ] `/usr/lib/iora/` contains helper scripts
- [ ] `/mnt/data/iora/` exists (data partition)

### Services
- [ ] `systemctl list-units 'iora-*'` shows all services
- [ ] `journalctl -u iora-home` shows logs
- [ ] Services restart properly after crash

### Global Config
- [ ] `curl http://localhost:8126/api/settings` returns settings
- [ ] `iora-get-config ha.url` works
- [ ] `/etc/iora/service.env` is loaded by services
- [ ] New services can access Global Config via IORA_HOME_URL

### Logging
- [ ] `journalctl -u iora-* -f` shows live logs
- [ ] `./iora-dev-logs.sh -f` works
- [ ] Logs from Dev VM match format from IORA OS

## Differences from IORA OS

While Dev VM is 100% compatible, there are a few implementation differences that don't affect functionality:

1. **Data Partition**: `/mnt/data` is tmpfs (RAM disk) in Dev VM, but real disk on IORA OS
   - **Impact**: Data doesn't persist across VM reboots
   - **Workaround**: Use `/opt/iora/data` for persistent storage

2. **LUKS Encryption**: Dev VM doesn't use encrypted partitions
   - **Impact**: None for development
   - **IORA OS**: Data partition is LUKS-encrypted

3. **RAUC Updates**: Dev VM doesn't have RAUC (atomic updates)
   - **Impact**: Update manually via git pull + rebuild
   - **IORA OS**: Uses RAUC for atomic OS updates

4. **Hardware Access**: Dev VM is virtualized
   - **Impact**: No direct hardware access (GPIO, USB, etc.)
   - **IORA OS**: Direct hardware access on bare metal

## Troubleshooting

### Service Can't Access Global Config

**Symptom:** Service logs show "Failed to fetch config" or uses default values

**Solution:**
```bash
# Verify iora-home is running
systemctl status iora-home

# Check Global Config API
curl http://localhost:8126/api/health

# Verify service has environment
systemctl show iora-<service> | grep Environment

# Re-sync config access
sudo ./iora-config-sync.sh
systemctl restart iora-<service>
```

### Logs Not Showing

**Symptom:** `journalctl -u iora-*` shows no output

**Solution:**
```bash
# Check if services are running
systemctl list-units 'iora-*'

# Check journald is running
systemctl status systemd-journald

# Manual restart
systemctl restart iora-home
journalctl -u iora-home -f
```

### Path Mismatch

**Symptom:** Service can't find files, "No such file or directory"

**Solution:**
```bash
# Verify directory structure
ls -la /etc/iora /opt/iora /usr/bin/iora-*

# Re-run compatibility layer
sudo ./iora-dev-compat.sh

# Check service working directory
systemctl cat iora-<service> | grep WorkingDirectory
```

## Example: Adding a New Service

Here's a complete example of adding a new service with Global Config access:

### 1. Create the Service (Rust)

```rust
// iora-os/backend/services/iora-example/src/main.rs
use iora_shared::system_config::get_cached_setting;

#[tokio::main]
async fn main() {
    println!("IORA Example Service starting...");

    // Get config from Global Config
    let my_setting = get_cached_setting("example.my_setting")
        .unwrap_or_else(|| "default_value".to_string());

    println!("Config value: {}", my_setting);

    // Service logic here...
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
    }
}
```

### 2. Build and Install

```bash
# In Dev VM
cd /home/iora/iora/iora-os/backend
cargo build --release-fast -p iora-example

# Install
sudo cp target/release-fast/iora-example /usr/bin/
sudo chmod 755 /usr/bin/iora-example
```

### 3. Create Service Unit

```bash
sudo ./iora-dev-services.sh  # This auto-generates units

# Or manually:
sudo tee /etc/systemd/system/iora-example.service <<EOF
[Unit]
Description=IORA Example Service
After=iora-core.service iora-home.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/iora/data/iora-example
ExecStart=/usr/bin/iora-example
Restart=always
RestartSec=2
EnvironmentFile=-/etc/iora/service.env
EnvironmentFile=-/etc/iora/iora-example.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 4. Start and Verify

```bash
# Create data directory
sudo mkdir -p /opt/iora/data/iora-example

# Start service
sudo systemctl daemon-reload
sudo systemctl enable --now iora-example

# Check status
systemctl status iora-example

# Follow logs
journalctl -u iora-example -f
```

### 5. Add Setting to Global Config

```bash
# Via API
curl -X PUT http://localhost:8126/api/settings/example.my_setting \
  -H "Content-Type: application/json" \
  -d '{"value": "production_value"}'

# Restart service to pick up new setting
systemctl restart iora-example
```

## Summary

IORA Dev VM provides:
✅ **100% Path Compatibility** - Same directories as IORA OS
✅ **100% Service Compatibility** - Same systemd units
✅ **100% Config Compatibility** - Global Config API access
✅ **100% Log Compatibility** - journald with live streaming
✅ **100% Runtime Compatibility** - Same environment variables

**Result**: Code that runs on Dev VM runs identically on IORA OS, and vice versa.
