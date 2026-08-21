# rumahl Dev Automation — Co-Buddy Features

> Intelligent automation that acts as your development co-buddy, handling common issues autonomously without interrupting your workflow.

## Overview

The rumahl dev-local scripts now include intelligent auto-detection and auto-repair capabilities that:

- **Detect and resolve common issues automatically** — port conflicts, low disk space, missing dependencies
- **Run background health monitoring** — continuously monitor VM health and auto-recover from failures
- **Provide non-intrusive notifications** — desktop alerts when ready, dim console messages for background tasks
- **Optimize resources dynamically** — adjust VM resources based on host system load

## Features

### 1. Intelligent Auto-Detection

#### Port Conflict Resolution

**Automatic detection and resolution of port conflicts:**

```bash
# Before: Manual intervention required
$ ./dev-local.sh
[X] Port 2222 is in use by another process

# After: Automatic resolution
$ ./dev-local.sh
Port 2222 appears to be in use - checking...
Detected existing rumahl VM on port 2222 - will reuse it
[+] Reusing existing rumahl VM
```

**Features:**
- Detects if port is in use by rumahl VM (reuses it) or another process (offers to kill it)
- Falls back to manual instructions if auto-resolution fails
- Non-intrusive dim console messages for background operations

#### Disk Space Management

**Automatic cleanup when running low on disk space:**

```bash
# Automatic detection and cleanup
Attempting automatic cache cleanup...
[+] Cache cleanup complete
```

**What gets cleaned:**
- Old log files (>7 days)
- Backup VM disks (>3 days)
- Old cloud-init ISOs (>7 days)

**Thresholds:**
- Warning: <5GB available
- Auto-cleanup: Triggered on warning

#### Missing Dependencies

**Auto-install missing dependencies (best-effort):**

```bash
# macOS with Homebrew
Auto-installing missing dependencies: qemu rsync
[+] All dependencies available

# Debian/Ubuntu
Auto-installing missing dependencies: qemu-system-x86
[sudo] password for user:
[+] All dependencies available
```

**Supported package managers:**
- macOS: Homebrew
- Linux: apt-get (Debian/Ubuntu)
- Fallback: Manual instructions

### 2. Background Health Monitor

**Non-intrusive background monitoring of VM health:**

```bash
Health monitor started (PID: 12345, logs: health-monitor.log)
```

**Features:**
- Runs independently in the background (survives script exit)
- Checks VM health every 60 seconds
- Auto-recovers from common failures:
  - Restarts failed systemd services
  - Cleans up large journal logs (>500MB)
  - Logs all actions to `health-monitor.log`

**Monitoring scope:**
- SSH connectivity
- systemd health
- Service status (rumahl-* services)
- Journal size

**Logs location:**
```
rumahl-os/.cache/health-monitor.log
```

**Manual control:**
```bash
# View health monitor logs
tail -f rumahl-os/.cache/health-monitor.log

# Stop health monitor
kill $(cat rumahl-os/.cache/health-monitor.pid)
```

### 3. Smart Recovery

**Automatic recovery from service failures:**

When the health monitor detects issues, it automatically:

1. **Identifies failed services:**
   ```bash
   systemctl list-units --state=failed 'rumahl-*'
   ```

2. **Restarts them:**
   ```bash
   systemctl restart <service>
   ```

3. **Cleans up if needed:**
   - Vacuums journal if >500MB
   - Frees resources

4. **Logs all actions** for post-mortem analysis

**No manual intervention required!**

### 4. Desktop Notifications

**Non-intrusive desktop notifications for important events:**

- **VM Ready:** When the rumahl Dev VM is fully started and healthy
- **Service Recovery:** When health monitor fixes a failed service
- **Errors:** When auto-recovery fails and manual intervention is needed

**Platforms:**
- macOS: Native notification center
- Linux: notify-send (if available)
- Fallback: Terminal bell

**Examples:**
```
Title: rumahl Dev VM Ready
Message: Dashboard available at http://localhost:8126
```

### 5. Resource Optimization

**Dynamic resource adjustment based on system load:**

```bash
# Detects high memory usage
High memory usage: 92%
Memory pressure detected - suggesting reduced VM RAM: 3072MB

# Detects high CPU load
High CPU load detected - suggesting reduced VM CPUs: 2
```

**Optimization strategies:**
- Reduce VM RAM by 25% when host memory usage >85%
- Reduce VM CPUs by 50% when host CPU load >200% (per core)
- Never go below minimum viable resources (2 CPUs, 4GB RAM)

**Manual override:**
```bash
export RUMAHL_DEV_RAM=4G
export RUMAHL_DEV_CPUS=4
./dev-local.sh
```

## Usage

### Basic Usage

No changes required! The co-buddy features are enabled automatically:

```bash
# Standard startup
./dev-local.sh

# Everything works as before, but now with:
# - Auto-detection of issues
# - Auto-repair of common problems
# - Background health monitoring
# - Desktop notifications
```

### Disable Specific Features

If you want to disable certain co-buddy features:

```bash
# Disable auto-repair library (fallback to manual mode)
mv rumahl-os/lib/dev-auto-repair.sh rumahl-os/lib/dev-auto-repair.sh.disabled

# Disable background health monitor
export RUMAHL_NO_HEALTH_MONITOR=1
./dev-local.sh
```

### View Co-Buddy Activity

```bash
# Main setup log (includes auto-repair actions)
tail -f rumahl-os/.cache/dev-local.log

# Health monitor log (background monitoring)
tail -f rumahl-os/.cache/health-monitor.log

# QEMU logs (if VM crashes)
tail -f rumahl-os/.cache/qemu-stderr.log
```

## Architecture

### Component Overview

```
dev-local.sh (Main Script)
    ↓
lib/dev-auto-repair.sh (Auto-Repair Library)
    ├── Auto-Detection Functions
    │   ├── detect_port_conflict()
    │   ├── detect_low_disk_space()
    │   ├── detect_missing_deps()
    │   └── detect_memory_pressure()
    │
    ├── Auto-Repair Functions
    │   ├── auto_resolve_port_conflict()
    │   ├── auto_clean_disk_space()
    │   ├── auto_install_deps()
    │   └── auto_recover_vm()
    │
    └── Background Services
        ├── start_health_monitor() → Background Process
        └── send_notification()
```

### Integration Points

1. **Early Stage (Dependencies):**
   ```bash
   # Line 332-339 in dev-local.sh
   detect_missing_deps && auto_install_deps
   ```

2. **Pre-QEMU Start (Port & Disk):**
   ```bash
   # Line 522-551 in dev-local.sh
   detect_low_disk_space && auto_clean_disk_space
   auto_resolve_port_conflict
   ```

3. **Post-Provision (Health Monitor):**
   ```bash
   # Line 928-934 in dev-local.sh
   start_health_monitor
   ```

4. **Completion (Notification):**
   ```bash
   # Line 971-974 in dev-local.sh
   send_notification "rumahl Dev VM Ready"
   ```

## Benefits

### For Developers

✅ **No more manual troubleshooting of common issues**
- Port conflicts? Auto-resolved
- Low disk space? Auto-cleaned
- Missing dependencies? Auto-installed

✅ **Uninterrupted workflow**
- Background monitoring doesn't require terminal focus
- Dim console messages for non-critical info
- Desktop notifications for important events only

✅ **Peace of mind**
- Health monitor catches and fixes issues while you code
- Logs available for post-mortem if needed
- VM stays healthy automatically

### For CI/CD

✅ **More reliable automation**
- Auto-recovery from transient failures
- Intelligent resource adjustment
- Better handling of edge cases

✅ **Reduced maintenance**
- Less manual intervention needed
- Self-healing infrastructure
- Better logging for debugging

## Troubleshooting

### Health Monitor Not Starting

**Issue:** Health monitor doesn't start or exits immediately

**Check:**
```bash
# Verify the library is loaded
grep "Auto-repair enabled" rumahl-os/.cache/dev-local.log

# Check if health monitor process exists
ps aux | grep health-monitor

# View health monitor logs
cat rumahl-os/.cache/health-monitor.log
```

**Fix:**
```bash
# Ensure library exists
ls -la rumahl-os/lib/dev-auto-repair.sh

# Manually start health monitor
source rumahl-os/lib/dev-auto-repair.sh
start_health_monitor "127.0.0.1" 2222 "rumahl-os/.cache/rumahl-dev-key" \
    "rumahl-os/.cache/health-monitor.log" "rumahl-os/.cache/health-monitor.pid"
```

### Auto-Repair Not Working

**Issue:** Auto-repair features don't activate

**Check:**
```bash
# Verify library functions are available
type auto_resolve_port_conflict
type detect_low_disk_space
type auto_install_deps
```

**Fix:**
```bash
# Re-source the library
source rumahl-os/lib/dev-auto-repair.sh

# Or restart the script
./dev-local.sh
```

### Notifications Not Appearing

**Issue:** Desktop notifications don't show up

**Platform-specific checks:**

**macOS:**
```bash
# Check if notifications are enabled for Terminal
# System Preferences → Notifications → Terminal
```

**Linux:**
```bash
# Install notify-send if missing
sudo apt-get install libnotify-bin  # Debian/Ubuntu
sudo dnf install libnotify           # Fedora

# Test notification
notify-send "Test" "This is a test"
```

## Best Practices

### Do's ✅

- **Let the co-buddy handle common issues** — trust the auto-repair functions
- **Check logs if curious** — all actions are logged for transparency
- **Use desktop notifications as hints** — they tell you when things are ready
- **Report false positives** — if auto-repair causes issues, file a bug report

### Don'ts ❌

- **Don't manually kill the health monitor** unless necessary — it's your safety net
- **Don't disable auto-repair unless debugging** — it makes your life easier
- **Don't ignore persistent warnings** — if auto-repair can't fix it, investigate
- **Don't modify health-monitor.log** — it's append-only for audit trail

## Advanced Configuration

### Custom Health Check Interval

```bash
# Edit lib/dev-auto-repair.sh
# Line ~270: Change sleep duration
sleep 60  # Default: check every 60 seconds
```

### Custom Disk Space Threshold

```bash
# Edit dev-local.sh
# Line 522-527: Change minimum GB
detect_low_disk_space "$CACHE" 10  # Require 10GB instead of 5GB
```

### Custom Memory Pressure Threshold

```bash
# Edit lib/dev-auto-repair.sh
# In start_health_monitor or detect_memory_pressure
detect_memory_pressure 95  # Trigger at 95% instead of 90%
```

## Related Documentation

- [dev-local.sh Usage Guide](../dev-local.sh) — Main development VM script
- [Frontend Hot Reload](./frontend-hot-reload.md) — Frontend development workflow
- [Backend Hot Reload](./dev-bridge-hot-reload.md) — Backend hot reload system
- [Development Setup](./development-setup.md) — Complete dev environment guide

## Contributing

When adding new co-buddy features:

1. **Add detection function** in `lib/dev-auto-repair.sh`
2. **Add auto-repair function** in same file
3. **Export function** at end of library
4. **Integrate into dev-local.sh** at appropriate point
5. **Add no-op fallback** in dev-local.sh (if library missing)
6. **Document in this file** with examples
7. **Test on macOS and Linux** for cross-platform compatibility

## Version History

- **v2.2** — Co-buddy features (auto-repair, health monitor, notifications)
- **v2.1** — Frontend hot reload integration
- **v2.0** — Vite migration, separate dev server
- **v1.x** — Embedded frontend build

---

**Philosophy:** *"A good co-buddy anticipates problems, fixes them silently, and only bothers you when necessary."*
