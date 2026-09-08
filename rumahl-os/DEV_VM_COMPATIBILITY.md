# rumahl Dev VM - 100% rumahl OS Compatibility Guide

This document describes how rumahl Dev VM achieves 100% compatibility with rumahl OS, ensuring that programs and services run identically on both platforms.

## Overview

rumahl Dev VM is a development environment that perfectly mirrors rumahl OS in terms of:
- **File system structure** (paths, directories)
- **Service management** (systemd units, startup order)
- **Configuration access** (Global Config API)
- **Logging** (journald, live streaming)
- **Environment variables** (identical to rumahl OS)
- **Network configuration** (systemd-networkd)
- **Docker setup** (daemon.json, security settings)

## Compatibility Guarantees

### 1. Identical Path Structure

Both rumahl OS and Dev VM use the same paths:

```
/etc/ora/              # OS configuration
/opt/rumahl/data/         # Service data directories
/opt/rumahl/build/        # Built binaries and frontend
/usr/bin/rumahl-*         # System tools and CLI
/usr/lib/ora/          # Helper scripts and libraries
/mnt/data/ora/         # Data partition (tmpfs in Dev VM)
/var/lib/ora/          # Runtime state
/tmp/rumahl-sandboxes/    # Plugin sandboxes
```

**Verification:**
```bash
# Check all critical paths exist
ls -la /etc/ora /opt/rumahl /usr/lib/ora /mnt/data/ora
```

### 2. Service Management

All services are managed via systemd with identical unit files:

```bash
# List all rumahl services
systemctl list-units 'rumahl-*'

# Check service status
systemctl status rumahl-home

# Restart a service
systemctl restart rumahl-core
```

**Service naming:** `rumahl-<service>.service`
- `rumahl-core` - Service registry (port 8090)
- `rumahl-home` - Main API (port 8126)
- `rumahl-assist` - AI assistant (port 8092)
- `rumahl-supervisor` - Container management (port 8097)
- `rumahl-appstore` - App store (port 8098)
- etc.

### 3. Global Config Access

#### For Services (Rust)

Services automatically access Global Config via the settings cache:

```rust
use rumahl_shared::system_config::get_cached_setting;

// Get a setting from Global Config
let ha_url = get_cached_setting("ha.url")
    .unwrap_or_else(|| std::env::var("HA_URL").unwrap_or_default());
```

#### Environment Variables

All services automatically load:
1. `/etc/ora/service.env` - Global environment for all services
2. `/etc/ora/<service>.env` - Service-specific overrides (optional)

**Example `/etc/ora/service.env`:**
```bash
# rumahl Home API (Global Config source)
RUMAHL_HOME_URL=http://127.0.0.1:8126

# rumahl Core (Service Registry)
RUMAHL_CORE_URL=http://127.0.0.1:8090

# Environment
RUMAHL_ENV=development
RUMAHL_OS_DEV=1

# Logging
RUST_LOG=info
RUST_BACKTRACE=1
```

#### Command Line Helper

Use the `rumahl-get-config` helper to fetch settings:

```bash
# Get a config value
rumahl-get-config ha.url

# With default value
rumahl-get-config mqtt.broker tcp://localhost:1883

# Use in scripts
HA_URL=$(rumahl-get-config ha.url)
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

rumahl Dev VM uses journald for all logs, exactly like rumahl OS:

```bash
# Follow all rumahl services
journalctl -u 'rumahl-*' -f

# Follow specific service
journalctl -u rumahl-home -f

# Last 100 lines
journalctl -u rumahl-home -n 100

# Since 5 minutes ago
journalctl -u rumahl-home --since "5 min ago"

# With timestamps
journalctl -u rumahl-home -f -o short-iso

# JSON output (for parsing)
journalctl -u rumahl-home -f -o json
```

### Helper Script

Use the `rumahl-dev-logs.sh` helper:

```bash
# Show last 100 lines from all rumahl services
./rumahl-dev-logs.sh

# Follow all services
./rumahl-dev-logs.sh -f

# Show logs from specific service
./rumahl-dev-logs.sh rumahl-home

# Follow specific service
./rumahl-dev-logs.sh rumahl-home -f

# Last 5 minutes
./rumahl-dev-logs.sh --since "5m ago"
```

### Remote Access (From Host)

```powershell
# Windows (PowerShell)
ssh root@127.0.0.1 -p 2222 -i .cache/rumahl-dev-key 'journalctl -u rumahl-* -f'

# Follow specific service
ssh root@127.0.0.1 -p 2222 -i .cache/rumahl-dev-key 'journalctl -u rumahl-home -f'
```

```bash
# Linux/macOS
ssh -i .cache/rumahl-dev-key -p 2222 root@127.0.0.1 'journalctl -u rumahl-* -f'
```

### Log Streaming API

For programmatic access, use the log streaming helper:

```bash
# Stream logs as JSON (for tools/IDEs)
/usr/lib/ora/rumahl-logs-stream rumahl-home

# Stream all services
/usr/lib/ora/rumahl-logs-stream
```

## Building New Services

When you build a new service, it automatically gets Global Config access:

### 1. Build Process

```bash
# In Dev VM
cd /home/ora/ora/rumahl-os/backend
cargo build --release-fast -p rumahl-<your-service>
```

### 2. Install Binary

```bash
# Copy to /usr/bin (like rumahl OS)
sudo cp target/release-fast/rumahl-<your-service> /usr/bin/
sudo chmod 755 /usr/bin/rumahl-<your-service>
```

### 3. Service Unit

The service unit is auto-generated by `rumahl-dev-services.sh`, but if you need a custom one:

```bash
# Create service unit
sudo tee /etc/systemd/system/rumahl-<your-service>.service <<EOF
[Unit]
Description=rumahl <Your Service>
After=rumahl-core.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rumahl/data/rumahl-<your-service>
ExecStart=/usr/bin/rumahl-<your-service>
Restart=always
RestartSec=2
Environment=PORT=<port>
EnvironmentFile=-/etc/ora/service.env
EnvironmentFile=-/etc/ora/rumahl-<your-service>.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Reload and start
sudo systemctl daemon-reload
sudo systemctl enable --now rumahl-<your-service>
```

### 4. Config Access

Your service automatically has access to:
- `RUMAHL_HOME_URL` - For Global Config API
- `RUMAHL_CORE_URL` - For service registry
- `DATABASE_URL` - If it needs database access

Use the Rust helper:

```rust
use rumahl_shared::system_config::get_cached_setting;

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
- [ ] `/etc/ora/` exists and contains config files
- [ ] `/opt/rumahl/data/` exists for service data
- [ ] `/usr/bin/rumahl-*` binaries are executable
- [ ] `/usr/lib/ora/` contains helper scripts
- [ ] `/mnt/data/ora/` exists (data partition)

### Services
- [ ] `systemctl list-units 'rumahl-*'` shows all services
- [ ] `journalctl -u rumahl-home` shows logs
- [ ] Services restart properly after crash

### Global Config
- [ ] `curl http://localhost:8126/api/settings` returns settings
- [ ] `rumahl-get-config ha.url` works
- [ ] `/etc/ora/service.env` is loaded by services
- [ ] New services can access Global Config via RUMAHL_HOME_URL

### Logging
- [ ] `journalctl -u rumahl-* -f` shows live logs
- [ ] `./rumahl-dev-logs.sh -f` works
- [ ] Logs from Dev VM match format from rumahl OS

## Differences from rumahl OS

While Dev VM is 100% compatible, there are a few implementation differences that don't affect functionality:

1. **Data Partition**: `/mnt/data` is tmpfs (RAM disk) in Dev VM, but real disk on rumahl OS
   - **Impact**: Data doesn't persist across VM reboots
   - **Workaround**: Use `/opt/rumahl/data` for persistent storage

2. **LUKS Encryption**: Dev VM doesn't use encrypted partitions
   - **Impact**: None for development
   - **rumahl OS**: Data partition is LUKS-encrypted

3. **RAUC Updates**: Dev VM doesn't have RAUC (atomic updates)
   - **Impact**: Update manually via git pull + rebuild
   - **rumahl OS**: Uses RAUC for atomic OS updates

4. **Hardware Access**: Dev VM is virtualized
   - **Impact**: No direct hardware access (GPIO, USB, etc.)
   - **rumahl OS**: Direct hardware access on bare metal

## Troubleshooting

### Service Can't Access Global Config

**Symptom:** Service logs show "Failed to fetch config" or uses default values

**Solution:**
```bash
# Verify rumahl-home is running
systemctl status rumahl-home

# Check Global Config API
curl http://localhost:8126/api/health

# Verify service has environment
systemctl show rumahl-<service> | grep Environment

# Re-sync config access
sudo ./rumahl-config-sync.sh
systemctl restart rumahl-<service>
```

### Logs Not Showing

**Symptom:** `journalctl -u rumahl-*` shows no output

**Solution:**
```bash
# Check if services are running
systemctl list-units 'rumahl-*'

# Check journald is running
systemctl status systemd-journald

# Manual restart
systemctl restart rumahl-home
journalctl -u rumahl-home -f
```

### Path Mismatch

**Symptom:** Service can't find files, "No such file or directory"

**Solution:**
```bash
# Verify directory structure
ls -la /etc/ora /opt/rumahl /usr/bin/rumahl-*

# Re-run compatibility layer
sudo ./rumahl-dev-compat.sh

# Check service working directory
systemctl cat rumahl-<service> | grep WorkingDirectory
```

## Example: Adding a New Service

Here's a complete example of adding a new service with Global Config access:

### 1. Create the Service (Rust)

```rust
// rumahl-os/backend/services/rumahl-example/src/main.rs
use rumahl_shared::system_config::get_cached_setting;

#[tokio::main]
async fn main() {
    println!("rumahl Example Service starting...");

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
cd /home/ora/ora/rumahl-os/backend
cargo build --release-fast -p rumahl-example

# Install
sudo cp target/release-fast/rumahl-example /usr/bin/
sudo chmod 755 /usr/bin/rumahl-example
```

### 3. Create Service Unit

```bash
sudo ./rumahl-dev-services.sh  # This auto-generates units

# Or manually:
sudo tee /etc/systemd/system/rumahl-example.service <<EOF
[Unit]
Description=rumahl Example Service
After=rumahl-core.service rumahl-home.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rumahl/data/rumahl-example
ExecStart=/usr/bin/rumahl-example
Restart=always
RestartSec=2
EnvironmentFile=-/etc/ora/service.env
EnvironmentFile=-/etc/ora/rumahl-example.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 4. Start and Verify

```bash
# Create data directory
sudo mkdir -p /opt/rumahl/data/rumahl-example

# Start service
sudo systemctl daemon-reload
sudo systemctl enable --now rumahl-example

# Check status
systemctl status rumahl-example

# Follow logs
journalctl -u rumahl-example -f
```

### 5. Add Setting to Global Config

```bash
# Via API
curl -X PUT http://localhost:8126/api/settings/example.my_setting \
  -H "Content-Type: application/json" \
  -d '{"value": "production_value"}'

# Restart service to pick up new setting
systemctl restart rumahl-example
```

## Summary

rumahl Dev VM provides:
✅ **100% Path Compatibility** - Same directories as rumahl OS
✅ **100% Service Compatibility** - Same systemd units
✅ **100% Config Compatibility** - Global Config API access
✅ **100% Log Compatibility** - journald with live streaming
✅ **100% Runtime Compatibility** - Same environment variables

**Result**: Code that runs on Dev VM runs identically on rumahl OS, and vice versa.
