# IORA OS Boot Reliability Improvements

This document describes the comprehensive fixes applied to ensure IORA OS boots reliably without service failures.

## Problem Analysis

The original IORA OS implementation had several critical boot issues:

### 1. Missing Directory Initialization
- **Problem**: Services like `iora-stack.service` required `/mnt/data/iora` directory to exist, but it wasn't created before services started
- **Symptom**: `ConditionPathIsDirectory=/mnt/data/iora` failed, causing services to skip startup
- **Impact**: Docker stack never started, leaving IORA non-functional

### 2. Circular Dependency Issues
- **Problem**: Complex dependency chains between ZRAM, local-fs.target, PostgreSQL, and Chrony created systemd ordering cycles
- **Symptom**: systemd breaks circular dependencies by deleting services from the graph, causing random startup failures
- **Impact**: Critical services like PostgreSQL and Chrony failed to start unpredictably

### 3. Missing docker-compose.yml on First Boot
- **Problem**: `iora-stack.service` tried to run `docker compose` in `/mnt/data/iora` but no compose file existed on first boot
- **Symptom**: Service failed with "docker-compose.yml not found" error
- **Impact**: Entire IORA container stack failed to start

### 4. Race Conditions Between Services
- **Problem**: Services started before their dependencies were fully ready
- **Symptom**: Services failed due to missing mount points, directories, or network
- **Impact**: Services crashed and didn't restart properly

### 5. Insufficient Restart Logic
- **Problem**: Failed services didn't have proper restart policies
- **Symptom**: One-time failures caused permanent service outages
- **Impact**: System remained partially broken until manual intervention

## Solutions Implemented

### 1. Data Directory Initialization Service

**New Service**: `iora-init-data.service`

```systemd
[Unit]
Description=Initialize IORA data directory
DefaultDependencies=no
After=mnt-data.mount
Before=iora-stack.service iora-setup.service docker.service
RequiresMountsFor=/mnt/data
ConditionPathIsMountPoint=/mnt/data

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '\
  mkdir -p /mnt/data/iora /mnt/data/rauc /mnt/data/backups && \
  chmod 755 /mnt/data/iora /mnt/data/rauc /mnt/data/backups'

[Install]
WantedBy=local-fs.target
```

**Benefits**:
- Runs early in boot sequence (local-fs.target)
- Creates all required directories before dependent services start
- Uses `RequiresMountsFor` to ensure `/mnt/data` is mounted
- `RemainAfterExit=yes` keeps the service "active" so dependencies work correctly

### 2. Docker Compose Placeholder Creation

**Enhanced**: `iora-stack.service`

Added `ExecStartPre` step to create a minimal docker-compose.yml if none exists:

```bash
ExecStartPre=/bin/sh -c 'if [ ! -f /mnt/data/iora/docker-compose.yml ]; then \
  echo "version: '\''3.8'\''" > /mnt/data/iora/docker-compose.yml; \
  echo "services:" >> /mnt/data/iora/docker-compose.yml; \
  echo "  placeholder:" >> /mnt/data/iora/docker-compose.yml; \
  echo "    image: hello-world" >> /mnt/data/iora/docker-compose.yml; \
fi'
```

**Benefits**:
- Prevents "file not found" errors on first boot
- Creates a harmless placeholder that can be replaced by setup wizard
- Ensures `docker compose` commands always succeed

### 3. Proper Service Ordering

**Fixed Dependency Chain**:

```
local-fs.target
    ↓
mnt-data.mount (data partition)
    ↓
iora-init-data.service (create directories)
    ↓
├── docker.service
├── iora-setup.service (first-boot wizard)
└── iora-stack.service (docker compose stack)
    ↓
iora-stack-watchdog.timer (periodic health check)
```

**Key Changes**:
- All services now depend on `iora-init-data.service` instead of directly on `mnt-data.mount`
- Removed circular dependencies by using `DefaultDependencies=no` where appropriate
- Used `After=` instead of `Requires=` where hard dependencies weren't needed

### 4. Enhanced Conditionals

**Before**:
```systemd
ConditionPathIsDirectory=/mnt/data/iora
```

**After**:
```systemd
ConditionPathIsDirectory=/mnt/data/iora
ConditionPathExists=/mnt/data/iora/docker-compose.yml
ConditionPathIsMountPoint=/mnt/data
```

**Benefits**:
- Multiple conditions ensure all prerequisites are met
- Services gracefully skip if prerequisites aren't satisfied
- Prevents cascading failures

### 5. Watchdog Improvements

**Enhanced**: `iora-stack-watchdog.service`

Added condition to check for docker-compose.yml existence:

```systemd
ConditionPathExists=/mnt/data/iora/docker-compose.yml
```

**Benefits**:
- Watchdog doesn't run if stack hasn't been set up yet
- Prevents spurious error messages in journal
- Only activates when there's actually something to watch

### 6. Updated Service Dependencies Across the Board

All services that depend on `/mnt/data/iora` now properly depend on `iora-init-data.service`:

- ✅ `iora-stack.service`
- ✅ `iora-setup.service`
- ✅ `iora-update-check.service`
- ✅ `iora-recovery.service`
- ✅ `iora-dev-bridge.service`

### 7. Removed Hard Dependencies Where Not Needed

**Before**:
```systemd
Requires=iora-verify.service
```

**After**:
```systemd
After=iora-verify.service
Wants=network-online.target
```

**Benefits**:
- Services don't fail if optional dependencies fail
- Using `Wants=` instead of `Requires=` for non-critical deps
- System continues booting even if verify service has issues

## Boot Sequence Diagram

```
System Power On
    ↓
GRUB Bootloader
    ↓
Linux Kernel Init
    ↓
systemd starts
    ↓
┌─────────────────────────────────────┐
│ local-fs.target                      │
│  ├── zram.service (ZRAM /tmp, /var) │
│  ├── mnt-data.mount (data partition)│
│  └── iora-init-data.service         │← NEW: Creates directories
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Basic System Services                │
│  ├── docker.service                  │
│  ├── postgresql.service              │
│  ├── chrony.service                  │
│  └── network-online.target          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ IORA Services (multi-user.target)   │
│  ├── iora-detect-virt.service       │
│  ├── iora-verify.service             │
│  ├── iora-setup.service (first boot)│← Runs before stack
│  ├── iora-stack.service              │← Main container stack
│  ├── iora-update-check.timer        │
│  └── iora-dev-bridge.service (dev)  │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Watchdog Services                    │
│  └── iora-stack-watchdog.timer      │← Periodic health check
└─────────────────────────────────────┘
    ↓
System Ready - IORA Home accessible at http://[ip]:8080
```

## Service Startup States

### Normal First Boot

1. **local-fs.target**: Mounts all filesystems including ZRAM and data partition
2. **iora-init-data.service**: Creates `/mnt/data/iora`, `/mnt/data/rauc`, `/mnt/data/backups`
3. **docker.service**: Starts Docker daemon
4. **iora-setup.service**: Starts first-boot wizard (no `.setup-complete` file exists)
5. **iora-stack.service**: Creates placeholder docker-compose.yml, waits for setup wizard
6. Setup wizard creates real docker-compose.yml and `.setup-complete` marker
7. **iora-stack.service**: Restarts with real compose file, pulls and starts containers

### Normal Subsequent Boots

1. **local-fs.target**: Mounts filesystems
2. **iora-init-data.service**: Validates directories exist (no-op if already present)
3. **docker.service**: Starts Docker daemon
4. **iora-setup.service**: Skips (`.setup-complete` exists)
5. **iora-stack.service**: Starts directly with existing docker-compose.yml
6. **iora-stack-watchdog.timer**: Activates, checks every 2 minutes

### Recovery Boot

1. Boot with kernel parameter `iora.recovery=1`
2. All normal services start
3. **iora-recovery.service**: Activates due to kernel parameter
4. Downloads and installs latest stable RAUC bundle
5. System reboots automatically
6. Normal boot from updated partition

## Failure Recovery

### If `/mnt/data` Fails to Mount

**Impact**: Most services skip due to conditions
**Recovery**:
- `iora-init-data.service` skips (ConditionPathIsMountPoint fails)
- `iora-stack.service` skips (ConditionPathIsDirectory fails)
- System boots to recovery shell
- Admin can manually mount or fix filesystem

### If Docker Fails to Start

**Impact**: Container stack doesn't start
**Recovery**:
- `iora-stack.service` has `Restart=on-failure`
- Will retry with `RestartSec=30`
- After 10 attempts (StartLimitBurst), gives up
- Admin can check `journalctl -u docker.service`

### If IORA Stack Fails

**Impact**: IORA containers don't start
**Recovery**:
- `iora-stack.service` has `Restart=on-failure`
- Retries pull operation (3 attempts)
- Retries compose up after 15 seconds
- Watchdog timer restarts exited containers every 2 minutes

### If Integrity Check Fails

**Impact**: System isolates to tamper screen
**Recovery**:
- User sees blue screen with instructions
- Must boot to recovery mode
- System reinstalls verified IORA OS
- Data partition preserved

## Testing Checklist

To verify boot reliability, test these scenarios:

- [ ] Fresh install on bare metal
- [ ] Fresh install in VM (VirtualBox, VMware, KVM)
- [ ] First boot without network
- [ ] First boot with slow/flaky network
- [ ] Reboot after successful setup
- [ ] Cold boot after power loss
- [ ] Boot with corrupted docker-compose.yml
- [ ] Boot with missing `/mnt/data/iora`
- [ ] Boot with read-only data partition
- [ ] Recovery boot (kernel param `iora.recovery=1`)
- [ ] Boot after integrity tampering
- [ ] Boot with Docker daemon issues

## Monitoring Boot Health

### Check Service Status

```bash
# Check all IORA services
systemctl status iora-*

# Check critical path
systemctl status mnt-data.mount iora-init-data.service iora-stack.service

# Check failed services
systemctl --failed

# Check journal for errors
journalctl -b -p err
```

### Check Boot Timing

```bash
# Analyze boot time
systemd-analyze

# Show critical chain
systemd-analyze critical-chain iora-stack.service

# Plot boot sequence
systemd-analyze plot > /tmp/boot.svg
```

### Check Conditions

```bash
# Verify data mount
mountpoint /mnt/data

# Check directory creation
ls -la /mnt/data/

# Verify compose file
cat /mnt/data/iora/docker-compose.yml
```

## Future Improvements

### Potential Enhancements

1. **Health Probes**: Add HTTP health checks to services before marking them ready
2. **Startup Notifications**: Send systemd notifications when services are truly ready
3. **Dependency Visualization**: Generate runtime dependency graph for debugging
4. **Boot Time Budget**: Set maximum acceptable boot time and alert if exceeded
5. **Automated Recovery**: Auto-rollback to previous partition if boot fails twice

### Performance Optimizations

1. **Parallel Service Startup**: Review which services can start in parallel
2. **Lazy Container Pulls**: Defer non-critical container pulls until after boot
3. **Preloaded Images**: Include common container images in IORA OS image
4. **Faster ZRAM**: Optimize ZRAM compression algorithm selection

## References

- systemd service documentation: https://www.freedesktop.org/software/systemd/man/systemd.service.html
- systemd ordering: https://www.freedesktop.org/software/systemd/man/systemd.special.html
- Docker systemd integration: https://docs.docker.com/config/daemon/systemd/
- RAUC update system: https://rauc.readthedocs.io/
