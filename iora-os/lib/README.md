# IORA Dev Libraries

Shared libraries for IORA development automation scripts.

## Files

### `dev-auto-repair.sh`

Bash library providing intelligent auto-detection and auto-repair functions for IORA dev VMs.

**Key Functions:**

- `detect_port_conflict(port)` — Check if port is in use and identify process
- `auto_resolve_port_conflict(port, service)` — Automatically free port or reuse existing IORA VM
- `detect_low_disk_space(path, min_gb)` — Check if disk space is low
- `auto_clean_disk_space(cache_dir)` — Remove old logs, backups, ISOs
- `detect_missing_deps()` — Find missing required commands
- `auto_install_deps(deps...)` — Auto-install via brew/apt
- `check_vm_health(host, port, key)` — Test VM SSH connectivity and systemd health
- `auto_recover_vm(host, port, key)` — Restart failed services, vacuum journal
- `detect_memory_pressure(threshold)` — Check if system is under memory pressure
- `auto_optimize_vm_resources(...)` — Suggest VM resource adjustments based on load
- `start_health_monitor(host, port, key, log, pid)` — Start background health monitoring
- `stop_health_monitor(pid_file)` — Stop background monitor
- `send_notification(title, message, urgency)` — Send desktop notification

**Usage:**

```bash
# In dev-local.sh
source "$SCRIPT_DIR/lib/dev-auto-repair.sh"

# Use functions
if ! detect_low_disk_space "$CACHE" 5; then
    auto_clean_disk_space "$CACHE"
fi
```

### `DevAutoRepair.psm1`

PowerShell module providing equivalent functionality for Windows.

**Key Functions:**

- `Test-PortConflict` — Check port usage
- `Resolve-PortConflict` — Auto-resolve port conflicts
- `Test-DiskSpace` — Check disk space
- `Invoke-DiskCleanup` — Clean cache directory
- `Test-Dependencies` — Find missing dependencies
- `Install-MissingDependencies` — Auto-install via winget/choco
- `Test-VMHealth` — Check VM SSH connectivity
- `Invoke-VMRecovery` — Auto-recover failed services
- `Test-MemoryPressure` — Check Windows memory usage
- `Optimize-VMResources` — Suggest VM resource adjustments
- `Start-HealthMonitor` — Start background job
- `Stop-HealthMonitor` — Stop background job
- `Send-Notification` — Send Windows toast notification

**Usage:**

```powershell
# In dev-local.ps1
Import-Module "$SCRIPT_DIR\lib\DevAutoRepair.psm1"

# Use functions
if (-not (Test-DiskSpace -Path $CACHE -MinimumGB 5)) {
    Invoke-DiskCleanup -CacheDir $CACHE
}
```

## Design Principles

### Non-Intrusive

- Uses dim/gray console colors for background operations
- Desktop notifications only for important events
- Background monitoring runs independently
- Logs everything for transparency

### Fail-Safe

- All functions have graceful fallback behavior
- Non-fatal failures logged, not thrown
- No-op fallbacks if library not found
- Manual instructions provided when auto-repair fails

### Cross-Platform

- Bash version for macOS/Linux/WSL2
- PowerShell version for Windows
- Identical function signatures where possible
- Platform-specific optimizations where needed

### Autonomous

- Detects issues automatically
- Resolves common problems without user input
- Runs background monitoring independently
- Only asks for help when necessary

## Adding New Features

1. **Add function to library:**
   ```bash
   # In dev-auto-repair.sh
   auto_fix_new_issue() {
       local param="$1"
       # Detection logic
       # Auto-repair logic
       # Return 0 on success, 1 on failure
   }
   export -f auto_fix_new_issue
   ```

2. **Add PowerShell equivalent:**
   ```powershell
   # In DevAutoRepair.psm1
   function Invoke-NewIssueFix {
       param([string]$Param)
       # Detection logic
       # Auto-repair logic
       return $success
   }
   Export-ModuleMember -Function 'Invoke-NewIssueFix'
   ```

3. **Integrate into dev scripts:**
   ```bash
   # In dev-local.sh
   if command -v auto_fix_new_issue >/dev/null 2>&1; then
       auto_fix_new_issue "$param" || warn "Could not auto-fix"
   fi
   ```

4. **Add no-op fallback:**
   ```bash
   # In dev-local.sh (if library not found)
   auto_fix_new_issue() { :; }
   ```

5. **Document in [dev-automation-features.md](../docs/dev-automation-features.md)**

## Testing

### Bash Library

```bash
# Source the library
source iora-os/lib/dev-auto-repair.sh

# Test individual functions
detect_port_conflict 2222
detect_low_disk_space /tmp 5
detect_missing_deps
```

### PowerShell Module

```powershell
# Import the module
Import-Module .\iora-os\lib\DevAutoRepair.psm1

# Test individual functions
Test-PortConflict -Port 2222
Test-DiskSpace -Path $env:TEMP -MinimumGB 5
Test-Dependencies
```

## Debugging

### Enable verbose logging:

```bash
# Bash
set -x
source lib/dev-auto-repair.sh
auto_resolve_port_conflict 2222 "Test"
set +x
```

```powershell
# PowerShell
$VerbosePreference = 'Continue'
Import-Module .\lib\DevAutoRepair.psm1
Resolve-PortConflict -Port 2222 -ServiceName "Test"
$VerbosePreference = 'SilentlyContinue'
```

### View function definitions:

```bash
# Bash
type auto_resolve_port_conflict
```

```powershell
# PowerShell
Get-Command Resolve-PortConflict | Format-List *
```

## License

MIT License — Part of IORA smart home system
