# ============================================================================
# dev-local.ps1 - IORA OS Local Dev VM (Windows)
# ============================================================================
# Starts a Debian 12 cloud VM via QEMU. The VM mirrors the IORA OS runtime
# layout (same /etc/iora, /opt/iora, /usr/bin/iora-*, same systemd services).
#
# Goals: maximum autonomy + idempotency + parity with dev-local.sh.
#
# Requirements:
#   - QEMU            winget install SoftwareFreedomConservancy.QEMU
#                     (or: choco install qemu / scoop install qemu / manual)
#   - WSL2            wsl --install              (for ISO + tar)
#   - OpenSSH Client  built into Windows 10/11
#
# Usage:
#   .\dev-local.ps1                Start (provisions if needed)
#   .\dev-local.ps1 -Clean         Drop cached VM disk + seed ISO (keep image)
#   .\dev-local.ps1 -CleanAll      Also remove downloaded cloud image
#   .\dev-local.ps1 -Status        Show whether VM is running + health check
#   .\dev-local.ps1 -Stop          Stop the running VM
#   .\dev-local.ps1 -Rebuild       Stop VM, clean cache, start fresh
#   .\dev-local.ps1 -SSH           SSH directly into the running VM
#   .\dev-local.ps1 -Log            Live cloud-init / system logs
#   .\dev-local.ps1 -Reprovision   Force re-running the in-VM setup
#   .\dev-local.ps1 -NoWatch       Don't auto-launch dev-watch TUI
#   .\dev-local.ps1 -Watcher        Launch dev-watch TUI in new terminal (VM must be running)
#   .\dev-local.ps1 -Foreground    Keep this window attached to QEMU
#   .\dev-local.ps1 -Ram 8GB -CpuCount 4
# ============================================================================

[CmdletBinding()]
param(
    [switch] $Clean,
    [switch] $CleanAll,
    [switch] $Status,
    [switch] $Stop,
    [switch] $Rebuild,
    [switch] $Reboot,
    [switch] $SSH,
    [switch] $Log,
    [switch] $Reprovision,
    [switch] $NoWatch,
    [switch] $Watcher,
    [switch] $Foreground,
    [switch] $SkipWhpx,
    [ValidateSet("source", "build")]
    [string] $Mode = "source",
    [ValidatePattern('^\d+(GB|G)?$')]
    [string] $Ram = "",
    [ValidateRange(1, 64)]
    [int]    $CpuCount = 0,
    [ValidateRange(1024, 65535)]
    [int]    $SshPort = 2222,
    [string] $QemuPath = "",
    [switch] $Help
)

# NOTE: we deliberately leave $ErrorActionPreference at the default ("Continue")
# so transient non-fatal errors don't abort the bootstrap. We check $LASTEXITCODE
# explicitly where it matters.
$ErrorActionPreference = "Continue"

# -- Friendly error for Linux-style double-dash arguments ------------------
$doubleDashArgs = $MyInvocation.Line -split '\s+' | Where-Object { $_ -match '^--' }
if ($doubleDashArgs) {
    Write-Host "[X] PowerShell uses single-dash arguments: -Clean not --clean" -ForegroundColor Red
    Write-Host "    Try: .\dev-local.ps1 -Clean" -ForegroundColor Yellow
    exit 1
}

if ($Help) {
    Write-Host "Usage: .\dev-local.ps1 [options]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  -Clean         Drop cached VM disk + seed ISO (keep image)"
    Write-Host "  -CleanAll      Also remove downloaded cloud image"
    Write-Host "  -Status        Show whether VM is running + health check"
    Write-Host "  -Stop          Stop the running VM"
    Write-Host "  -Reboot        Stop VM + restart fresh"
    Write-Host "  -Rebuild       Stop VM, clean cache, start fresh"
    Write-Host "  -SSH           SSH directly into the VM"
    Write-Host "  -Log           Live cloud-init / system logs"
    Write-Host "  -Reprovision   Force re-running the in-VM setup"
    Write-Host "  -NoWatch       Don't auto-launch dev-watch TUI"
    Write-Host "  -Watcher        Launch dev-watch TUI in new terminal (VM must be running)"
    Write-Host "  -Foreground    Keep this window attached to QEMU"
    Write-Host "  -Ram 8GB       Set VM RAM (default: auto)"
    Write-Host "  -CpuCount 4    Set VM CPU count (default: auto)"
    exit 0
}

# -- Logging helpers --------------------------------------------------------
function Write-Info    { param([string]$Msg) Write-Host "[*] $Msg" -ForegroundColor Cyan }
function Write-Success { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green }
function Write-Warn    { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Err     { param([string]$Msg) Write-Host "[X] $Msg" -ForegroundColor Red }
function Write-Dim     { param([string]$Msg) Write-Host $Msg -ForegroundColor DarkGray }
function Stop-WithError {
    param([string]$Msg)
    Write-Err $Msg
    exit 1
}

# -- Load Auto-Repair Module ------------------------------------------------
$AUTO_REPAIR_MODULE = Join-Path $PSScriptRoot "lib\DevAutoRepair.psm1"
if (Test-Path $AUTO_REPAIR_MODULE) {
    Import-Module $AUTO_REPAIR_MODULE -ErrorAction SilentlyContinue
    if (Get-Module DevAutoRepair) {
        Write-Dim "Auto-repair enabled"
    }
} else {
    # Define no-op fallbacks if module not found
    function Test-PortConflict { return @{ InUse = $false } }
    function Resolve-PortConflict { return 0 }
    function Test-DiskSpace { return $true }
    function Invoke-DiskCleanup { }
    function Test-Dependencies { return @{ HasMissing = $false } }
    function Install-MissingDependencies { }
    function Test-PowerShell7 { return ($PSVersionTable.PSEdition -eq "Core") }
    function Install-PowerShell7 { return $false }
    function Start-HealthMonitor { }
    function Stop-HealthMonitor { }
    function Send-Notification { }
}

# -- PowerShell 7 recommendation ---------------------------------------------
# PS 5.1 reads .ps1 files without UTF-8 BOM as ANSI - non-ASCII characters can
# break parsing. PowerShell 7 reads UTF-8 by default. Ask once, never force.
if (-not (Test-PowerShell7)) {
    Write-Warn "Windows PowerShell $($PSVersionTable.PSVersion) (5.1) detected."
    Write-Warn "  PowerShell 7 is recommended: PS 5.1 misreads UTF-8 text in .ps1 files,"
    Write-Warn "  which can break parsing. Install with: winget install Microsoft.PowerShell"
    if (-not [Console]::IsInputRedirected) {
        $ans = Read-Host "Install PowerShell 7 now and re-run this script with pwsh? [y/N]"
        if ($ans -match '^[yY]') {
            if (Install-PowerShell7) {
                Write-Success "PowerShell 7 installed - re-run this script with: pwsh .\dev-local.ps1"
            }
        }
    }
}

Write-Host ""
Write-Host "  IORA OS - Local Dev VM (Windows / QEMU)" -ForegroundColor Cyan
Write-Host ""

# -- Paths ------------------------------------------------------------------
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT  = Split-Path -Parent $SCRIPT_DIR
$CACHE      = Join-Path $SCRIPT_DIR ".cache"
New-Item -ItemType Directory -Force -Path $CACHE | Out-Null

# Tee everything into a log file (rotated >1MB)
$LOG_FILE = Join-Path $CACHE "dev-local.log"
if ((Test-Path $LOG_FILE) -and ((Get-Item $LOG_FILE).Length -gt 1MB)) {
    Move-Item $LOG_FILE "$LOG_FILE.1" -Force -ErrorAction SilentlyContinue
}
try { Start-Transcript -Path $LOG_FILE -Append -IncludeInvocationHeader | Out-Null } catch {}

$IORA_DEV   = Join-Path $REPO_ROOT ".iora-dev"
$IORA_BINS  = Join-Path $IORA_DEV "binaries"
$IORA_SCC   = Join-Path $IORA_DEV "sccache"
New-Item -ItemType Directory -Force -Path $IORA_BINS, $IORA_SCC | Out-Null
Write-Info "Dev shared folder: $IORA_DEV"

# -- Platform detection (CIM, not deprecated WMI) ---------------------------
try {
    $proc = Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop | Select-Object -First 1
    if ($proc.Architecture -eq 12) { $HOST_ARCH = "ARM64" } else { $HOST_ARCH = "x86_64" }
} catch {
    $HOST_ARCH = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "ARM64" } else { "x86_64" }
}
$HOST_CPUS = [Environment]::ProcessorCount
try {
    $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    $hostRamGB = [Math]::Round($cs.TotalPhysicalMemory / 1GB)
} catch {
    $hostRamGB = 8
}

# -- QEMU detection ---------------------------------------------------------
function Find-Qemu {
    if ($QemuPath -and (Test-Path $QemuPath)) { return $QemuPath }
    $qemuBin = if ($HOST_ARCH -eq "ARM64") { "qemu-system-aarch64.exe" } else { "qemu-system-x86_64.exe" }
    $paths = @()
    $fromPath = Get-Command $qemuBin -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if ($fromPath) { $paths += $fromPath }
    if ($env:ProgramFiles) { $paths += (Join-Path $env:ProgramFiles "qemu\$qemuBin") }
    if (${env:ProgramFiles(x86)}) { $paths += (Join-Path ${env:ProgramFiles(x86)} "qemu\$qemuBin") }
    if ($env:LOCALAPPDATA) { $paths += (Join-Path $env:LOCALAPPDATA "Programs\qemu\$qemuBin") }
    $paths += "C:\Program Files\qemu\$qemuBin"
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) { return $p }
    }
    return $null
}

$QEMU_BIN = Find-Qemu
if (-not $QEMU_BIN) {
    Write-Warn "QEMU not found - attempting automatic installation..."
    if (Get-Command Install-QemuIfMissing -ErrorAction SilentlyContinue) {
        [void](Install-QemuIfMissing)
        Update-SessionPath
    } else {
        # Inline fallback when the auto-repair module is unavailable.
        # Note: the old winget id "QEMU.QEMU" was removed (Feb 2025); the
        # current id is SoftwareFreedomConservancy.QEMU.
        winget show --id SoftwareFreedomConservancy.QEMU --accept-source-agreements 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            winget install --silent --accept-package-agreements --accept-source-agreements --id SoftwareFreedomConservancy.QEMU 2>&1 | Out-Null
        } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
            choco install qemu -y --no-progress 2>&1 | Out-Null
        } elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
            scoop install qemu 2>&1 | Out-Null
        } else {
            Write-Warn "No package manager found - manual install: https://qemu.weilnetz.de/w64/"
        }
        if (Get-Command Update-SessionPath -ErrorAction SilentlyContinue) { Update-SessionPath }
        $env:PATH = "$env:ProgramFiles\qemu;$env:PATH"
    }
    $QEMU_BIN = Find-Qemu
    if (-not $QEMU_BIN) {
        Stop-WithError "QEMU not found. Install with: winget install SoftwareFreedomConservancy.QEMU (or: choco install qemu / scoop install qemu / https://qemu.weilnetz.de/w64/)"
    }
}
Write-Success "QEMU: $QEMU_BIN"
$QEMU_DIR = Split-Path -Parent $QEMU_BIN
$QEMU_IMG = Join-Path $QEMU_DIR "qemu-img.exe"
if (-not (Test-Path $QEMU_IMG)) { Stop-WithError "qemu-img.exe not found alongside QEMU." }

# -- WSL detection (needed for tar + ISO creation) --------------------------
$WSL_AVAILABLE = $false
try {
    wsl --status 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $WSL_AVAILABLE = $true }
} catch { }
if (-not $WSL_AVAILABLE) {
    Write-Warn "WSL2 not detected - attempting automatic installation..."
    if (Get-Command Install-WslIfMissing -ErrorAction SilentlyContinue) {
        [void](Install-WslIfMissing)
        $WSL_AVAILABLE = Test-WslAvailable
    } else {
        # Inline fallback when the auto-repair module is unavailable
        wsl --install -d Debian --no-launch 2>&1 | Out-Null
        wsl --status 2>&1 | Out-Null
        $WSL_AVAILABLE = ($LASTEXITCODE -eq 0)
    }
}
if (-not $WSL_AVAILABLE) {
    Stop-WithError "WSL2 is required. Install with: wsl --install (then reboot)."
}
Write-Success "WSL2 available"

# -- OpenSSH detection ------------------------------------------------------
$SSH_BIN = (Get-Command ssh.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
$SCP_BIN = (Get-Command scp.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
if (-not $SSH_BIN -or -not $SCP_BIN) {
    Stop-WithError "OpenSSH not found. Install: Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
}

# -- Config: VM sizing ------------------------------------------------------
$VM_IDEAL_RAM = 16
$VM_IDEAL_CPU = 16

if ($Ram) {
    $VM_RAM = ($Ram -replace 'GB$', 'G') -replace 'G+$', 'G'
} else {
    $vmRamGB = [Math]::Min($VM_IDEAL_RAM, [Math]::Max(4, $hostRamGB - 6))
    $VM_RAM = "${vmRamGB}G"
}
if ($CpuCount -eq 0) {
    $VM_CPUS = [Math]::Min($VM_IDEAL_CPU, [Math]::Max(2, $HOST_CPUS - 2))
} else {
    $VM_CPUS = $CpuCount
}
$vmRamNum = [int]($VM_RAM -replace 'G', '')

# Optimized cargo job calculation:
# - Each job needs ~2GB RAM (conservative estimate)
# - Leave at least 2 CPU cores for the system
# - Cap at physical CPU count for best performance
$cargoJobsByRam = [Math]::Floor($vmRamNum / 2)
$cargoJobsByCpu = [Math]::Max(1, $VM_CPUS - 2)
$CARGO_JOBS = [Math]::Min($cargoJobsByRam, $cargoJobsByCpu)
$CARGO_JOBS = [Math]::Max(1, [Math]::Min($CARGO_JOBS, $VM_CPUS))

Write-Info "Host: ${hostRamGB}GB RAM, ${HOST_CPUS} CPUs ($HOST_ARCH)"
Write-Info "VM:   $VM_RAM RAM, $VM_CPUS CPUs, cargo -j$CARGO_JOBS"
Write-Info "Mode: $Mode ($(if ($Mode -eq "source") { "cargo run from 1:1 mirror" } else { "deployed binaries" }))"

# -- Arch-specific cloud image ----------------------------------------------
if ($HOST_ARCH -eq "ARM64") {
    $IMG_URL   = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-arm64.qcow2"
    $IMG_CACHE = Join-Path $CACHE "debian-12-cloud-arm64.qcow2"
    $VM_MACHINE = "virt"
} else {
    $IMG_URL   = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
    $IMG_CACHE = Join-Path $CACHE "debian-12-cloud-amd64.qcow2"
    $VM_MACHINE = "q35"
}
$VM_DISK    = Join-Path $CACHE "iora-dev-vm.qcow2"
$SSH_KEY    = Join-Path $CACHE "iora-dev-key"
$SEED_ISO   = Join-Path $CACHE "iora-dev-seed.iso"
$QEMU_PIDFILE = Join-Path $CACHE "qemu.pid"
$PROVISIONED_MARKER = Join-Path $CACHE ".provisioned"
$QEMU_STDERR = Join-Path $CACHE "qemu-stderr.log"

# -- Ports forwarded host -> VM (mirrors IORA OS systemd unit ports) --------
$VM_HOME   = 8126
$VM_BRIDGE = 8101
$FWD_PORTS = @(80, 443, 3001, 5432, 8080, 8090, 8092, 8094, 8095, 8096, 8097, 8098)

# -- Helpers ----------------------------------------------------------------
function ConvertTo-WslPath { param([string]$WinPath)
    $p = $WinPath.Replace('\', '/')
    return (wsl wslpath -a "$p" 2>$null)
}

function Get-QemuPid {
    if (-not (Test-Path $QEMU_PIDFILE)) { return $null }
    $raw = (Get-Content $QEMU_PIDFILE -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $raw) { return $null }
    $pidNum = 0
    if ([int]::TryParse($raw.Trim(), [ref]$pidNum)) {
        $p = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
        if ($p) { return $p }
    }
    Remove-Item $QEMU_PIDFILE -Force -ErrorAction SilentlyContinue
    return $null
}

function Get-QemuProcess {
    # Fallback: look for any qemu-system-*.exe owned by current user
    Get-Process qemu-system-x86_64,qemu-system-aarch64 -ErrorAction SilentlyContinue
}

function Stop-Vm {
    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if (-not $p) {
        Write-Warn "VM is not running (no live QEMU process)."
        return
    }
    Write-Info "Stopping VM (PID $($p.Id))..."
    try { $p.CloseMainWindow() | Out-Null } catch {}
    for ($i=0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 1
        if ($p.HasExited) { break }
    }
    if (-not $p.HasExited) {
        Microsoft.PowerShell.Management\Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item $QEMU_PIDFILE -Force -ErrorAction SilentlyContinue
    Write-Success "VM stopped."
}

$SSH_OPTS = @(
    "-o","StrictHostKeyChecking=no",
    "-o","UserKnownHostsFile=NUL",
    "-o","IdentitiesOnly=yes",
    "-o","BatchMode=yes",
    "-o","ConnectTimeout=5",
    "-o","ServerAliveInterval=15",
    "-o","AddressFamily=inet",
    "-o","LogLevel=ERROR"
)

function Invoke-SSH {
    param([string] $Command)
    & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $SshPort root@127.0.0.1 $Command 2>&1
}

function Invoke-SSHStdin {
    param([string] $Script)
    $tmp = New-TemporaryFile
    $stdout = New-TemporaryFile
    $stderr = New-TemporaryFile
    $normalizedScript = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
    [System.IO.File]::WriteAllText($tmp, $normalizedScript, [System.Text.Encoding]::ASCII)
    try {
        $sshArgs = @() + $SSH_OPTS + @("-i", $SSH_KEY, "-p", $SshPort, "root@127.0.0.1", "bash -s")
        $proc = Start-Process -FilePath $SSH_BIN -ArgumentList $sshArgs -RedirectStandardInput $tmp -RedirectStandardOutput $stdout -RedirectStandardError $stderr -NoNewWindow -Wait -PassThru
        $global:LASTEXITCODE = $proc.ExitCode
        Get-Content $stdout -Raw -ErrorAction SilentlyContinue
        Get-Content $stderr -Raw -ErrorAction SilentlyContinue
    } finally {
        Remove-Item $tmp, $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

function Send-SCP {
    param([string] $LocalPath, [string] $RemotePath, [switch] $Recurse)
    $scpArgs = @() + $SSH_OPTS + @("-i", $SSH_KEY, "-P", $SshPort)
    if ($Recurse) { $scpArgs += "-r" }
    $scpArgs += @($LocalPath, "root@127.0.0.1:$RemotePath")
    & $SCP_BIN @scpArgs 2>&1
}

function Test-VmHealth {
    foreach ($p in @("http://127.0.0.1:$VM_HOME/api/health", "http://127.0.0.1:$VM_HOME/health")) {
        try {
            $resp = Invoke-WebRequest -Uri $p -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -eq 200) { return $true }
        } catch { }
    }
    return $false
}

function Test-WatcherNeedsBuild {
    param([string] $Binary)
    if (-not (Test-Path $Binary)) { return $true }
    $watcherRoot = Join-Path $REPO_ROOT "iora-os\backend\tools\iora-dev-watch"
    $latestSource = Get-ChildItem $watcherRoot -Recurse -File |
        Where-Object { $_.Extension -eq ".rs" -or $_.Name -eq "Cargo.toml" } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    return $latestSource -and $latestSource.LastWriteTimeUtc -gt (Get-Item $Binary).LastWriteTimeUtc
}

# -- -Status / -Stop / -Rebuild / -SSH fast paths ----------------------------
if ($Stop) {
    Stop-Vm
    exit 0
}

if ($SSH) {
    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if (-not $p) {
        Stop-WithError "VM is not running. Start it first: .\dev-local.ps1"
    }
    Write-Info "Connecting to VM via SSH..."
    & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $SshPort root@127.0.0.1
    exit 0
}

if ($Watcher) {
    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if (-not $p) {
        Stop-WithError "VM is not running. Start it first: .\dev-local.ps1"
    }
    $dashBin = Join-Path $REPO_ROOT "iora-os\backend\target\debug\iora-dev-watch.exe"
    if (Test-WatcherNeedsBuild $dashBin) {
        Write-Info "Building updated dev-watch TUI..."
        Push-Location (Join-Path $REPO_ROOT "iora-os\backend")
        try {
            cargo build -p iora-dev-watch 2>&1 | Select-Object -Last 5
            if ($LASTEXITCODE -ne 0) {
                Stop-WithError "Failed to build iora-dev-watch. Check: cd iora-os\backend && cargo build -p iora-dev-watch"
            }
            Write-Success "dev-watch TUI built"
        } finally { Pop-Location }
    }
    Write-Info "Launching IORA Dev Watch TUI..."
    # IMPORTANT: launch the exe DIRECTLY via Start-Process -FilePath. Do NOT
    # wrap in `powershell -NoExit -Command "& '...'"` or `cmd /c "..."` - a
    # shell parent intercepts stdin, breaks crossterm's raw mode, and on cmd
    # the nested-quotes parsing fails ("Die Syntax fuer den Dateinamen ... ist
    # falsch"). Direct launch makes the watcher own its console.
    $watcherArgs = @(
        '--vm-host', '127.0.0.1',
        '--vm-port', "$SshPort",
        '--ssh-key', "$SSH_KEY"
    )
    Start-Process -FilePath $dashBin -ArgumentList $watcherArgs
    Write-Success "Dev Watch TUI launched in new terminal"
    exit 0
}

if ($Log) {
    $serialLog = Join-Path $CACHE "qemu-serial.log"
    $cloudLog = "/var/log/cloud-init-output.log"
    $cloudMainLog = "/var/log/cloud-init.log"

    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if (-not $p) {
        Write-Warn "VM is not running. Showing last QEMU serial log:"
        Write-Host "================ QEMU Serial Log ================" -ForegroundColor DarkGray
        if (Test-Path $serialLog) {
            Get-Content $serialLog -Tail 50
        } else {
            Write-Host "  (no serial log found)"
        }
        exit 0
    }

    $sshOk = Invoke-SSH "echo SSH_OK" 2>$null
    if ("$sshOk" -match "SSH_OK") {
        $hasCloudLog = Invoke-SSH "test -f $cloudLog && echo YES" 2>$null
        $hasCloudMainLog = Invoke-SSH "test -f $cloudMainLog && echo YES" 2>$null
        if ("$hasCloudLog" -match "YES") {
            Write-Info "Live cloud-init output log (Ctrl+C to stop)..."
            & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $SshPort root@127.0.0.1 "tail -f $cloudLog"
        } elseif ("$hasCloudMainLog" -match "YES") {
            Write-Info "Live cloud-init main log (Ctrl+C to stop)..."
            & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $SshPort root@127.0.0.1 "tail -f $cloudMainLog"
        } else {
            Write-Info "SSH ready. Following syslog (Ctrl+C to stop)..."
            & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $SshPort root@127.0.0.1 "tail -f /var/log/syslog"
        }
    } else {
        Write-Warn "SSH not yet reachable. Following QEMU serial console (live - Ctrl+C to stop):"
        Write-Host "================ QEMU Serial Console ================" -ForegroundColor DarkGray
        if (Test-Path $serialLog) {
            Get-Content $serialLog -Wait -Tail 20
        } else {
            Write-Warn "No serial log available yet."
        }
    }
    exit 0
}

if ($Reboot) {
    Write-Info "Reboot: stopping VM..."
    Stop-Vm
    Write-Info "Starting fresh..."
    # Fall through to normal start
}

if ($Rebuild) {
    Write-Info "Rebuild: stopping VM..."
    Stop-Vm
    Write-Info "Cleaning cache..."
    Get-ChildItem -Path $CACHE -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -notlike "debian-12-cloud-*.qcow2"
    } | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $CACHE "seed") -Recurse -Force -ErrorAction SilentlyContinue
    & ssh-keygen -R "[127.0.0.1]:$SshPort" 2>$null | Out-Null
    & ssh-keygen -R "[localhost]:$SshPort" 2>$null | Out-Null
    Write-Info "Starting fresh provision..."
    # Fall through to normal start
}

if ($Status) {
    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if (-not $p) {
        Write-Warn "VM is not running"
        exit 1
    }
    Write-Success "VM running (PID $($p.Id))"
    Write-Info "Forwarded ports: SSH=$SshPort, dashboard=$VM_HOME, bridge=$VM_BRIDGE"
    $sshResp = Invoke-SSH "echo SSH_OK"
    if ("$sshResp" -match "SSH_OK") { Write-Success "SSH responsive" } else { Write-Warn "SSH not yet responsive" }
    if (Test-VmHealth) { Write-Success "iora-home health OK (port $VM_HOME)" }
    else { Write-Warn "iora-home not responding on port $VM_HOME yet" }
    exit 0
}

# -- UEFI firmware ----------------------------------------------------------
$FW = $null
if ($HOST_ARCH -eq "ARM64") {
    $fwPaths = @(
        (Join-Path $QEMU_DIR "..\share\qemu\edk2-aarch64-code.fd"),
        (Join-Path $QEMU_DIR "..\share\edk2-aarch64-code.fd"),
        (Join-Path $QEMU_DIR "edk2-aarch64-code.fd")
    )
    $fwIsFlash = $false
} else {
    $fwPaths = @(
        (Join-Path $QEMU_DIR "share\edk2-x86_64-code.fd"),
        (Join-Path $QEMU_DIR "edk2-x86_64-code.fd"),
        (Join-Path $QEMU_DIR "OVMF_CODE.fd")
    )
    $fwIsFlash = $true
}
foreach ($f in $fwPaths) { if (Test-Path $f) { $FW = $f; break } }
if (-not $FW) { Stop-WithError "UEFI firmware not found in $QEMU_DIR" }
if ($fwIsFlash) {
    $FW_CODE_CACHED = Join-Path $CACHE "OVMF_CODE.fd"
    Copy-Item $FW $FW_CODE_CACHED -Force -ErrorAction SilentlyContinue
    $FW = $FW_CODE_CACHED

    # Cache writable VARS file (required for UEFI boot variables persistence)
    $FW_VARS_CACHED = Join-Path $CACHE "OVMF_VARS.fd"
    if (-not (Test-Path $FW_VARS_CACHED)) {
        $varsPaths = @(
            (Join-Path $QEMU_DIR "share\edk2-x86_64-vars.fd"),
            (Join-Path $QEMU_DIR "share\edk2-i386-vars.fd"),
            (Join-Path $QEMU_DIR "edk2-x86_64-vars.fd"),
            (Join-Path $QEMU_DIR "edk2-i386-vars.fd")
        )
        foreach ($v in $varsPaths) { if (Test-Path $v) { Copy-Item $v $FW_VARS_CACHED -Force -ErrorAction SilentlyContinue; break } }
    }
    if (Test-Path $FW_VARS_CACHED) {
        Write-Dim "  VARS: $FW_VARS_CACHED"
    }
}
Write-Success "UEFI firmware: $FW"

# -- -Clean / -CleanAll -----------------------------------------------------
if ($Clean -or $CleanAll) {
    Write-Info "Cleaning cache..."
    Stop-Vm
    Get-ChildItem -Path $CACHE -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -notlike "debian-12-cloud-*.qcow2"
    } | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $CACHE "seed") -Recurse -Force -ErrorAction SilentlyContinue
    if ($CleanAll) {
        Remove-Item -Path $IMG_CACHE -Force -ErrorAction SilentlyContinue
    }
    & ssh-keygen -R "[127.0.0.1]:$SshPort" 2>$null | Out-Null
    & ssh-keygen -R "[localhost]:$SshPort" 2>$null | Out-Null
    Write-Success "Done. Re-run without -Clean to provision."
    exit 0
}

# -- Step 1: Download cloud image -------------------------------------------
if (-not (Test-Path $IMG_CACHE)) {
    Write-Info "Downloading Debian cloud image (~400MB, one-time)..."
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $IMG_URL -OutFile "$IMG_CACHE.tmp" -TimeoutSec 900 -UseBasicParsing
    } catch {
        Stop-WithError "Download failed: $_"
    }
    $sz = (Get-Item "$IMG_CACHE.tmp").Length
    if ($sz -gt 1048576) {
        Move-Item "$IMG_CACHE.tmp" $IMG_CACHE -Force
        Write-Success "Downloaded ($([Math]::Round($sz/1MB)) MB)"
    } else {
        Remove-Item "$IMG_CACHE.tmp" -Force -ErrorAction SilentlyContinue
        Stop-WithError "Download truncated."
    }
    $ProgressPreference = 'Continue'
}

# -- Step 2: VM disk overlay ------------------------------------------------
if (-not (Test-Path $VM_DISK)) {
    Write-Info "Creating VM disk overlay (40G)..."
    & $QEMU_IMG create -f qcow2 -b $IMG_CACHE -F qcow2 $VM_DISK 40G | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-WithError "qemu-img create failed." }
}

# -- Step 3: SSH key + cloud-init seed ISO ----------------------------------
if (-not (Test-Path $SSH_KEY)) {
    Write-Info "Generating SSH key for VM..."
    # Prefer the Windows OpenSSH ssh-keygen (no WSL startup needed); the
    # piped newline guards against an interactive passphrase prompt.
    $keygenOk = $false
    $winKeygen = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
    if ($winKeygen) {
        "`n" | & $winKeygen.Source -t ed25519 -f $SSH_KEY -N "" -C "iora-dev-vm" 2>$null
        $keygenOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $keygenOk) {
        # Fallback: generate inside WSL
        $sshKeyWsl = ConvertTo-WslPath $SSH_KEY
        wsl bash -c "ssh-keygen -t ed25519 -f '$sshKeyWsl' -N '' -C 'iora-dev-vm'" 2>$null
        $keygenOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $keygenOk) { Stop-WithError "ssh-keygen failed." }
    icacls $SSH_KEY /inheritance:r /grant:r "${env:USERNAME}:R" 2>$null | Out-Null
    icacls "$SSH_KEY.pub" /inheritance:r /grant:r "${env:USERNAME}:R" 2>$null | Out-Null
    Write-Success "SSH key: $SSH_KEY"
}

function New-SeedIso {
    Write-Info "Generating cloud-init seed ISO..."
    $seedDir = Join-Path $CACHE "seed"
    Remove-Item -Recurse -Force $seedDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $seedDir | Out-Null
    $pubkey = (Get-Content "$SSH_KEY.pub" -Raw).Trim()

    $userData = @"
#cloud-config
ssh_pwauth: true
disable_root: false
hostname: iora-dev

users:
  - name: root
    ssh_authorized_keys:
      - $pubkey
  - name: iora
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    groups: sudo, docker
    ssh_authorized_keys:
      - $pubkey

chpasswd:
  list:
    - root:iora
    - iora:iora
  expire: false

datasource_list: [ NoCloud ]

write_files:
  - path: /etc/resolv.conf
    content: |
      nameserver 8.8.8.8
      nameserver 1.1.1.1
      options use-vc
    permissions: '0644'
  - path: /etc/systemd/resolved.conf.d/disable-stub.conf
    content: |
      [Resolve]
      DNSStubListener=no
      LLMNR=no
      MulticastDNS=no
    permissions: '0644'

bootcmd:
  - sleep 3
  - ip link set enp0s2 up || ip link set eth0 up || true
  - sleep 2
  - 'sysctl -w net.ipv6.conf.all.disable_ipv6=1 || true'
  - 'sysctl -w net.ipv6.conf.default.disable_ipv6=1 || true'

package_update: false
package_upgrade: false

runcmd:
  - mkdir -p /etc/iora && touch /etc/iora/ssh-ready
  - 'systemctl restart systemd-resolved 2>/dev/null || true'
  - 'systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true'

final_message: "IORA Dev VM ready."
"@
    Set-Content -Path (Join-Path $seedDir "user-data") -Value $userData -NoNewline -Encoding ASCII
    Set-Content -Path (Join-Path $seedDir "meta-data") -Value "instance-id: iora-dev-vm`nlocal-hostname: iora-dev`n" -NoNewline -Encoding ASCII

    $seedDirWsl = ConvertTo-WslPath $seedDir
    $seedIsoWsl = ConvertTo-WslPath $SEED_ISO

    # Single WSL invocation: pick an existing ISO tool, otherwise install one
    # (fast path WITHOUT apt-get update - update only runs when the package is
    # unknown), then create the seed ISO. Saves 4-5 WSL startups and a
    # needless package-index refresh on every run.
    $wslScript = @"
set -e
TOOL=""
for t in genisoimage mkisofs xorriso; do
    command -v "\$t" >/dev/null 2>&1 && { TOOL="\$t"; break; }
done
if [ -z "\$TOOL" ]; then
    echo "[*] genisoimage missing - trying install without apt update..."
    if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq genisoimage >/dev/null 2>&1; then
        echo "[*] Package lists stale - running apt-get update..."
        sudo apt-get update -qq
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq genisoimage
    fi
    if command -v genisoimage >/dev/null 2>&1; then TOOL="genisoimage"
    elif command -v xorriso >/dev/null 2>&1; then TOOL="xorriso"; fi
fi
[ -n "\$TOOL" ] || { echo "[X] No ISO creation tool available in WSL"; exit 1; }
if [ "\$TOOL" = "xorriso" ]; then
    xorriso -as mkisofs -output "$seedIsoWsl" -volid cidata -joliet -rock "$seedDirWsl"
else
    "\$TOOL" -output "$seedIsoWsl" -volid cidata -joliet -rock "$seedDirWsl"
fi
"@
    wsl bash -c $wslScript 2>&1 | Out-Null
    $created = ($LASTEXITCODE -eq 0) -and (Test-Path $SEED_ISO)
    Remove-Item -Recurse -Force $seedDir -ErrorAction SilentlyContinue
    if (-not $created) { Stop-WithError "Failed to create seed ISO. Manual: wsl sudo apt-get install genisoimage" }
    Write-Success "Seed ISO created: $SEED_ISO"
}

if (-not (Test-Path $SEED_ISO)) { New-SeedIso }

# -- Step 4: Start QEMU (only if not already running) -----------------------
& ssh-keygen -R "[127.0.0.1]:$SshPort" 2>$null | Out-Null
& ssh-keygen -R "[localhost]:$SshPort" 2>$null | Out-Null

# Pre-flight checks: disk space and dependencies
if (Get-Command Test-DiskSpace -ErrorAction SilentlyContinue) {
    if (-not (Test-DiskSpace -Path $CACHE -MinimumGB 5)) {
        Write-Dim "Attempting automatic cache cleanup..."
        Invoke-DiskCleanup -CacheDir $CACHE
    }
}

$existingProc = Get-QemuPid
if ($existingProc) {
    Write-Success "QEMU already running (PID $($existingProc.Id)) - attaching to existing VM."
    $qemuProc = $existingProc
} else {
    # Intelligent port conflict resolution
    if (Get-Command Test-PortConflict -ErrorAction SilentlyContinue) {
        $portCheck = Test-PortConflict -Port $SshPort
        if ($portCheck.InUse) {
            Write-Dim "Port $SshPort appears to be in use - checking..."
            $resolveResult = Resolve-PortConflict -Port $SshPort -ServiceName "IORA VM"
            if ($resolveResult -eq 2) {
                # Existing IORA VM found - reuse it
                $existingProc = Get-QemuPid
                if ($existingProc) {
                    Write-Success "Reusing existing IORA VM"
                    $qemuProc = $existingProc
                }
            } elseif ($resolveResult -ne 0) {
                Stop-WithError "Port $SshPort could not be freed. Run with -Stop or pick a free port."
            }
        }
    }

    # Only start QEMU if we didn't find an existing VM
    if (-not $existingProc) {
        Write-Info "Starting QEMU..."

        # Build the netdev hostfwd string
        $fwd = "user,id=n0,hostfwd=tcp::${SshPort}-:22,hostfwd=tcp::${VM_HOME}-:8126,hostfwd=tcp::${VM_BRIDGE}-:8101"
        foreach ($p in $FWD_PORTS) { $fwd += ",hostfwd=tcp::${p}-:${p}" }

        $fwDrive = if ($fwIsFlash) {
            $base = @("-drive", "if=pflash,format=raw,readonly=on,file=$FW")
            if (Test-Path $FW_VARS_CACHED) {
                $base += @("-drive", "if=pflash,format=raw,file=$FW_VARS_CACHED")
            }
            $base
        } else {
            @("-bios", $FW)
        }

        $qemuArgs = @(
            "-name", "IORA-Dev",
            "-m", $VM_RAM,
            "-smp", $VM_CPUS
        ) + $fwDrive + @(
            "-drive", "file=$VM_DISK,format=qcow2,if=virtio",
            "-drive", "file=$SEED_ISO,format=raw,media=cdrom",
            "-netdev", $fwd,
            "-device", "e1000,netdev=n0",
            "-device", "virtio-gpu",
            "-machine", "${VM_MACHINE},accel=whpx",
            "-serial", "file:$($CACHE)\qemu-serial.log",
            "-display", "gtk,show-cursor=on"
        )

        $qemuArgs += @("-boot", "order=d,menu=off")

        function Start-Qemu {
            param([string[]] $QemuArgs, [string] $Accel, [switch] $NoWindow)
            Write-Info "QEMU ($Accel)"
            if (-not $QemuArgs -or $QemuArgs.Count -eq 0) {
                Stop-WithError "QEMU argument list is empty."
            }
            $badArgIndexes = @()
            for ($i = 0; $i -lt $QemuArgs.Count; $i++) {
                if ([string]::IsNullOrWhiteSpace($QemuArgs[$i])) { $badArgIndexes += $i }
            }
            if ($badArgIndexes.Count -gt 0) {
                Stop-WithError "QEMU argument list contains empty values at indexes: $($badArgIndexes -join ', ')"
            }
            try {
                if ($Foreground -or $NoWindow) {
                    $proc = Start-Process -FilePath $QEMU_BIN -ArgumentList $QemuArgs -PassThru -NoNewWindow -RedirectStandardError $QEMU_STDERR -ErrorAction Stop
                } else {
                    $proc = Start-Process -FilePath $QEMU_BIN -ArgumentList $QemuArgs -PassThru -WindowStyle Minimized -RedirectStandardError $QEMU_STDERR -ErrorAction Stop
                }
            } catch {
                Stop-WithError "Failed to start QEMU: $_"
            }
            if (-not $proc) { Stop-WithError "Failed to start QEMU: no process returned." }
            # Record PID for later
            Set-Content -Path $QEMU_PIDFILE -Value $proc.Id -NoNewline -Encoding ASCII
            return $proc
        }

        function Test-Alive {
            param($Proc, [int] $WaitSec)
            for ($i = 0; $i -lt $WaitSec; $i++) {
                Start-Sleep -Seconds 1
                if ($Proc.HasExited) { return $false }
            }
            return $true
        }

        # Try WHPX first unless explicitly skipped
        $useWhpx = -not $SkipWhpx
        if ($useWhpx) {
            $qemuProc = Start-Qemu -QemuArgs $qemuArgs -Accel "WHPX"
            if (-not (Test-Alive -Proc $qemuProc -WaitSec 8)) {
                Write-Warn "WHPX failed; falling back to TCG."
                if (-not $qemuProc.HasExited) { Microsoft.PowerShell.Management\Stop-Process -Id $qemuProc.Id -Force -ErrorAction SilentlyContinue }
                # WHPX can corrupt the overlay; recreate it
                Remove-Item $VM_DISK -Force -ErrorAction SilentlyContinue
                & $QEMU_IMG create -f qcow2 -b $IMG_CACHE -F qcow2 $VM_DISK 40G | Out-Null
                $useWhpx = $false
            }
        }

        if (-not $useWhpx) {
            $tcgRam  = [Math]::Max(4, [Math]::Min([int]($VM_RAM -replace 'G',''), 8))
            $tcgCpus = [Math]::Max(2, [Math]::Min($VM_CPUS, 8))
            $tcgArgs = @(
                "-name", "IORA-Dev",
                "-m", "${tcgRam}G",
                "-smp", $tcgCpus,
                "-machine", "${VM_MACHINE},accel=tcg"
            )
            if ($fwIsFlash) {
                $tcgArgs += @("-drive", "if=pflash,format=raw,readonly=on,file=$FW")
                if (Test-Path $FW_VARS_CACHED) {
                    $tcgArgs += @("-drive", "if=pflash,format=raw,file=$FW_VARS_CACHED")
                }
            }
            $tcgArgs += @(
                "-drive", "file=$VM_DISK,format=qcow2,if=virtio",
                "-drive", "file=$SEED_ISO,format=raw,media=cdrom",
                "-boot", "order=d,menu=off",
                "-netdev", $fwd,
                "-device", "e1000,netdev=n0",
                "-serial", "file:$($CACHE)\qemu-serial.log",
                "-display", "none",
                "-monitor", "none"
            )
            $qemuProc = Start-Qemu -QemuArgs $tcgArgs -Accel "TCG"
            if (-not (Test-Alive -Proc $qemuProc -WaitSec 20)) {
                Stop-WithError "QEMU/TCG also crashed. See $QEMU_STDERR"
            }
        }
    }
}

# -- Live serial console (separate window) ------------------------------------
$serialLog = Join-Path $CACHE "qemu-serial.log"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'IORA Dev VM - Serial Console (live)' -ForegroundColor Cyan; Get-Content -Wait -Tail 0 '$serialLog'" -WindowStyle Minimized | Out-Null

# -- Step 5: Wait for cloud-init to finish ----------------------------------
Write-Info "Waiting for cloud-init to finish (first boot may take 3-10 min)..."
$waited = 0
$ready = $false
$timeout = 900
while ($waited -lt $timeout) {
    if ($qemuProc.HasExited) {
        Stop-WithError "QEMU exited (code $($qemuProc.ExitCode)). See $QEMU_STDERR"
    }
    $result = Invoke-SSH 'test -f /var/lib/cloud/instance/boot-finished && echo READY'
    if ("$result" -match "READY") { $ready = $true; break }
    Start-Sleep -Seconds 5
    $waited += 5
    Write-Host -NoNewline "."
    if ($waited % 60 -eq 0 -and $waited -gt 0) { Write-Host -NoNewline "[${waited}s]" }
}
Write-Host ""
if (-not $ready) {
    Stop-WithError "Cloud-init timed out. Try: ssh -i $SSH_KEY -p $SshPort root@127.0.0.1"
}
Write-Success "SSH ready!"

# -- Step 6: Provisioning (idempotent) --------------------------------------
$needProvision = $true
if ((Test-Path $PROVISIONED_MARKER) -and (-not $Reprovision)) {
    $check = Invoke-SSH 'test -f /etc/iora/dev-vm-provisioned && test -d /opt/iora && echo PROV_OK'
    if ("$check" -match "PROV_OK") {
        Write-Success "VM already provisioned (use -Reprovision to force)"
        $needProvision = $false
    }
}

# Always sync source (incremental 1:1 mirror via WSL rsync)
Write-Info "Syncing project to VM (WSL rsync, incremental)..."
$repoWsl = ConvertTo-WslPath $REPO_ROOT
$keyWsl = ConvertTo-WslPath $SSH_KEY
# drvfs keys have loose permissions that ssh refuses - stage a 0600 copy in WSL
wsl bash -c "mkdir -p ~/.ssh && install -m 600 '$keyWsl' ~/.ssh/iora_dev_key 2>/dev/null || cp '$keyWsl' ~/.ssh/iora_dev_key" 2>$null | Out-Null
$syncExcludes = "--exclude='.git' --exclude='target' --exclude='node_modules' --exclude='.cache' --exclude='buildroot-*' --exclude='releases' --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' --exclude='*.tar.gz' --exclude='.iora-dev'"
$syncSsh = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=5 -o AddressFamily=inet -i ~/.ssh/iora_dev_key -p $SshPort"
wsl bash -c "rsync -az --delete $syncExcludes -e 'ssh $syncSsh' '$repoWsl/' root@127.0.0.1:/home/iora/iora/ && ssh $syncSsh root@127.0.0.1 'chown -R iora:iora /home/iora/iora'" 2>&1 | Out-Null
$mainSyncOk = ($LASTEXITCODE -eq 0)
if ($mainSyncOk -and $Mode -eq "build") {
    # Build mode: also mirror the drop-box so host-built binaries reach the daemon
    wsl bash -c "rsync -az --delete -e 'ssh $syncSsh' '$repoWsl/.iora-dev/binaries/' root@127.0.0.1:/home/iora/iora/.iora-dev/binaries/ 2>/dev/null || true" 2>&1 | Out-Null
}
if (-not $mainSyncOk) {
    Write-Warn "WSL rsync failed - falling back to tar+scp..."
    $projectTar = Join-Path $CACHE "iora-project.tar.gz"
    Push-Location $REPO_ROOT
    try {
        tar -czf $projectTar `
            --exclude='.git' --exclude='target' --exclude='node_modules' `
            --exclude='.cache' --exclude='buildroot-*' --exclude='releases' `
            --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' `
            --exclude='*.tar.gz' --exclude='.iora-dev' . 2>$null
    } finally {
        Pop-Location
    }
    if (Test-Path $projectTar) {
        $sizeMB = [Math]::Round((Get-Item $projectTar).Length / 1MB)
        Write-Info "  uploading ${sizeMB}MB archive..."
        Invoke-SSH 'mkdir -p /home/iora/iora' | Out-Null
        Send-SCP -LocalPath $projectTar -RemotePath "/home/iora/iora/" | Out-Null
        Invoke-SSH 'cd /home/iora/iora && tar -xzf iora-project.tar.gz && rm iora-project.tar.gz && chown -R iora:iora /home/iora/iora' | Out-Null
        Remove-Item $projectTar -Force -ErrorAction SilentlyContinue
    } else {
        Stop-WithError "Project sync failed (rsync and tar fallback both failed)."
    }
}
Write-Success "Project synced (1:1 mirror at /home/iora/iora)"

if ($needProvision) {
    Write-Info "Installing system packages (slow first-run step)..."
    $installScript = @'
set -e
export DEBIAN_FRONTEND=noninteractive
for i in 1 2 3 4 5 6 7 8 9 10; do
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
    sleep 3
done
    if [ -f /etc/systemd/system/postgresql.service.d/20-iora-init.conf ] && \
       grep -Eq '/usr/bin/pg_ctl|/var/lib/pgsql' /etc/systemd/system/postgresql.service.d/20-iora-init.conf; then
        echo "Removing incompatible PostgreSQL service override from previous dev VM provisioning"
        rm -f /etc/systemd/system/postgresql.service.d/20-iora-init.conf
        rmdir /etc/systemd/system/postgresql.service.d 2>/dev/null || true
        systemctl daemon-reload 2>/dev/null || true
        systemctl reset-failed postgresql postgresql@15-main 2>/dev/null || true
    fi
apt-get update -qq
# --no-install-recommends + retries: smaller download, faster provisioning
apt-get install -y -qq --no-install-recommends -o Acquire::Retries=3 \
    curl git ca-certificates build-essential pkg-config libssl-dev \
    nodejs npm docker.io postgresql postgresql-client rsync \
    python3 python3-pip htop vim mold nginx openssl socat \
    sudo systemd-container
systemctl enable --now docker postgresql nginx 2>/dev/null || true
'@
    $installOutput = Invoke-SSHStdin $installScript
    $installExitCode = $LASTEXITCODE
    $installOutput | Select-Object -Last 5
    if ($installExitCode -ne 0) {
        Stop-WithError "Installing system packages failed in VM (ssh exit code $installExitCode)."
    }

    Write-Info "Configuring PostgreSQL roles and dev-mode marker..."
    $postgresScript = @'
set +e
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='root'\"" | grep -q 1 \
    || su - postgres -c "psql -c \"CREATE ROLE root WITH LOGIN SUPERUSER PASSWORD 'iora'\""
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='iora'\"" | grep -q 1 \
    || su - postgres -c "psql -c \"CREATE USER iora WITH PASSWORD 'iora' CREATEDB\""
mkdir -p /etc/iora && touch /etc/iora/os-dev-mode
'@
    $null = Invoke-SSHStdin $postgresScript

    Write-Info "Installing Rust toolchain (for in-VM cargo)..."
    Invoke-SSH 'su - iora -c ''test -x ~/.cargo/bin/rustc || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal'' 2>&1' | Select-Object -Last 5

    Write-Info "Configuring Cargo (mold + sparse registry + incremental builds)..."
    $cargoCfgTemplate = @'
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[target.aarch64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[registries.crates-io]
protocol = "sparse"

[build]
incremental = true
jobs = __CARGO_JOBS__

[net]
retry = 2
git-fetch-with-cli = true

[profile.dev]
incremental = true

[profile.release]
incremental = false
'@
    $cargoCfg = $cargoCfgTemplate -replace '__CARGO_JOBS__', $CARGO_JOBS
    $cargoCfgPath = Join-Path $CACHE "cargo-config.toml"
    Set-Content -Path $cargoCfgPath -Value $cargoCfg -NoNewline -Encoding ASCII
    Send-SCP -LocalPath $cargoCfgPath -RemotePath "/tmp/cargo-config.toml" | Out-Null
    Invoke-SSH 'su - iora -c ''mkdir -p ~/.cargo && cp /tmp/cargo-config.toml ~/.cargo/config.toml''' | Out-Null
    Remove-Item $cargoCfgPath -Force -ErrorAction SilentlyContinue
    Write-Success "Cargo configured"

    Write-Info "Applying IORA OS compat layer + improvements (one SSH session)..."
    $compatScript = @'
for s in iora-dev-compat.sh iora-dev-improvements.sh iora-optimize-memory.sh iora-config-sync.sh; do
    echo "=== $s ==="
    bash "/home/iora/iora/iora-os/$s" 2>&1 | tail -n 8
    echo ""
done
'@
    Invoke-SSHStdin $compatScript | Select-Object -Last 12
    Write-Info "Registering IORA OS systemd services (mode: $Mode)..."
    Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-services.sh --$Mode-mode 2>&1" | Select-Object -Last 8

    Invoke-SSH 'mkdir -p /etc/iora && touch /etc/iora/dev-vm-provisioned' | Out-Null
    Set-Content -Path $PROVISIONED_MARKER -Value (Get-Date -Format "o") -NoNewline
    Write-Success "Provisioning complete"
}

# -- Step 7: DB init + service enablement (always run; safe to repeat) ------
Write-Info "Initializing databases..."
$dbInitScript = @'
set +e
su - postgres -c "createuser -s root 2>/dev/null"
for db in iora_home iora_core iora_security iora_secrets iora_appstore; do
    su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 \
        || su - postgres -c "psql -c \"CREATE DATABASE $db OWNER iora\""
done
mkdir -p /etc/systemd/system/iora-home.service.d /opt/iora/build/iora-home/data
if [ "$(cat /etc/iora/dev-run-mode 2>/dev/null || echo source)" = "build" ]; then
cat > /etc/systemd/system/iora-home.service.d/db.conf <<CFG
[Service]
Environment=DATABASE_URL=postgres://root:iora@localhost/iora_home
WorkingDirectory=/opt/iora/build/iora-home
CFG
else
# Source mode: no WorkingDirectory override (unit runs cargo run from the mirror)
rm -f /etc/systemd/system/iora-home.service.d/db.conf
fi

# Central log viewer: iora-home must be able to read other services' journals.
cat > /etc/systemd/system/iora-home.service.d/logs.conf <<CFG
[Service]
SupplementaryGroups=systemd-journal
CFG

# Bootstrap admin credentials for dev VM (idempotent)
mkdir -p /etc/iora
if [ ! -f /etc/iora/iora-home.env ]; then
cat > /etc/iora/iora-home.env <<'ENVEOF'
DATABASE_URL=postgres://root:iora@localhost:5432/iora_home
RUST_LOG=iora-home=debug
IORA_BOOTSTRAP_ADMIN_USER=admin
IORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234
ENVEOF
fi
# If file already exists, ensure bootstrap vars are present
if [ -f /etc/iora/iora-home.env ]; then
    grep -q 'IORA_BOOTSTRAP_ADMIN_USER' /etc/iora/iora-home.env 2>/dev/null || echo 'IORA_BOOTSTRAP_ADMIN_USER=admin' >> /etc/iora/iora-home.env
    grep -q 'IORA_BOOTSTRAP_ADMIN_PASSWORD' /etc/iora/iora-home.env 2>/dev/null || echo 'IORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234' >> /etc/iora/iora-home.env
fi
systemctl daemon-reload
systemctl reset-failed iora-db-init 2>/dev/null
systemctl restart iora-home 2>/dev/null
systemctl enable --now iora-hot-reload.path 2>/dev/null
systemctl enable --now iora-health-check.timer 2>/dev/null
'@
$null = Invoke-SSHStdin $dbInitScript
Write-Success "Databases initialized"

# -- Step 8: Hot-reload daemon ------------------------------------------------
Write-Info "Installing hot-reload daemon (mode: $Mode)..."
$hotReloadScript = @'
set -e
install -m 0755 /home/iora/iora/iora-os/iora-dev-hot-reload.sh /usr/local/bin/iora-dev-hot-reload.sh
cat > /etc/systemd/system/iora-hot-reload.service <<'UNIT'
[Unit]
Description=IORA Dev VM Hot-Reload (1:1 mirror watcher)
After=multi-user.target

[Service]
Type=simple
ExecStart=/usr/local/bin/iora-dev-hot-reload.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now iora-hot-reload.service 2>/dev/null || true
systemctl restart iora-hot-reload.service 2>/dev/null || true
echo "[OK] hot-reload daemon active (mode: $(cat /etc/iora/dev-run-mode 2>/dev/null || echo source))"
'@
$null = Invoke-SSHStdin $hotReloadScript

# -- Step 9: Frontend (source mode: Vite in VM / build mode: dist deploy) ----
if ($Mode -eq "source") {
    Write-Info "Source mode: setting up the Vite dev server in the VM..."
    $viteScript = @'
set +e
cd /home/iora/iora/frontend || exit 0
if [ -f package.json ]; then
    [ -d node_modules ] || npm install --no-audit --no-fund 2>&1 | tail -3
    cat > /etc/systemd/system/iora-frontend-dev.service <<'UNIT'
[Unit]
Description=IORA Frontend Vite Dev Server (source mode)
After=network.target

[Service]
Type=simple
User=iora
Group=iora
WorkingDirectory=/home/iora/iora/frontend
ExecStart=/usr/bin/npm run dev -- --host 0.0.0.0 --port 5173
Restart=always
RestartSec=3
Environment=NODE_ENV=development
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now iora-frontend-dev.service 2>/dev/null || true
    grep -q IORA_FRONTEND_DEV_URL /etc/iora/iora-home.env 2>/dev/null || echo 'IORA_FRONTEND_DEV_URL=http://127.0.0.1:5173' >> /etc/iora/iora-home.env
    systemctl restart iora-home 2>/dev/null || true
    echo "[OK] Vite dev server unit created (HMR via iora-home proxy)"
fi
'@
    $null = Invoke-SSHStdin $viteScript
} else {
    $frontendDir = Join-Path $REPO_ROOT "frontend"
    if ((Test-Path (Join-Path $frontendDir "package.json")) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Info "Building frontend..."
        Push-Location $frontendDir
        try {
            npm install 2>&1 | Select-Object -Last 3 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                npm run build 2>&1 | Select-Object -Last 3 | Out-Null
                if (($LASTEXITCODE -eq 0) -and (Test-Path (Join-Path $frontendDir "dist"))) {
                    Write-Info "Deploying frontend to VM..."
                    Invoke-SSH "mkdir -p /opt/iora/build/dist" | Out-Null
                    Send-SCP -LocalPath (Join-Path $frontendDir "dist") -RemotePath "/opt/iora/build/" -Recurse | Out-Null
                    Write-Success "Frontend deployed"
                } else { Write-Warn "Frontend build failed (non-fatal)" }
            } else { Write-Warn "npm install failed (non-fatal)" }
        } finally { Pop-Location }
    } else {
        Write-Warn "npm not available - skipping frontend build."
    }
}

# -- Step 10: Verification ---------------------------------------------------
Write-Info "Verifying IORA OS services..."
$svcCount = (Invoke-SSH 'systemctl list-unit-files --type=service ''iora-*'' 2>/dev/null | grep -c ''^iora-'' || echo 0').ToString().Trim()
Write-Info "IORA services registered: $svcCount"

function Test-VmFile { param([string]$Label, [string]$Cmd)
    $r = Invoke-SSH ('{0} && echo OK' -f $Cmd)
    if ("$r" -match "OK") { Write-Success $Label } else { Write-Warn ("{0}: missing" -f $Label) }
}
Test-VmFile "nginx reverse proxy"   "nginx -t >/dev/null 2>&1"
Test-VmFile "SSL certificates"      "test -f /etc/iora/ssl/server.crt"
Test-VmFile "/etc/iora/os-dev-mode" "test -f /etc/iora/os-dev-mode"
Test-VmFile "Health monitor binary" "test -f /usr/lib/iora/iora-health-check"
Test-VmFile "Setup wizard binary"   "test -f /usr/lib/iora/iora-setup-wizard"
Test-VmFile "Centralized logging"   "test -d /var/log/iora"
Test-VmFile "Firewall script"       "test -f /usr/lib/iora/iora-firewall"

Write-Info "Checking iora-home health endpoint..."
$healthOk = $false
for ($i=0; $i -lt 12; $i++) {
    if (Test-VmHealth) { $healthOk = $true; break }
    Start-Sleep -Seconds 5
}
if ($healthOk) { Write-Success "iora-home OK on http://127.0.0.1:$VM_HOME" }
else { Write-Warn "iora-home not responding yet. Check: ssh -i $SSH_KEY -p $SshPort root@127.0.0.1 'journalctl -u iora-home -n 50'" }

# -- Step 10: Launch dev-watch TUI ------------------------------------------
if (-not $NoWatch) {
    $dashBin = Join-Path $REPO_ROOT "iora-os\backend\target\debug\iora-dev-watch.exe"
    if (Test-WatcherNeedsBuild $dashBin) {
        Write-Info "Building updated dev-watch TUI..."
        Push-Location (Join-Path $REPO_ROOT "iora-os\backend")
        try {
            cargo build -p iora-dev-watch 2>&1 | Select-Object -Last 5
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Failed to build dev-watch TUI. Run manually later."
            }
        } finally { Pop-Location }
    }
    if (Test-Path $dashBin) {
        Write-Info "Launching IORA Dev Watch TUI..."
        # See comment above (-Watcher branch): launch the exe DIRECTLY so the
        # TUI owns its console. Any shell wrapper (powershell -NoExit / cmd /c)
        # breaks raw mode + key handling and is fragile to quote escaping.
        $watcherArgs = @(
            '--vm-host', '127.0.0.1',
            '--vm-port', "$SshPort",
            '--ssh-key', "$SSH_KEY"
        )
        Start-Process -FilePath $dashBin -ArgumentList $watcherArgs | Out-Null
    }
}

# -- Step 11: Start background health monitor -------------------------------
$HEALTH_MONITOR_LOG = Join-Path $CACHE "health-monitor.log"
$HEALTH_MONITOR_PID = Join-Path $CACHE "health-monitor.pid"

if (Get-Command Start-HealthMonitor -ErrorAction SilentlyContinue) {
    Start-HealthMonitor -VMHost "127.0.0.1" -VMPort $SshPort -SSHKey $SSH_KEY `
        -LogFile $HEALTH_MONITOR_LOG -PIDFile $HEALTH_MONITOR_PID
}

# -- Banner -----------------------------------------------------------------
Write-Host ""
Write-Success "IORA Dev VM ready!"
Write-Host ""
$readyBanner = @"
  +====================================================================+
  |                    IORA Dev VM ready                                |
  +====================================================================+
  |  WEB                                                                |
  |    Dashboard (nginx) https://localhost                              |
  |    Dashboard direct  http://localhost:$VM_HOME                            |
  |    Dev Bridge        http://localhost:$VM_BRIDGE/dev/health               |
  |    Swagger API       http://localhost:$VM_HOME/api/docs                   |
  |    Global Config API http://localhost:$VM_HOME/api/settings               |
  |                                                                     |
  |  ACCESS                                                             |
  |    SSH               ssh -i $SSH_KEY -p $SshPort root@127.0.0.1
  |                                                                     |
  |  CO-BUDDY FEATURES                                                  |
  |    Auto-repair       Port conflicts, disk space, dependencies       |
  |    Health Monitor    Background monitoring (logs: health-monitor.log)|
  |    Smart Recovery    Auto-restart failed services                   |
  |                                                                     |
  |  LOGS (100% IORA OS compatible)                                     |
  |    All services      ssh root@127.0.0.1 -p $SshPort 'journalctl -u iora-* -f'
  |    Specific service  ssh root@127.0.0.1 -p $SshPort 'journalctl -u iora-home -f'
  |    Last 100 lines    ssh root@127.0.0.1 -p $SshPort './iora-dev-logs.sh'
  |    Follow all logs   ssh root@127.0.0.1 -p $SshPort './iora-dev-logs.sh -f'
  |                                                                     |
  |  GLOBAL CONFIG                                                      |
  |    Get setting       ssh root@127.0.0.1 -p $SshPort 'iora-get-config ha.url'
  |    Service env       /etc/iora/service.env (auto-loaded)           |
  |    Per-service env   /etc/iora/<service>.env (optional)            |
  |                                                                     |
  |  CONTROL                                                            |
  |    Status            .\dev-local.ps1 -Status                        |
  |    Stop VM           .\dev-local.ps1 -Stop                          |
  |    Reprovision       .\dev-local.ps1 -Reprovision                   |
  |    Full reset        .\dev-local.ps1 -Clean                         |
  |    Launch watcher    .\dev-local.ps1 -Watcher                       |
  |                                                                     |
  |  MODE                                                               |
  |    Run mode:         $Mode (source = cargo run / build = binaries)  |
  |    Sync watcher:     wsl bash dev-sync.sh --watch (~1s latency)     |
  |                                                                     |
  |  Logs                                                               |
  |    Setup log         $LOG_FILE
  |    QEMU stderr       $QEMU_STDERR
  |    Health monitor    $HEALTH_MONITOR_LOG
  +====================================================================+
"@
Write-Host $readyBanner -ForegroundColor Green

# Send desktop notification
if (Get-Command Send-Notification -ErrorAction SilentlyContinue) {
    Send-Notification -Title "IORA Dev VM Ready" -Message "Dashboard available at http://localhost:$VM_HOME" -Urgency "Normal"
}

try { Stop-Transcript | Out-Null } catch {}

if ($Foreground) {
    Write-Info "Foreground mode - Ctrl+C stops the VM."
    try {
        $qemuProc.WaitForExit()
    } finally {
        Stop-Vm
    }
} else {
    Write-Success "VM running detached. The script exits now; the VM keeps running."
    Write-Info "Use '.\dev-local.ps1 -Stop' to shut it down."
}
