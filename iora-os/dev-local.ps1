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
#   .\dev-local.ps1 -NoSync        Don't auto-launch continuous source sync
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
    [switch] $NoSync,
    [switch] $Watcher,
    [switch] $Foreground,
    [switch] $SkipWhpx,
    [switch] $Uefi,
    [switch] $Freeze,
    [switch] $Bridge,
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

# -- Version (Banner zeigt die laufende Version - erleichtert das Erkennen
#    veralteter Kopien; bei Fragen/Fixes immer hier hochzaehlen) ------------
$DEV_LOCAL_VERSION = "2.6.3"

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
    Write-Host "  -Clean         Drop cached VM disk + seed ISO (keep image + golden)"
    Write-Host "  -CleanAll      Also remove downloaded cloud image + golden snapshot"
    Write-Host "  -Status        Show whether VM is running + health check"
    Write-Host "  -Stop          Stop the running VM"
    Write-Host "  -Reboot        Stop VM + restart fresh"
    Write-Host "  -Rebuild       Stop VM, clean cache, start fresh provision (drops golden)"
    Write-Host "  -SSH           SSH directly into the VM"
    Write-Host "  -Log           Live cloud-init / system logs"
    Write-Host "  -Reprovision   Force re-running the in-VM setup"
    Write-Host "  -NoWatch       Don't auto-launch dev-watch TUI"
    Write-Host "  -NoSync        Don't auto-launch continuous source sync"
    Write-Host "  -Watcher        Launch dev-watch TUI in new terminal (VM must be running)"
    Write-Host "  -Foreground    Keep this window attached to QEMU"
    Write-Host "  -Uefi          Force UEFI (OVMF) firmware instead of SeaBIOS"
    Write-Host "  -Freeze        Bake current provisioned VM state into a golden"
    Write-Host "                 snapshot - resets (-Clean) become instant afterwards"
    Write-Host "  -Bridge        Give the VM its own LAN IP (TAP + network bridge,"
    Write-Host "                 like IORA OS production; needs admin once for setup)"
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
Write-Host "  IORA OS - Local Dev VM (Windows / QEMU)  v$DEV_LOCAL_VERSION" -ForegroundColor Cyan
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
        winget show --id SoftwareFreedomConservancy.QEMU --accept-source-agreements 2>&1 | Out-Null
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
$GOLDEN_DISK = Join-Path $CACHE "iora-dev-golden.qcow2"
$SSH_KEY    = Join-Path $CACHE "iora-dev-key"
$SEED_ISO   = Join-Path $CACHE "iora-dev-seed.iso"
$QEMU_PIDFILE = Join-Path $CACHE "qemu.pid"
$PROVISIONED_MARKER = Join-Path $CACHE ".provisioned"
$QEMU_STDERR = Join-Path $CACHE "qemu-stderr.log"

# -- VM addressing ------------------------------------------------------------
# Default: slirp user-net with hostfwd (VM reached via 127.0.0.1:<port>).
# Bridge mode (-Bridge): the VM gets its own LAN IP via TAP + network bridge;
# $VM_HOST is then set to that IP (discovered via the guest agent) and SSH/
# health checks talk to the VM directly on port 22.
$script:VM_HOST = "127.0.0.1"
$script:VM_SSH_PORT = $SshPort
$RUNTIME_STATE_PATH = Join-Path $CACHE "runtime-state.json"
$RUNTIME_STATE_MODULE = Join-Path $SCRIPT_DIR "dev-manager\RuntimeState.psm1"
if (Test-Path $RUNTIME_STATE_MODULE) {
    Import-Module $RUNTIME_STATE_MODULE -Force -ErrorAction SilentlyContinue
    Import-Module (Join-Path $SCRIPT_DIR "dev-manager\VmChannels.psm1") -Force -ErrorAction SilentlyContinue
    Import-Module (Join-Path $SCRIPT_DIR "dev-manager\Readiness.psm1") -Force -ErrorAction SilentlyContinue
    $script:RuntimeState = Read-IoraRuntimeState -Path $RUNTIME_STATE_PATH
    $script:RuntimeState = Clear-IoraStaleRuntimeState -State $script:RuntimeState
    if (Test-IoraProcess -State $script:RuntimeState) {
        $qmpValid = Test-IoraQmp -State $script:RuntimeState
        $qgaValid = Test-IoraQga -State $script:RuntimeState
        if (-not $qmpValid) { $script:RuntimeState.lifecycle = "Starting" }
        if ($qgaValid -and $script:RuntimeState.networkMode -eq "bridge") {
            $currentIp = Get-IoraGuestIp -State $script:RuntimeState
            if ($currentIp) { $script:RuntimeState.vmHost = $currentIp }
        }
        $connection = Get-IoraConnection -State $script:RuntimeState
        $script:VM_HOST = $connection.Host
        $script:VM_SSH_PORT = $connection.SshPort
        $script:QgaPort = [int]$script:RuntimeState.qgaPort
        $script:QmpPort = [int]$script:RuntimeState.qmpPort
        if ($script:RuntimeState.networkMode -eq "bridge") { $Bridge = $true }
    }
    Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
}

# -- Dev disk lifecycle ------------------------------------------------------
function Reset-VmDisk {
    # Recreate the dev overlay from the golden snapshot (if present) or the
    # base image. Golden = provisioned state: a reset is instant and needs no
    # re-provisioning; without golden the VM is re-provisioned automatically.
    $src = if (Test-Path $GOLDEN_DISK) { $GOLDEN_DISK } else { $IMG_CACHE }
    Remove-Item $VM_DISK -Force -ErrorAction SilentlyContinue
    & $QEMU_IMG create -f qcow2 -b $src -F qcow2 $VM_DISK 40G | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-WithError "qemu-img create failed (backing: $src)." }
    if ($src -eq $GOLDEN_DISK) {
        Write-Success "Dev disk reset to the golden snapshot (no re-provisioning needed)"
        Set-Content -Path $PROVISIONED_MARKER -Value (Get-Date -Format "o") -NoNewline
    } else {
        Write-Dim "Dev disk recreated from the base image (will be re-provisioned)"
    }
}

# -- Ports forwarded host -> VM (mirrors IORA OS systemd unit ports) --------
$VM_HOME   = 8126
$VM_BRIDGE = 8101
# Forwarded dev ports (start arguments - runtime hostfwd_add rules can be
# unreliable with QEMU slirp; rules in the command line always work). 5173
# is the Vite dev server, 5355 an optional extra forward.
$FWD_PORTS = @(80, 443, 3001, 5173, 5355, 5432, 8080, 8090, 8092, 8094, 8095, 8096, 8097, 8098, 8180, 8580, 8590)

# -- Helpers ----------------------------------------------------------------
function ConvertTo-WslPath { param([string]$WinPath)
    $p = $WinPath.Replace('\', '/')
    # PS 5.1: 2>$null does not reliably suppress native stderr. Merge and
    # drop the ErrorRecords so a wslpath warning cannot corrupt the path.
    $out = wsl wslpath -a "$p" 2>&1
    return ($out | Where-Object { $_ -is [string] } | Select-Object -Last 1)
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
    if ($script:RuntimeState) {
        $script:RuntimeState.pid = $null
        $script:RuntimeState.lifecycle = "Stopped"
        $script:RuntimeState.watcherStatus = "Stopped"
        $script:RuntimeState.syncStatus = "Stopped"
        Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
    }
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
    $output = & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST $Command 2>&1
    if ($LASTEXITCODE -eq 0) { return $output }
    if (Get-Command Invoke-QgaExec -ErrorAction SilentlyContinue) {
        return Invoke-QgaExec -Command $Command -TimeoutSec 120
    }
    return $output
}

function Invoke-SSHStdin {
    param([string] $Script)
    $tmp = New-TemporaryFile
    $stdout = New-TemporaryFile
    $stderr = New-TemporaryFile
    $normalizedScript = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
    [System.IO.File]::WriteAllText($tmp, $normalizedScript, [System.Text.Encoding]::ASCII)
    try {
        $sshArgs = @() + $SSH_OPTS + @("-i", $SSH_KEY, "-p", $VM_SSH_PORT, "root@$VM_HOST", "bash -s")
        $proc = Start-Process -FilePath $SSH_BIN -ArgumentList $sshArgs -RedirectStandardInput $tmp -RedirectStandardOutput $stdout -RedirectStandardError $stderr -NoNewWindow -Wait -PassThru
        $global:LASTEXITCODE = $proc.ExitCode
        if ($proc.ExitCode -eq 0) {
            Get-Content $stdout -Raw -ErrorAction SilentlyContinue
            Get-Content $stderr -Raw -ErrorAction SilentlyContinue
        } elseif (Get-Command Invoke-QgaExec -ErrorAction SilentlyContinue) {
            Invoke-QgaExec -Command $normalizedScript -TimeoutSec 300
        } else {
            Get-Content $stderr -Raw -ErrorAction SilentlyContinue
        }
    } finally {
        Remove-Item $tmp, $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

# -- QEMU Guest Agent channel (works WITHOUT IP/network) --------------------
# Primary control channel: JSON lines over the localhost TCP socket that
# QEMU exposes (virtio-serial -> qemu-guest-agent inside the VM).
function Invoke-QgaJson {
    param([string]$Json, [int]$TimeoutSec = 10)
    $port = 8109
    if ($script:QgaPort) { $port = $script:QgaPort }
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(3000)) { return $null }
        $client.EndConnect($iar)
        $stream = $client.GetStream()
        $payload = [System.Text.Encoding]::UTF8.GetBytes($Json + "`n")
        $stream.Write($payload, 0, $payload.Length)
        $stream.Flush()
        $stream.ReadTimeout = $TimeoutSec * 1000
        $sb = New-Object System.Text.StringBuilder
        $buf = New-Object byte[] 8192
        while ($true) {
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $n))
            if ($sb.ToString().Contains("`n")) { break }
        }
        return $sb.ToString().Trim()
    } catch {
        return $null
    } finally {
        if ($client) { $client.Close() }
    }
}

function Invoke-QgaExec {
    param([string]$Command, [int]$TimeoutSec = 60)
    $cmdJson = $Command | ConvertTo-Json
    $resp = Invoke-QgaJson ('{"execute":"guest-exec","arguments":{"path":"/bin/sh","arg":["-c",' + $cmdJson + '],"capture-output":true}}')
    if (-not $resp) { return $null }
    try { $execPid = ($resp | ConvertFrom-Json).return.pid } catch { return $null }
    if (-not $execPid) { return $null }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $st = Invoke-QgaJson ('{"execute":"guest-exec-status","arguments":{"pid":' + $execPid + '}}')
        if (-not $st) { continue }
        try { $r = $st | ConvertFrom-Json } catch { continue }
        if ($null -ne $r.return.exitcode) {
            if ($r.return.'out-data') {
                try { return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($r.return.'out-data')) }
                catch { return "" }
            }
            return ""
        }
    }
    return $null
}

function Send-SCP {
    param([string] $LocalPath, [string] $RemotePath, [switch] $Recurse)
    $scpArgs = @() + $SSH_OPTS + @("-i", $SSH_KEY, "-P", $VM_SSH_PORT)
    if ($Recurse) { $scpArgs += "-r" }
    $scpArgs += @($LocalPath, "root@${VM_HOST}:$RemotePath")
    & $SCP_BIN @scpArgs 2>&1
}

# -- Bridge mode: give the VM its own LAN IP (TAP driver + network bridge) ---
# The VM then behaves like IORA OS production: a normal device on the LAN
# with its own DHCP address (reachable from the PC and other devices).
# Requires admin once (TAP driver install + bridge creation); afterwards the
# bridge persists and every start is automatic.
function Initialize-BridgeNetwork {
    # 1) TAP-Windows6 driver present?
    $tap = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -like "TAP-Windows*" } | Select-Object -First 1
    if (-not $tap) {
        Write-Info "TAP-Windows driver missing - installing (admin required once)..."
        $tapInstaller = Join-Path $CACHE "tap-windows-9.24.7.exe"
        if (-not (Test-Path $tapInstaller)) {
            try {
                # WebClient: no PowerShell error records, so a failed download
                # cannot spam the transcript with TerminatingError lines.
                $wc = New-Object System.Net.WebClient
                $wc.DownloadFile("https://build.openvpn.net/downloads/releases/tap-windows-9.24.7.exe", $tapInstaller)
                if (-not (Test-Path $tapInstaller)) {
                    Stop-WithError "TAP driver download failed"
                }
            } catch {
                Stop-WithError "TAP driver download failed: $_"
            }
        }
        $p = Start-Process -FilePath $tapInstaller -ArgumentList "/S" -Wait -PassThru
        Start-Sleep 4
        $tap = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceDescription -like "TAP-Windows*" } | Select-Object -First 1
        if (-not $tap) {
            Stop-WithError "TAP adapter not present after install (needs admin). Run once as Administrator: $tapInstaller /S"
        }
    }
    Write-Success "TAP adapter: $($tap.Name)"
    $script:TapName = $tap.Name

    # 2) Network bridge exists? (netsh bridge list shows bridge GUIDs)
    $bridgeList = netsh bridge list 2>&1 | Out-String
    if ($bridgeList -match "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-") {
        Write-Success "Network bridge already exists"
        return
    }
    $lanName = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).InterfaceAlias
    if (-not $lanName) { Stop-WithError "No LAN adapter with a default route found - bridge mode needs a wired Ethernet connection." }
    Write-Dim "  Bridging: $lanName + $($tap.Name)"
    $adapterTable = netsh bridge show adapter 2>&1 | Out-String
    $lanId = $null; $tapId = $null
    foreach ($line in ($adapterTable -split "`r?`n")) {
        if ($line -match "^(\d+)\s+\{([0-9a-fA-F-]+)\}\s+(.+)$") {
            $id = $matches[1]; $name = $matches[3].Trim()
            if ($name -eq $lanName) { $lanId = $id }
            if ($name -eq $tap.Name) { $tapId = $id }
        }
    }
    if (-not $lanId -or -not $tapId) {
        Stop-WithError "Could not map adapters from 'netsh bridge show adapter' (LAN='$lanName', TAP='$($tap.Name)'). Create the bridge once as Administrator: Network Connections -> select both adapters -> Bridge, or run this script as Administrator."
    }
    Write-Info "Creating network bridge ($lanName + $($tap.Name))..."
    $out = netsh bridge create $lanId $tapId 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Stop-WithError "netsh bridge create failed (run once as Administrator): $out"
    }
    Start-Sleep 3
    Write-Success "Network bridge created - the VM will get its own LAN IP (DHCP)"
}

function Test-VmHealth {
    foreach ($p in @("http://${VM_HOST}:$VM_HOME/api/health", "http://${VM_HOST}:$VM_HOME/health")) {
        # .NET HttpWebRequest instead of Invoke-WebRequest: Windows PowerShell
        # 5.1 writes a "TerminatingError(Invoke-WebRequest)" line into the
        # transcript for every caught WebException - the 12x health loop would
        # spam dev-local.log on every failed probe. Raw .NET exceptions bypass
        # that pipeline and stay silent.
        try {
            $req = [System.Net.HttpWebRequest]::Create($p)
            $req.Timeout = 3000
            $resp = $req.GetResponse()
            $code = [int]$resp.StatusCode
            $resp.Close()
            if ($code -eq 200) { return $true }
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
    & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST
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
            # cmd /c merges stderr into stdout as plain text - PowerShell
            # 5.1 would otherwise render every cargo stderr line as a red
            # "cargo : ..." NativeCommandError record.
            & $env:ComSpec /d /c "cargo build -p iora-dev-watch 2>&1" | Select-Object -Last 5
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
        '--vm-host', "$VM_HOST",
        '--vm-port', "$VM_SSH_PORT",
        '--qga-port', "$($script:RuntimeState.qgaPort)",
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
            & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST "tail -f $cloudLog"
        } elseif ("$hasCloudMainLog" -match "YES") {
            Write-Info "Live cloud-init main log (Ctrl+C to stop)..."
            & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST "tail -f $cloudMainLog"
        } else {
            Write-Info "SSH ready. Following syslog (Ctrl+C to stop)..."
            & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST "tail -f /var/log/syslog"
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
    # Rebuild means a truly fresh provision: the golden snapshot is dropped too
    Remove-Item $GOLDEN_DISK -Force -ErrorAction SilentlyContinue
    & ssh-keygen -R "[127.0.0.1]:$SshPort" 2>&1 | Out-Null
    & ssh-keygen -R "[localhost]:$SshPort" 2>&1 | Out-Null
    Write-Info "Starting fresh provision..."
    # Fall through to normal start
}

# -- -Freeze: bake the current provisioned VM state into a golden snapshot ---
if ($Freeze) {
    $provisioned = $false
    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if ($p) {
        $check = Invoke-SSH 'test -f /etc/iora/dev-vm-provisioned && echo PROV_OK'
        if ("$check" -match "PROV_OK") { $provisioned = $true }
    }
    if (-not $provisioned) {
        Stop-WithError "VM is not provisioned yet - start it once and let provisioning finish, then re-run with -Freeze."
    }
    Write-Info "Freezing current VM state as golden snapshot..."
    Stop-Vm
    if (-not (Test-Path $VM_DISK)) { Stop-WithError "No VM disk found to freeze." }
    Write-Info "Converting overlay to golden (compressed, takes a few minutes)..."
    & $QEMU_IMG convert -O qcow2 -c $VM_DISK "$GOLDEN_DISK.tmp" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Remove-Item "$GOLDEN_DISK.tmp" -Force -ErrorAction SilentlyContinue
        Stop-WithError "qemu-img convert failed (is there enough free disk space?)."
    }
    Remove-Item $GOLDEN_DISK -Force -ErrorAction SilentlyContinue
    Move-Item "$GOLDEN_DISK.tmp" $GOLDEN_DISK -Force
    Set-Content -Path $PROVISIONED_MARKER -Value (Get-Date -Format "o") -NoNewline
    Reset-VmDisk
    Write-Success "Golden snapshot saved: $GOLDEN_DISK"
    Write-Info "Resets are now instant: .\dev-local.ps1 -Clean && .\dev-local.ps1"
    exit 0
}

if ($Status) {
    $p = Get-QemuPid
    if (-not $p) { $p = Get-QemuProcess | Select-Object -First 1 }
    if (-not $p) {
        Write-Warn "VM is not running"
        exit 1
    }
    Write-Success "VM running (PID $($p.Id))"
    Write-Info "Network: $($script:RuntimeState.networkMode); VM=$VM_HOST; SSH=$VM_SSH_PORT; QGA=$($script:RuntimeState.qgaPort); QMP=$($script:RuntimeState.qmpPort)"
    $connection = Get-IoraConnection -State $script:RuntimeState
    $report = Invoke-IoraReadiness -State $script:RuntimeState -Connection $connection
    Write-Info "Lifecycle: $($report.Lifecycle)"
    if ($report.Checks.Qga) { Write-Success "Guest Agent responsive" } else { Write-Warn "Guest Agent unavailable" }
    if ($report.Checks.InternalHome) { Write-Success "iora-home internally healthy" } else { Write-Warn "iora-home internally unhealthy" }
    if ($report.Checks.ExternalHome) { Write-Success "iora-home reachable from host" } else { Write-Warn $report.HomeDiagnosis.Summary }
    $script:RuntimeState.lifecycle = $report.Lifecycle
    Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
    exit $(if ($report.Lifecycle -eq "Ready") { 0 } else { 1 })
}

# -- Boot firmware selection (UEFI/OVMF vs SeaBIOS/BIOS) ---------------------
# The Debian cloud image is BIOS-only (its EFI System Partition is empty, no
# \EFI\BOOT\BOOTX64.EFI): under OVMF it falls into the "UEFI Interactive
# Shell" and never boots. SeaBIOS boots it reliably (same configuration as the
# proven dev-local.sh TCG path). We try UEFI first, self-heal to SeaBIOS when
# the shell trap is detected (see wait loop below) and remember the choice in
# a marker file so later runs boot directly. ARM64 has no SeaBIOS and always
# uses UEFI. Use -Uefi to force UEFI (e.g. for EFI-capable IORA OS images).
$BOOT_FIRMWARE_MARKER = Join-Path $CACHE "boot-firmware"
$useUefi = $false
if ($HOST_ARCH -eq "ARM64") {
    # ARM64: edk2 is the only option (no SeaBIOS for aarch64)
    $useUefi = $true
} elseif ($SkipWhpx) {
    # The TCG fallback always boots via SeaBIOS (OVMF+TCG is unstable on
    # some Windows QEMU builds - see Step 4)
    if ($Uefi) { Write-Warn "-Uefi ignored: the TCG fallback (-SkipWhpx) always boots via SeaBIOS." }
} elseif ($Uefi) {
    $useUefi = $true
} elseif ((Test-Path $BOOT_FIRMWARE_MARKER) -and ((Get-Content $BOOT_FIRMWARE_MARKER -Raw -ErrorAction SilentlyContinue).Trim() -eq "seabios")) {
    Write-Dim "Boot firmware: SeaBIOS (remembered from a previous auto-heal; use -Uefi to force UEFI)"
    $useUefi = $false
} else {
    $useUefi = $true
}

# -- UEFI firmware (only needed when booting UEFI) ---------------------------
$FW = $null
if ($useUefi) {
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
    Write-Success "Boot firmware: UEFI ($FW)"
} else {
    Write-Success "Boot firmware: SeaBIOS (BIOS)"
}

# -- -Clean / -CleanAll -----------------------------------------------------
if ($Clean -or $CleanAll) {
    Write-Info "Cleaning cache..."
    Stop-Vm
    # Keep the base image and the golden snapshot (resets stay instant)
    Get-ChildItem -Path $CACHE -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -notlike "debian-12-cloud-*.qcow2" -and $_.Name -ne "iora-dev-golden.qcow2"
    } | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item -Path (Join-Path $CACHE "seed") -Recurse -Force -ErrorAction SilentlyContinue
    if ($CleanAll) {
        Remove-Item -Path $IMG_CACHE -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $GOLDEN_DISK -Force -ErrorAction SilentlyContinue
    }
    & ssh-keygen -R "[127.0.0.1]:$SshPort" 2>&1 | Out-Null
    & ssh-keygen -R "[localhost]:$SshPort" 2>&1 | Out-Null
    Write-Success "Done. Re-run without -Clean to provision."
    exit 0
}

# -- Step 1: Download cloud image -------------------------------------------
if (-not (Test-Path $IMG_CACHE)) {
    Write-Info "Downloading Debian cloud image (~400MB, one-time)..."
    $ProgressPreference = 'SilentlyContinue'
    try {
        # .NET HttpWebRequest: Invoke-WebRequest errors would be written into
        # the dev-local transcript as "TerminatingError(...)" even when caught
        # (PS 5.1 quirk) - raw .NET exceptions stay silent.
        $req = [System.Net.HttpWebRequest]::Create($IMG_URL)
        $req.Timeout = 900000
        $req.UserAgent = "iora-dev-local/2.6"
        $dlResp = $req.GetResponse()
        try {
            $inStream = $dlResp.GetResponseStream()
            $outStream = [System.IO.File]::Create("$IMG_CACHE.tmp")
            try { $inStream.CopyTo($outStream) } finally { $outStream.Close() }
        } finally { $dlResp.Close() }
    } catch {
        Remove-Item "$IMG_CACHE.tmp" -Force -ErrorAction SilentlyContinue
        $ProgressPreference = 'Continue'
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
    if (Test-Path $GOLDEN_DISK) {
        Write-Info "Creating VM disk overlay (40G) on the golden snapshot..."
    } else {
        Write-Info "Creating VM disk overlay (40G)..."
    }
    Reset-VmDisk
}

# -- Step 3: SSH key + cloud-init seed ISO ----------------------------------
if (-not (Test-Path $SSH_KEY)) {
    Write-Info "Generating SSH key for VM..."
    # Prefer the Windows OpenSSH ssh-keygen (no WSL startup needed); the
    # piped newline guards against an interactive passphrase prompt.
    $keygenOk = $false
    $winKeygen = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
    if ($winKeygen) {
        "`n" | & $winKeygen.Source -t ed25519 -f $SSH_KEY -N "" -C "iora-dev-vm" 2>&1 | Out-Null
        $keygenOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $keygenOk) {
        # Fallback: generate inside WSL
        $sshKeyWsl = ConvertTo-WslPath $SSH_KEY
        wsl bash -c "ssh-keygen -t ed25519 -f '$sshKeyWsl' -N '' -C 'iora-dev-vm'" 2>&1 | Out-Null
        $keygenOk = ($LASTEXITCODE -eq 0)
    }
    if (-not $keygenOk) { Stop-WithError "ssh-keygen failed." }
    icacls $SSH_KEY /inheritance:r /grant:r "${env:USERNAME}:R" 2>&1 | Out-Null
    icacls "$SSH_KEY.pub" /inheritance:r /grant:r "${env:USERNAME}:R" 2>&1 | Out-Null
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

# Netzwerk IMMER konfigurieren (QEMU user-net = 10.0.2.0/24): DHCP plus
# statische Fallback-IP, damit die VM garantiert eine IP hat, selbst wenn
# der Slirp-DHCP-Server nicht antwortet (bekannt unter WHPX + e1000).
network:
  version: 2
  ethernets:
    en-any:
      match:
        name: "en*"
      dhcp4: true
      dhcp6: false
      addresses: [10.0.2.15/24]
      gateway4: 10.0.2.2
      nameservers:
        addresses: [10.0.2.3, 1.1.1.1]
    eth-any:
      match:
        name: "eth*"
      dhcp4: true
      dhcp6: false
      addresses: [10.0.2.16/24]
      gateway4: 10.0.2.2
      nameservers:
        addresses: [10.0.2.3, 1.1.1.1]

packages:
  - qemu-guest-agent

package_update: false
package_upgrade: false

runcmd:
  - mkdir -p /etc/iora && touch /etc/iora/ssh-ready
  - systemctl enable --now qemu-guest-agent 2>/dev/null || true
  - 'systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true'

final_message: "IORA Dev VM ready."
"@
    Set-Content -Path (Join-Path $seedDir "user-data") -Value $userData -NoNewline -Encoding ASCII
    Set-Content -Path (Join-Path $seedDir "meta-data") -Value "instance-id: iora-dev-vm`nlocal-hostname: iora-dev`n" -NoNewline -Encoding ASCII

    $seedDirWsl = ConvertTo-WslPath $seedDir
    $seedIsoWsl = ConvertTo-WslPath $SEED_ISO

    # Robust WSL execution: wsl.exe MANGLES inline `bash -c` scripts that
    # contain quotes/newlines, so the script is written to a file first and
    # run via `wsl bash <file>`. The script:
    #   - prefers xorriso (genisoimage was REMOVED from Ubuntu 24.04+),
    #   - installs WITHOUT apt-get update first (fast path; update only when
    #     the package is unknown),
    #   - uses `sudo -n` (fails fast instead of hanging on a password prompt)
    #     and skips sudo entirely when running as root.
    $seedBash = @'
#!/usr/bin/env bash
SEED_DIR="__SEED_DIR__"
SEED_ISO="__SEED_ISO__"

TOOL=""
for t in genisoimage xorriso mkisofs; do
    command -v "$t" >/dev/null 2>&1 && { TOOL="$t"; break; }
done

if [ -z "$TOOL" ]; then
    echo "[*] No ISO tool found - installing (xorriso preferred)..."
    SUDO=""
    if [ "$(id -u)" != "0" ]; then
        if command -v sudo >/dev/null 2>&1; then SUDO="sudo -n"; else SUDO=""; fi
    fi
    if ! $SUDO apt-get install -y -qq xorriso >/dev/null 2>&1; then
        echo "[*] xorriso unavailable - trying genisoimage..."
        if ! $SUDO apt-get install -y -qq genisoimage >/dev/null 2>&1; then
            echo "[*] Package lists stale? Running apt-get update..."
            $SUDO apt-get update -qq >/dev/null 2>&1
            $SUDO apt-get install -y -qq xorriso >/dev/null 2>&1 || \
                $SUDO apt-get install -y -qq genisoimage >/dev/null 2>&1
        fi
    fi
    for t in xorriso genisoimage mkisofs; do
        if command -v "$t" >/dev/null 2>&1; then TOOL="$t"; break; fi
    done
fi

[ -n "$TOOL" ] || { echo "[X] No ISO tool available. Manual: wsl sudo apt-get install xorriso"; exit 1; }
echo "[*] Using $TOOL"
if [ "$TOOL" = "xorriso" ]; then
    xorriso -as mkisofs -output "$SEED_ISO" -volid cidata -joliet -rock "$SEED_DIR" || { echo "[X] xorriso failed"; exit 1; }
else
    "$TOOL" -output "$SEED_ISO" -volid cidata -joliet -rock "$SEED_DIR" || { echo "[X] $TOOL failed"; exit 1; }
fi
echo "[+] ISO created: $SEED_ISO"
'@
    $seedBash = $seedBash.Replace('__SEED_DIR__', $seedDirWsl).Replace('__SEED_ISO__', $seedIsoWsl)
    # The here-string inherits CRLF line endings from this .ps1 file, which
    # breaks bash in WSL ("$'\r': command not found"). Normalize to LF.
    $seedBash = (($seedBash -replace "`r`n", "`n") -replace "`r", "`n")
    $seedScript = Join-Path $CACHE "seed-create.sh"
    Set-Content -Path $seedScript -Value $seedBash -NoNewline -Encoding ASCII
    $seedScriptWsl = ConvertTo-WslPath $seedScript

    $isoOut = wsl -u root bash $seedScriptWsl 2>&1
    if ($LASTEXITCODE -ne 0) {
        # Fallback: default user (the script uses sudo -n internally)
        Write-Dim "  wsl -u root failed - retrying as default user..."
        $isoOut = wsl bash $seedScriptWsl 2>&1
    }
    $created = ($LASTEXITCODE -eq 0) -and (Test-Path $SEED_ISO) -and ((Get-Item $SEED_ISO -ErrorAction SilentlyContinue).Length -gt 0)
    if (-not $created) {
        $isoOut | Select-Object -Last 15 | ForEach-Object { Write-Dim "  $_" }
        Remove-Item -Recurse -Force $seedDir -ErrorAction SilentlyContinue
        Remove-Item $seedScript -Force -ErrorAction SilentlyContinue
        Stop-WithError "Failed to create seed ISO (see output above). Manual: wsl sudo apt-get install xorriso"
    }
    Remove-Item -Recurse -Force $seedDir -ErrorAction SilentlyContinue
    Remove-Item $seedScript -Force -ErrorAction SilentlyContinue
    Write-Success "Seed ISO created: $SEED_ISO"
}

if (-not (Test-Path $SEED_ISO)) { New-SeedIso }

# -- Step 4: Start QEMU (only if not already running) -----------------------
& ssh-keygen -R "[127.0.0.1]:$SshPort" 2>&1 | Out-Null
& ssh-keygen -R "[localhost]:$SshPort" 2>&1 | Out-Null

# Pre-flight checks: disk space and dependencies
if (Get-Command Test-DiskSpace -ErrorAction SilentlyContinue) {
    if (-not (Test-DiskSpace -Path $CACHE -MinimumGB 5)) {
        Write-Dim "Attempting automatic cache cleanup..."
        Invoke-DiskCleanup -CacheDir $CACHE
    }
}

$existingProc = Get-QemuPid
$skippedPorts = @()
if ($existingProc) {
    Write-Success "QEMU already running (PID $($existingProc.Id)) - attaching to existing VM."
    $qemuProc = $existingProc
    if ($script:RuntimeState -and $script:RuntimeState.pid -ne $existingProc.Id) {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($existingProc.Id)" -ErrorAction SilentlyContinue).CommandLine
        $script:RuntimeState.pid = $existingProc.Id
        $script:RuntimeState.lifecycle = "Starting"
        if ($commandLine -match 'id=qga0,host=127\.0\.0\.1,port=(\d+)') { $script:RuntimeState.qgaPort = [int]$Matches[1] }
        if ($commandLine -match 'tcp:127\.0\.0\.1:(\d+),server=on,wait=off') { $script:RuntimeState.qmpPort = [int]$Matches[1] }
        if ($commandLine -match 'netdev\s+tap|tap,id=n0') {
            $script:RuntimeState.networkMode = "bridge"; $script:RuntimeState.sshPort = 22
        } else {
            $script:RuntimeState.networkMode = "slirp"; $script:RuntimeState.vmHost = "127.0.0.1"; $script:RuntimeState.sshPort = $SshPort
        }
        Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
        $script:QgaPort = [int]$script:RuntimeState.qgaPort
        $script:QmpPort = [int]$script:RuntimeState.qmpPort
        if ((Test-IoraQga -State $script:RuntimeState) -and $script:RuntimeState.networkMode -eq "bridge") {
            $discoveredIp = Get-IoraGuestIp -State $script:RuntimeState
            if ($discoveredIp) { $script:RuntimeState.vmHost = $discoveredIp; $script:VM_HOST = $discoveredIp; $script:VM_SSH_PORT = 22 }
        }
    }
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

        # Bridge mode: TAP driver + network bridge (once), then the VM gets
        # its own LAN IP - no hostfwd/port checks needed.
        if ($Bridge) {
            Initialize-BridgeNetwork
        }

        # -- Port availability: ANY busy forward port kills QEMU's user-net --
        # ("Could not set up host forwarding rule ..."). Check every port and
        # skip busy ones with a warning instead of crashing.
        function Test-PortListening {
            param([int]$Port)
            # 1) NetTCPConnection (may miss listeners on some systems - best effort)
            if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
                if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { return $true }
            }
            # 2) netstat (always available, catches everything)
            if (netstat -ano 2>&1 | Select-String -Pattern "LISTENING" | Select-String -Pattern "(?::|\.)${Port}(?:\s|$)") { return $true }
            # 3) Definitive: try to BIND the port ourselves - exactly what QEMU
            #    will do. If the bind fails, QEMU would crash on this port too.
            try {
                $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
                $l.Start()
                $l.Stop()
                return $false
            } catch {
                return $true
            }
        }
        $script:skippedPorts = @()
        function Add-PortIfFree {
            param([int]$Port, [string]$GuestPort)
            if (Test-PortListening -Port $Port) {
                Write-Warn "Port $Port is in use on the host - not forwarding it (the VM service stays reachable inside the VM)."
                $script:skippedPorts += $Port
            } else {
                $script:forwardRules += ",hostfwd=tcp::${Port}-:${GuestPort}"
            }
        }

        # Build the netdev hostfwd string (only free ports); bridge mode
        # needs no forwarding - the VM is reachable directly via its LAN IP.
        if (-not $Bridge) {
            $script:forwardRules = ",hostfwd=tcp::${SshPort}-:22"
            Add-PortIfFree -Port $VM_HOME -GuestPort 8126
            Add-PortIfFree -Port $VM_BRIDGE -GuestPort 8101
            foreach ($p in $FWD_PORTS) { Add-PortIfFree -Port $p -GuestPort $p }
            if ($script:skippedPorts.Count -gt 0) {
                Write-Warn "Skipped forwarded ports: $($script:skippedPorts -join ', ') (busy on host - free them and re-run, or use an SSH tunnel)"
            }
        }
        $fwd = "user,id=n0" + $script:forwardRules

        # Guest-agent control port (localhost TCP on Windows; UNIX socket on
        # POSIX). Auto-pick a free port so a busy 8109 cannot kill QEMU.
        $QgaPort = 8109
        while ((Test-PortListening -Port $QgaPort) -and $QgaPort -lt 8130) { $QgaPort++ }

        # QMP (QEMU Machine Protocol) port - hypervisor-level control like
        # Proxmox: status, pause/resume, powerdown, screenshots, sendkey,
        # balloon. Auto-pick a free port as well.
        $QmpPort = 8130
        while ((Test-PortListening -Port $QmpPort) -and $QmpPort -lt 8150) { $QmpPort++ }

        # QEMU argument builder - reused verbatim by the UEFI-shell
        # self-heal (reboots the VM with SeaBIOS without duplicating the
        # whole argument list).
        $netArgs = if ($Bridge) {
            @("-netdev", "tap,id=n0,ifname=$script:TapName", "-device", "virtio-net-pci,netdev=n0")
        } else {
            @("-netdev", $fwd, "-device", "virtio-net-pci,netdev=n0")
        }

        function Build-QemuArgs {
            param([string] $Firmware)  # "uefi" | "seabios"
            $fwDrv = @()
            if ($Firmware -eq "uefi") {
                if ($fwIsFlash) {
                    $fwDrv = @("-drive", "if=pflash,format=raw,readonly=on,file=$FW")
                    if (Test-Path $FW_VARS_CACHED) {
                        $fwDrv += @("-drive", "if=pflash,format=raw,file=$FW_VARS_CACHED")
                    }
                } else {
                    $fwDrv = @("-bios", $FW)
                }
            }
            $a = @(
                "-name", "IORA-Dev",
                "-m", $VM_RAM,
                "-smp", $VM_CPUS
            ) + $fwDrv + @(
                # bootindex makes OVMF put the disk first even when the NVRAM
                # BootOrder is empty/polluted (UEFI shell trap); SeaBIOS
                # honours it as well. bootindex is a device property, so the
                # drives use if=none + explicit -device pairs.
                "-drive", "file=$VM_DISK,format=qcow2,if=none,id=iora-disk",
                "-device", "virtio-blk-pci,drive=iora-disk,bootindex=1",
                "-drive", "file=$SEED_ISO,format=raw,media=cdrom,if=none,id=iora-seed",
                "-device", "ide-cd,drive=iora-seed,bootindex=2",
                # Bridge mode: TAP adapter on the LAN bridge (own DHCP IP like
                # IORA OS production); otherwise slirp user-net + hostfwd.
                $netArgs[0], $netArgs[1],
                # virtio NIC (proven config; e1000 had DHCP issues under WHPX)
                $netArgs[2], $netArgs[3],
                # Netzwerkunabhaengiger Host<->VM-Kanal (qemu-guest-agent)
                "-device", "virtio-serial-pci",
                "-chardev", "socket,id=qga0,host=127.0.0.1,port=$QgaPort,server=on,wait=off",
                "-device", "virtserialport,chardev=qga0,id=qga0,name=org.qemu.guest_agent.0",
                # QMP: hypervisor control channel (status, pause, screenshot, ...)
                "-qmp", "tcp:127.0.0.1:$QmpPort,server=on,wait=off",
                # RAM ballooning (Proxmox-style memory control)
                "-device", "virtio-balloon-pci",
                "-device", "virtio-gpu",
                "-machine", "${VM_MACHINE},accel=whpx",
                "-serial", "file:$($CACHE)\qemu-serial.log",
                "-display", "gtk,show-cursor=on"
            )
            $a += @("-boot", "order=d,menu=off")
            return $a
        }

        $qemuArgs = Build-QemuArgs -Firmware $(if ($useUefi) { "uefi" } else { "seabios" })

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
            if ($script:RuntimeState) {
                $script:RuntimeState.pid = $proc.Id
                $script:RuntimeState.lifecycle = "Starting"
                $script:RuntimeState.networkMode = $(if ($Bridge) { "bridge" } else { "slirp" })
                $script:RuntimeState.vmHost = $(if ($Bridge) { $null } else { "127.0.0.1" })
                $script:RuntimeState.sshPort = $(if ($Bridge) { 22 } else { $SshPort })
                $script:RuntimeState.homePort = 8126
                $script:RuntimeState.forwardedPorts = if ($Bridge) { @() } else {
                    $ports = @([pscustomobject]@{ host = $SshPort; guest = 22 })
                    foreach ($port in @($VM_HOME, $VM_BRIDGE) + $FWD_PORTS) {
                        if ($skippedPorts -notcontains $port) { $ports += [pscustomobject]@{ host = $port; guest = $port } }
                    }
                    $ports
                }
                $script:RuntimeState.qgaPort = $QgaPort
                $script:RuntimeState.qmpPort = $QmpPort
                $script:RuntimeState.firmware = $(if ($useUefi) { "uefi" } else { "seabios" })
                $script:RuntimeState.acceleration = $Accel
                $script:RuntimeState.vmDisk = $VM_DISK
                $script:RuntimeState.goldenSnapshot = $GOLDEN_DISK
                $script:RuntimeState.startedAt = (Get-Date).ToUniversalTime().ToString("o")
                Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
            }
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
                $stderrText = ""
                if (Test-Path $QEMU_STDERR) { $stderrText = (Get-Content $QEMU_STDERR -Raw -ErrorAction SilentlyContinue) }
                Write-Warn "WHPX failed; falling back to TCG."
                Write-Dim "  Last 10 lines of ${QEMU_STDERR}:"
                (($stderrText -split "`r?`n") | Select-Object -Last 10) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
                if (-not $qemuProc.HasExited) { Microsoft.PowerShell.Management\Stop-Process -Id $qemuProc.Id -Force -ErrorAction SilentlyContinue }
                # Distinguish a QEMU COMMAND-LINE error (a bug in the QEMU
                # arguments or an incompatible QEMU version - the provisioned
                # disk must NOT be touched) from a real WHPX/acceleration
                # failure (fall back to TCG and recreate the overlay, since a
                # crashed WHPX can corrupt it). Errors that mention WHPX are
                # always treated as acceleration failures.
                $argError = $stderrText -notmatch 'whpx|WHPX|hypervisor' -and $stderrText -match 'exe: -[a-zA-Z]|does not support the option|invalid option|unrecognized'
                if ($argError) {
                    if ($stderrText -match "host forwarding rule 'tcp::(\d+)-") {
                        Write-Warn "QEMU rejected host forwarding for port $($Matches[1]); continuing to TCG without modifying the VM disk. Free the port or use -Bridge if you need that forwarding."
                    } else {
                        Stop-WithError "QEMU rejected the command line (configuration error, see stderr above). The VM disk was NOT modified. Fix the QEMU arguments (or update QEMU), then re-run; use -SkipWhpx to boot via TCG/SeaBIOS in the meantime."
                    }
                }
                # Real WHPX failure: WHPX can corrupt the overlay; recreate it
                # (from the golden snapshot when one exists - instant, no
                # re-provisioning)
                Write-Warn "Overlay recreated (WHPX failure) - using the golden snapshot if available."
                Reset-VmDisk
                $useWhpx = $false
            }
        }

        if (-not $useWhpx) {
            $tcgRam  = [Math]::Max(4, [Math]::Min([int]($VM_RAM -replace 'G',''), 8))
            $tcgCpus = [Math]::Max(2, [Math]::Min($VM_CPUS, 8))
            # TCG fallback WITHOUT OVMF pflash: the proven dev-local.sh
            # configuration boots the Debian cloud image with the default
            # SeaBIOS - OVMF+TCG crashes on some Windows QEMU builds.
            $tcgArgs = @(
                "-name", "IORA-Dev",
                "-m", "${tcgRam}G",
                "-smp", $tcgCpus,
                "-machine", "${VM_MACHINE},accel=tcg",
                "-drive", "file=$VM_DISK,format=qcow2,if=virtio",
                "-drive", "file=$SEED_ISO,format=raw,media=cdrom",
                "-boot", "order=d,menu=off",
                "-netdev", $fwd,
                "-device", "virtio-net-pci,netdev=n0",
                # Netzwerkunabhaengiger Host<->VM-Kanal (qemu-guest-agent)
                "-device", "virtio-serial-pci",
                "-chardev", "socket,id=qga0,host=127.0.0.1,port=$QgaPort,server=on,wait=off",
                "-device", "virtserialport,chardev=qga0,id=qga0,name=org.qemu.guest_agent.0",
                # QMP: hypervisor control channel (status, pause, screenshot, ...)
                "-qmp", "tcp:127.0.0.1:$QmpPort,server=on,wait=off",
                # RAM ballooning (Proxmox-style memory control)
                "-device", "virtio-balloon-pci",
                "-serial", "file:$($CACHE)\qemu-serial.log",
                "-display", "none",
                "-monitor", "none"
            )
            $qemuProc = Start-Qemu -QemuArgs $tcgArgs -Accel "TCG"
            if (-not (Test-Alive -Proc $qemuProc -WaitSec 20)) {
                Write-Err "QEMU/TCG also crashed. Last 20 lines of ${QEMU_STDERR}:"
                if (Test-Path $QEMU_STDERR) {
                    Get-Content $QEMU_STDERR -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
                }
                Stop-WithError "QEMU crashed with both WHPX and TCG. Check the log above; common fixes: enable VT-x/AMD-V in BIOS, or update QEMU."
            }
        }
    }
}

# -- Live serial console (separate window) ------------------------------------
$serialLog = Join-Path $CACHE "qemu-serial.log"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'IORA Dev VM - Serial Console (live)' -ForegroundColor Cyan; Get-Content -Wait -Tail 0 '$serialLog'" -WindowStyle Minimized | Out-Null

# -- Bridge mode: discover the VM's LAN IP via the guest agent ---------------
# (QGA works over virtio-serial, independent of the network; the agent is
# ensured by the dbInit step on every run.)
if ($Bridge) {
    Write-Info "Waiting for the VM's LAN IP (guest agent)..."
    $vmIp = $null
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline -and -not $vmIp) {
        $qgaIp = Invoke-QgaExec -Command 'ip -4 route get 1.1.1.1 2>/dev/null | awk "{print \$7; exit}"' -TimeoutSec 5
        if ($qgaIp -match "\d+\.\d+\.\d+\.\d+") { $vmIp = $matches[0] }
        if (-not $vmIp) { Start-Sleep -Seconds 5 }
    }
    if (-not $vmIp) {
        Stop-WithError "Could not determine the VM's LAN IP (guest agent not responding). Check the network bridge and run again."
    }
    $script:VM_HOST = $vmIp
    $script:VM_SSH_PORT = 22
    if ($script:RuntimeState) {
        $script:RuntimeState.vmHost = $vmIp
        $script:RuntimeState.sshPort = 22
        $script:RuntimeState.networkMode = "bridge"
        $script:RuntimeState.lifecycle = "Waiting for dependencies"
        Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
    }
    Write-Success "VM LAN IP: $vmIp (SSH via port 22, services via http://${vmIp}:8126)"
}

# -- Step 5: Wait for cloud-init to finish ----------------------------------
Write-Info "Waiting for cloud-init to finish (first boot may take 3-10 min)..."
$waited = 0
$ready = $false
$timeout = 900
$lastDiag = 0
$lastNetworkActivity = 0

# -- Self-healing: UEFI shell trap detection ---------------------------------
# The Debian cloud image has an EMPTY EFI System Partition: when OVMF finds
# no bootable loader it falls back to the "UEFI Interactive Shell" and the
# VM never boots. We detect that state in the serial log (QEMU truncates the
# log on every start, so position tracking resets automatically), restart the
# VM with SeaBIOS (which boots the image reliably) and remember the choice in
# $BOOT_FIRMWARE_MARKER so future runs boot directly. Only runs when this
# script started QEMU itself (Build-QemuArgs exists) - attached VMs are left
# untouched.
$healDone = $false
$script:serialPos = 0
function Read-SerialNew {
    if (-not (Test-Path $serialLog)) { return "" }
    try {
        $fs = [System.IO.File]::Open($serialLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            if ($fs.Length -lt $script:serialPos) { $script:serialPos = 0 }  # file was (re)created
            $fs.Position = $script:serialPos
            $ms = New-Object System.IO.MemoryStream
            $buf = New-Object byte[] 65536
            while (($n = $fs.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n) }
            $script:serialPos = $fs.Position
            return [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
        } finally { $fs.Close() }
    } catch {
        return ""
    }
}

while ($waited -lt $timeout) {
    if ($qemuProc.HasExited) {
        Stop-WithError "QEMU exited (code $($qemuProc.ExitCode)). See $QEMU_STDERR"
    }

    # UEFI shell trap -> restart with SeaBIOS (once per run)
    if ($useUefi -and -not $healDone -and (Get-Command Build-QemuArgs -ErrorAction SilentlyContinue)) {
        $newSerial = Read-SerialNew
        if ($newSerial -match "UEFI Interactive Shell|Shell>") {
            Write-Warn "VM landed in the UEFI Interactive Shell (cloud image has no UEFI bootloader)."
            Write-Warn "Auto-healing: restarting the VM with SeaBIOS..."
            try { Microsoft.PowerShell.Management\Stop-Process -Id $qemuProc.Id -Force -ErrorAction SilentlyContinue } catch { }
            Set-Content -Path $BOOT_FIRMWARE_MARKER -Value "seabios" -NoNewline -Encoding ASCII
            $qemuProc = Start-Qemu -QemuArgs (Build-QemuArgs -Firmware "seabios") -Accel "WHPX (SeaBIOS)"
            if (-not (Test-Alive -Proc $qemuProc -WaitSec 8)) {
                Write-Warn "WHPX restart failed during auto-heal - falling back to TCG/SeaBIOS."
                $qemuProc = Start-Qemu -QemuArgs $tcgArgs -Accel "TCG"
                if (-not (Test-Alive -Proc $qemuProc -WaitSec 20)) {
                    Stop-WithError "QEMU crashed during auto-heal (WHPX and TCG). See $QEMU_STDERR"
                }
            }
            $healDone = $true
            $script:serialPos = 0
            $waited = 0
            $lastDiag = 0
            Write-Success "Auto-healed: VM now boots via SeaBIOS. Waiting for cloud-init..."
            continue
        }
    }

    # Primaerer Kanal: QEMU-Guest-Agent (funktioniert OHNE IP); SSH als Alternative
    $bootReady = $false
    $qgaOut = Invoke-QgaExec -Command 'if test -f /var/lib/cloud/instance/boot-finished; then echo READY; else awk ''{rx += $1} END {print "NET_RX=" rx}'' /sys/class/net/*/statistics/rx_bytes; awk ''{tx += $1} END {print "NET_TX=" tx}'' /sys/class/net/*/statistics/tx_bytes; fi' -TimeoutSec 10
    if ("$qgaOut" -match "READY") { $bootReady = $true }
    if (-not $bootReady) {
        $result = Invoke-SSH 'if test -f /var/lib/cloud/instance/boot-finished; then echo READY; else awk ''{rx += $1} END {print "NET_RX=" rx}'' /sys/class/net/*/statistics/rx_bytes; awk ''{tx += $1} END {print "NET_TX=" tx}'' /sys/class/net/*/statistics/tx_bytes; fi'
        if ("$result" -match "READY") { $bootReady = $true }
        if (-not "$qgaOut" -and "$result" -match "NET_RX=") { $qgaOut = $result }
    }
    if ($bootReady) { $ready = $true; break }
    $rxMatch = [regex]::Match("$qgaOut", "NET_RX=(\d+)")
    $txMatch = [regex]::Match("$qgaOut", "NET_TX=(\d+)")
    if (($waited - $lastNetworkActivity) -ge 10 -and $rxMatch.Success -and $txMatch.Success) {
        $lastNetworkActivity = $waited
        $downloaded = [Math]::Round([double]$rxMatch.Groups[1].Value / 1MB, 1)
        $uploaded = [Math]::Round([double]$txMatch.Groups[1].Value / 1MB, 1)
        Write-Info "Activity: downloaded ${downloaded} MB | uploaded ${uploaded} MB"
    }
    # Every 90s without SSH progress: show what the VM console is doing so the
    # user can see whether it is still booting, stuck on login, or offline.
    if (($waited - $lastDiag) -ge 90) {
        $lastDiag = $waited
        $serialLog = Join-Path $CACHE "qemu-serial.log"
        Write-Host ""
        Write-Warn "No SSH response after ${waited}s - last VM console output:"
        if (Test-Path $serialLog) {
            Get-Content $serialLog -Tail 8 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
        Write-Warn "If the VM shows a login prompt: log in on the VM console (root / password iora) and run:"
        Write-Warn "  ip a ; journalctl -u ssh -n 20 ; tail -30 /var/log/cloud-init-output.log"
    }
    Start-Sleep -Seconds 5
    $waited += 5
    Write-Host -NoNewline "."
    if ($waited % 60 -eq 0 -and $waited -gt 0) { Write-Host -NoNewline "[${waited}s]" }
}
Write-Host ""
if (-not $ready) {
    Stop-WithError "Cloud-init timed out. Try: ssh -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST"
}
Write-Success "VM boot completed through the Guest Agent."
$sshProbe = & $SSH_BIN @SSH_OPTS -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST "echo SSH_OK" 2>&1 | Where-Object { $_ -is [string] }
if ($LASTEXITCODE -eq 0 -and "$sshProbe" -match "SSH_OK") { Write-Success "SSH ready at ${VM_HOST}:$VM_SSH_PORT" }
else { Write-Warn "SSH is not reachable; provisioning and diagnostics continue through QGA where possible." }

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
wsl bash -c "mkdir -p ~/.ssh && install -m 600 '$keyWsl' ~/.ssh/iora_dev_key 2>/dev/null || cp '$keyWsl' ~/.ssh/iora_dev_key" 2>&1 | Out-Null
# The rsync fast path needs rsync in WSL (the VM gets it during provisioning)
$null = wsl bash -c "command -v rsync >/dev/null 2>&1 || sudo apt-get install -y -qq rsync 2>&1 | tail -1" 2>&1 | Out-Null
$syncExcludes = "--exclude='.git' --exclude='target' --exclude='node_modules' --exclude='.cache' --exclude='buildroot-*' --exclude='releases' --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' --exclude='*.tar.gz' --exclude='.iora-dev'"
$syncSsh = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=5 -o AddressFamily=inet -i ~/.ssh/iora_dev_key -p $VM_SSH_PORT"
# WSL2 NAT mode: the VM's forwarded ports live on the Windows host, which WSL
# reaches via its default-route gateway (127.0.0.1 inside WSL only works in
# mirrored mode). Probe 127.0.0.1 first, then derive the gateway from
# /proc/net/route, so the rsync fast path works in both WSL network modes.
function Get-WslSyncHost {
    if ($Bridge) { return $VM_HOST }
    $null = wsl bash -c "ssh $syncSsh root@127.0.0.1 'true'" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { return "127.0.0.1" }
    $route = wsl bash -c "cat /proc/net/route" 2>&1 | Where-Object { $_ -is [string] }
    foreach ($l in $route) {
        if ($l -match '^[A-Za-z0-9]+\s+00000000\s+([0-9A-Fa-f]{8})') {
            $h = $matches[1]
            $ip = @()
            for ($i = 6; $i -ge 0; $i -= 2) { $ip += [Convert]::ToInt32($h.Substring($i, 2), 16) }
            return ($ip -join '.')
        }
    }
    return $null
}
$wslHost = Get-WslSyncHost
$syncOut = ""
if ($wslHost) {
    $syncOut = wsl bash -c "rsync -az --delete $syncExcludes -e 'ssh $syncSsh' '$repoWsl/' root@${wslHost}:/home/iora/iora/ && ssh $syncSsh root@${wslHost} 'chown -R iora:iora /home/iora/iora'" 2>&1
}
$mainSyncOk = ($LASTEXITCODE -eq 0) -and $wslHost
if (-not $mainSyncOk) {
    Write-Dim "  rsync output (last 12 lines):"
    ($syncOut | Select-Object -Last 12) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}
if ($mainSyncOk -and $Mode -eq "build") {
    # Build mode: also mirror the drop-box so host-built binaries reach the daemon
    wsl bash -c "rsync -az --delete -e 'ssh $syncSsh' '$repoWsl/.iora-dev/binaries/' root@${wslHost}:/home/iora/iora/.iora-dev/binaries/ 2>/dev/null || true" 2>&1 | Out-Null
}
if ($mainSyncOk -and $script:RuntimeState) {
    $script:RuntimeState = Update-IoraRuntimeState -State $script:RuntimeState -Values @{ syncStatus = "Synced"; lastSyncAt = (Get-Date).ToUniversalTime().ToString("o") }
    Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
}
if (-not $mainSyncOk) {
    Write-Warn "WSL rsync failed - falling back to tar+scp..."
    $projectTar = Join-Path $CACHE "iora-project.tar.gz"
    Push-Location $REPO_ROOT
    try {
        # Splatted args: keeps --exclude= patterns intact with both GNU tar
        # (git-bash) and bsdtar (Windows) - inline quotes in bare tokens break
        # on some tar builds (e.g. "Child returned status 128"). System32 tar
        # is used explicitly so the path cannot be hijacked by a git-bash PATH.
        $tarBin = Join-Path $env:SystemRoot "System32\tar.exe"
        if (-not (Test-Path $tarBin)) { $tarBin = "tar" }
        $tarArgs = @('-czf', $projectTar)
        foreach ($e in @('.git', 'target', 'node_modules', '.cache', 'buildroot-*', 'releases', '*.img', '*.qcow2', '*.iso', '*.tar.gz', '.iora-dev')) {
            $tarArgs += "--exclude=$e"
        }
        $tarErr = & $tarBin @tarArgs '.' 2>&1
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
        Write-Dim "  tar output (last 10 lines):"
        ($tarErr | Select-Object -Last 10) | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Stop-WithError "Project sync failed (rsync and tar fallback both failed)."
    }
}
Write-Success "Project synced (1:1 mirror at /home/iora/iora)"

# Parallel: start the frontend npm install right after the mirror is in place
# (runs while apt/rustup provision below; waited for in Step 9)
$npmJob = $null
if ($needProvision -and $Mode -eq "source") {
    Write-Info "Starting frontend npm install in the background (parallel to provisioning)..."
    $npmJob = Start-Job -ArgumentList $SSH_BIN, $SSH_OPTS, $SSH_KEY, $VM_HOST, $VM_SSH_PORT -ScriptBlock {
        param($sshBin, $sshOpts, $sshKey, $vmHost, $port)
        # npm only exists after the node upgrade during provisioning - wait
        # for it instead of failing with "npm: command not found" when the
        # job races the apt/rustup setup. npm runs as root here, so hand
        # node_modules over to the `iora` user afterwards - the Vite dev
        # server runs as iora and needs write access for its .vite cache.
        $cmd = 'for i in $(seq 1 90); do command -v npm >/dev/null 2>&1 && break; sleep 10; done; cd /home/iora/iora/frontend && { [ -d node_modules ] || npm install --no-audit --no-fund 2>&1; }; chown -R iora:iora node_modules 2>/dev/null || true'
        & $sshBin @sshOpts -i $sshKey -p $port root@$vmHost $cmd
    }
}

# -- Register systemd services (ALWAYS, not only on first provision): the
#    script is idempotent and this is what makes -Mode source/build switches
#    take effect on re-runs without --reprovision.
Write-Info "Registering IORA OS systemd services (mode: $Mode)..."
Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-services.sh --$Mode-mode 2>&1" | Select-Object -Last 8

if ($needProvision) {
    # Parallel: the Rust toolchain installs via SSH while apt runs below
    # (independent - saves minutes on first provisioning)
    Write-Info "Starting Rust toolchain install in the background (parallel to apt)..."
    $rustupJob = Start-Job -ArgumentList $SSH_BIN, $SSH_OPTS, $SSH_KEY, $VM_HOST, $VM_SSH_PORT -ScriptBlock {
        param($sshBin, $sshOpts, $sshKey, $vmHost, $port)
        $cmd = "su - iora -c 'test -x ~/.cargo/bin/rustc || curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal' 2>&1"
        & $sshBin @sshOpts -i $sshKey -p $port root@$vmHost $cmd
    }

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

    Write-Info "Upgrading Node.js to 22 (Vite 7 needs Node >= 20.12, Debian 12 ships 18)..."
    $nodeScript = @'
set -e
export DEBIAN_FRONTEND=noninteractive
if node --version 2>/dev/null | grep -qE "^v(2[02])" ; then
    echo "node OK: $(node --version)"
else
    curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource-setup.sh
    bash /tmp/nodesource-setup.sh 2>&1 | tail -1
    apt-get install -y -qq nodejs 2>&1 | tail -1
    echo "node upgraded: $(node --version)"
fi
'@
    $nodeOut = Invoke-SSHStdin $nodeScript
    $nodeOut | Select-Object -Last 2

    Write-Info "Installing UEFI bootloader (grub-efi) so the VM can boot via OVMF..."
    $grubEfiScript = @'
set -e
# The Debian cloud image ships with an EMPTY EFI System Partition and can only
# boot via BIOS/SeaBIOS. Installing grub-efi makes the VM UEFI-bootable too
# (parity with the RPi4/IORA OS target). --no-nvram: we run in BIOS mode and
# must not touch efibootmgr. The BOOTX64.EFI copy covers the OVMF removable-
# media fallback path even without NVRAM boot entries.
export DEBIAN_FRONTEND=noninteractive
echo "--- installing grub-efi-amd64 ---"
apt-get install -y -qq --no-install-recommends -o Acquire::Retries=3 grub-efi-amd64
mkdir -p /boot/efi
mountpoint -q /boot/efi || mount /boot/efi 2>/dev/null || true
if grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=debian --no-nvram --recheck 2>&1 | tail -n 4; then
    mkdir -p /boot/efi/EFI/BOOT
    cp -f /boot/efi/EFI/debian/grubx64.efi /boot/efi/EFI/BOOT/BOOTX64.EFI 2>/dev/null || true
    echo "--- update-grub ---"
    update-grub 2>&1 | tail -n 2
    echo "GRUB_EFI_OK"
else
    echo "grub-install failed - VM stays BIOS-only (SeaBIOS self-heal remains active)"
fi
'@
    $grubEfiOut = Invoke-SSHStdin $grubEfiScript
    $grubEfiOut | Select-Object -Last 4
    if (($grubEfiOut -join "`n") -match "GRUB_EFI_OK") {
        Write-Success "VM is now UEFI-bootable (grub-efi installed into the ESP)"
    } else {
        Write-Warn "grub-efi install did not complete - VM stays BIOS/SeaBIOS-only"
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

    Write-Info "Waiting for the Rust toolchain install..."
    Wait-Job $rustupJob -TimeoutSec 900 | Out-Null
    if ($rustupJob.State -eq "Running") {
        Write-Warn "Rust toolchain install still running after 900s - continuing; it may be interrupted when the script exits."
    } else {
        Receive-Job $rustupJob | Select-Object -Last 4
        Remove-Job $rustupJob -Force
        Write-Success "Rust toolchain ready"
    }

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

    Write-Info "Seeding cargo registry from the host (faster first builds)..."
    $cargoRegHost = Join-Path $env:USERPROFILE ".cargo\registry"
    if ((Test-Path $cargoRegHost) -and $wslHost) {
        $cargoRegWsl = ConvertTo-WslPath $cargoRegHost
        $seedOut = wsl bash -c "rsync -az -e 'ssh $syncSsh' '$cargoRegWsl/' root@${wslHost}:/home/iora/.cargo/registry/ 2>&1"
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Cargo registry seeded from host"
        } else {
            Write-Warn "Cargo seeding failed - the first build will download crates"
            ($seedOut | Select-Object -Last 5) | ForEach-Object { Write-Dim "  $_" }
        }
    } else {
        Write-Dim "  (no host cargo registry found - skipping seeding)"
    }

    Write-Info "Pre-building all services (first boot after reset starts fast)..."
    $prebuildOut = Invoke-SSH 'su - iora -c ''cd /home/iora/iora/iora-os/backend && cargo build --workspace 2>&1 | tail -2'''
    $prebuildOut | Select-Object -Last 3
    if (($prebuildOut -join "`n") -match "Finished") {
        Write-Success "Workspace prebuilt - services start instantly after a reset"
    } else {
        Write-Warn "Workspace prebuild did not finish cleanly - the first boot after a reset will build services serially (slow)"
    }

    Write-Info "Applying IORA OS compat layer + improvements (one SSH session)..."
    $compatScript = @'
for s in iora-dev-compat.sh iora-dev-improvements.sh iora-optimize-memory.sh iora-config-sync.sh; do
    echo "=== $s ==="
    bash "/home/iora/iora/iora-os/$s" 2>&1 | tail -n 8
    echo ""
done
'@
    Invoke-SSHStdin $compatScript | Select-Object -Last 12

    Write-Info "Security parity: AppArmor profiles + dev signing key..."
    $securityScript = @'
set -e
# -- AppArmor: enable the daemon + install starter profiles in COMPLAIN mode
#    (violations are logged, nothing is blocked - switch to enforce for
#    testing the production behaviour)
if ! command -v aa-status >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq --no-install-recommends apparmor apparmor-utils 2>&1 | tail -1
fi
if [ -d /home/iora/iora/iora-os/apparmor/dev-vm ]; then
    mkdir -p /etc/apparmor.d
    for p in /home/iora/iora/iora-os/apparmor/dev-vm/*; do
        [ -f "$p" ] && install -m 644 "$p" "/etc/apparmor.d/$(basename "$p")"
    done
    aa-status --enabled 2>/dev/null && systemctl enable --now apparmor 2>/dev/null || true
    for p in /etc/apparmor.d/iora-home /etc/apparmor.d/iora-core /etc/apparmor.d/iora-watchdog; do
        [ -f "$p" ] && apparmor_parser -C -r "$p" 2>/dev/null || true
    done
    echo "--- apparmor: $(aa-status 2>/dev/null | head -2 | tail -1)"
fi
# -- Dev signing key: iora-sign parity for the build host. The wrapper builds
#    iora-sign on first use and generates /etc/iora/dev-signing/iora-dev.key
mkdir -p /etc/iora/dev-signing
cat > /usr/local/bin/iora-dev-sign <<'SIGNEOF'
#!/bin/bash
# Sign a file with the IORA dev signing key (iora-sign parity on the build host)
set -e
KEY=/etc/iora/dev-signing/iora-dev.key
if [ ! -f "$KEY" ]; then
    mkdir -p /etc/iora/dev-signing
    if [ ! -x /usr/bin/iora-sign ]; then
        echo "Building iora-sign (first use)..." >&2
        su - iora -c "cd /home/iora/iora/iora-os/backend && cargo build -p iora-sign -q" >&2
        install -m 755 /home/iora/iora/iora-os/backend/target/debug/iora-sign /usr/bin/iora-sign
    fi
    /usr/bin/iora-sign keygen --out-dir /etc/iora/dev-signing --name iora-dev
    echo "Dev signing key created: $KEY" >&2
fi
exec /usr/bin/iora-sign file --key "$KEY" --in "$1"
SIGNEOF
chmod 755 /usr/local/bin/iora-dev-sign
# Generate the key now (best-effort - the first iora-sign build takes a moment)
echo "IORA dev VM signing key - sign plugins/apps with: iora-dev-sign <file>" > /etc/iora/dev-signing/README
if /usr/local/bin/iora-dev-sign /etc/iora/dev-signing/README 2>&1 | tail -1; then
    echo "DEV_SIGN_OK"
else
    echo "dev signing key deferred (toolchain still busy)"
fi
'@
    $securityOut = Invoke-SSHStdin $securityScript
    $securityOut | Select-Object -Last 4

    Invoke-SSH 'mkdir -p /etc/iora && touch /etc/iora/dev-vm-provisioned' | Out-Null
    Set-Content -Path $PROVISIONED_MARKER -Value (Get-Date -Format "o") -NoNewline
    # The VM is now UEFI-bootable (grub-efi installed): clear the SeaBIOS
    # marker so the NEXT boot tries UEFI/OVMF again. If that fails, the
    # self-heal kicks in and re-marks SeaBIOS - the system self-corrects.
    Remove-Item $BOOT_FIRMWARE_MARKER -Force -ErrorAction SilentlyContinue
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
# -- Self-healing: newer services reference postgres DBs that were never
#    created ("database ... does not exist"). Create every DB that any
#    /etc/iora/<svc>.env points at - idempotent, runs on every dev-local run.
for envf in /etc/iora/iora-*.env; do
    [ -f "$envf" ] || continue
    url=$(grep '^DATABASE_URL=' "$envf" 2>/dev/null | head -1 | cut -d= -f2-)
    case "$url" in
        postgres://*)
            db=$(echo "$url" | sed -E 's|.*/([^?]*).*|\1|')
            # DB names may contain dashes (e.g. iora_domain-validator) - quote
            # them and whitelist the charset
            case "$db" in *[!a-zA-Z0-9_-]*) db="";; esac
            if [ -n "$db" ]; then
                su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 \
                    || su - postgres -c "psql -c \"CREATE DATABASE \\\"$db\\\" OWNER iora\""
            fi
            ;;
    esac
done
# -- SQLite-backed services must not get a postgres URL (sqlx would try to
#    open the URL as a file -> "unable to open database file"). This covers
#    both /etc/iora/<svc>.env and the priority-1 db-credentials files.
for svc in iora-api iora-connector iora-files iora-gateway iora-intelligence; do
    for envf in "/etc/iora/$svc.env" "/etc/iora/db-credentials/$svc.env"; do
        if [ -f "$envf" ] && grep -q '^DATABASE_URL=postgres://' "$envf" 2>/dev/null; then
            mkdir -p "/var/lib/iora/$svc"
            chown iora:iora "/var/lib/iora/$svc" 2>/dev/null || true
            sed -i "s|^DATABASE_URL=.*|DATABASE_URL=sqlite:///var/lib/iora/$svc/$svc.db?mode=rwc|" "$envf"
            echo "iora-db-init: fixed $svc to sqlite ($envf)"
        fi
    done
done
# -- iora-security needs a 32-byte hex DB encryption key (production parity)
envf=/etc/iora/iora-security.env
if [ -f "$envf" ] && ! grep -q '^SECURITY_DB_KEY=' "$envf"; then
    key=$(openssl rand -hex 32 2>/dev/null)
    if [ -n "$key" ]; then
        echo "SECURITY_DB_KEY=$key" >> "$envf"
        echo "iora-db-init: generated SECURITY_DB_KEY"
    fi
fi
# -- Port collision avoidance: iora-developer-app and iora-intelligence both
#    default to 8099 (iora-api's port). Pin them to free ports. Use the
#    service-specific {SERVICE}_PORT variable: the generic PORT= is the
#    process' OWN port and system_config::service_url() falls back to it for
#    EVERY service, making iora-home proxy /api/os/control/* and
#    /api/files/* to itself (recursive loop, 503s, FD exhaustion).
for pv in "iora-developer-app 8110" "iora-intelligence 8112"; do
    svc=${pv% *}; port=${pv#* }
    envf="/etc/iora/$svc.env"
    var=$(printf '%s' "$svc" | tr '[:lower:]-' '[:upper:]_')
    if [ -f "$envf" ] && ! grep -q "^${var}_PORT=$port" "$envf" 2>/dev/null; then
        echo "${var}_PORT=$port" >> "$envf"
        echo "iora-db-init: pinned $svc to port $port"
    fi
    # Remove a legacy generic PORT= pin if present (breaks discovery)
    if [ -f "$envf" ]; then
        sed -i '/^PORT=[0-9]/d' "$envf" 2>/dev/null || true
    fi
done
mkdir -p /etc/systemd/system/iora-home.service.d /opt/iora/build/iora-home/data /var/lib/iora/iora-home
chown iora:iora /var/lib/iora/iora-home 2>/dev/null || true
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
# Guest agent: reliable control channel + LAN IP discovery (bridge mode)
if ! command -v qemu-ga >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq --no-install-recommends qemu-guest-agent 2>&1 | tail -1
fi
systemctl enable --now qemu-guest-agent 2>/dev/null || true
# Bridge mode: allow the LAN subnet through the IORA firewall (the slirp
# rules only cover 10.0.2.0/24 + localhost)
lan=$(ip route 2>/dev/null | awk '/default via/ {print $1; exit}')
case "$lan" in
    ""|10.0.2.*|172.16.*|172.17.*|172.18.*|172.19.*|172.20.*|172.21.*|172.22.*|172.23.*|172.24.*|172.25.*|172.26.*|172.27.*|172.28.*|172.29.*|172.30.*|172.31.*) ;;
    *)
        if command -v iptables >/dev/null 2>&1; then
            iptables -C INPUT -p tcp -m multiport --dports 22,80,443,3001,5432,8080,8088:8130 -s "$lan" -j ACCEPT 2>/dev/null \
                || iptables -A INPUT -p tcp -m multiport --dports 22,80,443,3001,5432,8080,8088:8130 -s "$lan" -j ACCEPT
            echo "iora-db-init: firewall allows LAN subnet $lan (bridge mode)"
        fi
        ;;
esac
# Start dependency groups sequentially. `After=` orders units but does not
# prove application readiness, therefore every phase waits for active units.
start_phase() {
    label="$1"; shift
    echo "iora-db-init: starting $label"
    for unit in "$@"; do
        systemctl list-unit-files "$unit.service" --no-legend 2>/dev/null | grep -q "^$unit.service" || continue
        systemctl reset-failed "$unit.service" 2>/dev/null || true
        timeout 90 systemctl restart "$unit.service" 2>/dev/null || true
        timeout 30 sh -c "until systemctl is-active --quiet '$unit.service'; do sleep 1; done" || echo "iora-db-init: $unit did not become active"
    done
}
systemctl start postgresql redis-server docker 2>/dev/null || true
pg_isready -q -t 30 2>/dev/null || echo "iora-db-init: PostgreSQL not ready"
start_phase phase-2 iora-secrets iora-security iora-core iora-gateway
start_phase phase-3 iora-home iora-api iora-files iora-connector
start_phase phase-4 iora-intelligence iora-developer-app
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
    # If a fresh provisioning is expected, npm install was already started in
    # the background right after the mirror sync - wait for it here so the
    # vite step below is a no-op (or a safety retry).
    if ($npmJob) {
        Write-Info "Waiting for the background npm install..."
        Wait-Job $npmJob -TimeoutSec 900 | Out-Null
        if ($npmJob.State -eq "Running") {
            Write-Warn "npm install still running - continuing (the vite step will retry if needed)."
        } else {
            Receive-Job $npmJob | Select-Object -Last 3
            Remove-Job $npmJob -Force
            $npmJob = $null
        }
    }
    Write-Info "Source mode: setting up the Vite dev server in the VM..."
    $viteScript = @'
set +e
cd /home/iora/iora/frontend || exit 0
if [ -f package.json ]; then
    [ -d node_modules ] || npm install --no-audit --no-fund 2>&1 | tail -3
    # npm ran as root - the Vite dev server runs as `iora` and needs write
    # access to node_modules for its .vite dependency cache (EACCES
    # otherwise, which surfaces as 504 "Outdated Optimize Dep").
    chown -R iora:iora node_modules 2>/dev/null || true
    # A stale Vite dependency cache (from a previous npm install) serves 504
    # "Outdated Optimize Dep" and renders a white page - drop it before start.
    rm -rf node_modules/.vite 2>/dev/null || true
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
# FD limit: Vite serves the SPA plus HMR websockets for every browser tab;
# the systemd default (1024) triggers "accept error: Too many open files".
LimitNOFILE=65536
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
if ($healthOk) { Write-Success "iora-home OK on http://${VM_HOST}:$VM_HOME" }
else { Write-Warn "iora-home not responding yet. Check: ssh -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST 'journalctl -u iora-home -n 50'" }

# -- Step 10: Launch dev-watch TUI ------------------------------------------
if (-not $NoWatch) {
    $dashBin = Join-Path $REPO_ROOT "iora-os\backend\target\debug\iora-dev-watch.exe"
    if (Test-WatcherNeedsBuild $dashBin) {
        Write-Info "Building updated dev-watch TUI..."
        Push-Location (Join-Path $REPO_ROOT "iora-os\backend")
        try {
            # cmd /c merges stderr into stdout as plain text - PowerShell
            # 5.1 would otherwise render every cargo stderr line as a red
            # "cargo : ..." NativeCommandError record.
            & $env:ComSpec /d /c "cargo build -p iora-dev-watch 2>&1" | Select-Object -Last 5
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
            '--vm-host', "$VM_HOST",
            '--vm-port', "$VM_SSH_PORT",
            '--qga-port', "$($script:RuntimeState.qgaPort)",
            '--ssh-key', "$SSH_KEY"
        )
        Start-Process -FilePath $dashBin -ArgumentList $watcherArgs | Out-Null
        if ($script:RuntimeState) {
            $script:RuntimeState.watcherStatus = "Running"
            Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
        }
    }
}
if ($Mode -eq "source" -and -not $NoSync) {
    Write-Info "Starting continuous source sync for Vite HMR and Rust delta builds..."
    Start-Process -FilePath "wsl" -WorkingDirectory $SCRIPT_DIR -ArgumentList @(
        "bash", "dev-sync.sh", "--watch", "--vm-host", "$VM_HOST",
        "--vm-port", "$VM_SSH_PORT", "--ssh-key", "$SSH_KEY", "--quiet"
    ) -WindowStyle Minimized | Out-Null
    if ($script:RuntimeState) {
        $script:RuntimeState = Update-IoraRuntimeState -State $script:RuntimeState -Values @{ syncStatus = "Watching"; lastSyncAt = (Get-Date).ToUniversalTime().ToString("o") }
        Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
    }
}

# -- Step 11: Start background health monitor -------------------------------
$HEALTH_MONITOR_LOG = Join-Path $CACHE "health-monitor.log"
$HEALTH_MONITOR_PID = Join-Path $CACHE "health-monitor.pid"

if (Get-Command Start-HealthMonitor -ErrorAction SilentlyContinue) {
    Start-HealthMonitor -VMHost $VM_HOST -VMPort $VM_SSH_PORT -SSHKey $SSH_KEY `
        -LogFile $HEALTH_MONITOR_LOG -PIDFile $HEALTH_MONITOR_PID
}

# -- Banner -----------------------------------------------------------------
Write-Host ""
$runtimeReport = $null
if ($script:RuntimeState -and (Get-Command Invoke-IoraReadiness -ErrorAction SilentlyContinue)) {
    $runtimeConnection = Get-IoraConnection -State $script:RuntimeState
    $runtimeReport = Invoke-IoraReadiness -State $script:RuntimeState -Connection $runtimeConnection
    $script:RuntimeState.lifecycle = $runtimeReport.Lifecycle
    $script:RuntimeState.provisioned = Test-Path $PROVISIONED_MARKER
    if ($runtimeReport.Lifecycle -eq "Ready") { $script:RuntimeState.lastReadyAt = (Get-Date).ToUniversalTime().ToString("o") }
    else { $script:RuntimeState.lastError = $runtimeReport.HomeDiagnosis.Summary }
    Save-IoraRuntimeState -State $script:RuntimeState -Path $RUNTIME_STATE_PATH
}
if ($runtimeReport -and $runtimeReport.Lifecycle -ne "Ready") {
    Write-Warn "IORA Dev VM is $($runtimeReport.Lifecycle), not Ready."
    Write-Warn $runtimeReport.HomeDiagnosis.Summary
} else {
    Write-Success "IORA Dev VM ready!"
}
Write-Host ""
$bannerTitle = if ($runtimeReport -and $runtimeReport.Lifecycle -ne "Ready") { "IORA Dev VM $($runtimeReport.Lifecycle)" } else { "IORA Dev VM ready" }
$titleLine = "  |" + $bannerTitle.PadLeft((68 + $bannerTitle.Length) / 2).PadRight(68) + "|"
$readyBanner = @"
  +====================================================================+
$titleLine
  +====================================================================+
  |  WEB                                                                |
  |    Dashboard (nginx) https://$VM_HOST                                      |
  |    Dashboard direct  http://${VM_HOST}:$VM_HOME                                   |
  |    Dev Bridge        http://${VM_HOST}:$VM_BRIDGE/dev/health                      |
  |    Swagger API       http://${VM_HOST}:$VM_HOME/api/docs                          |
  |    Global Config API http://${VM_HOST}:$VM_HOME/api/settings                      |
  |                                                                     |
  |  ACCESS                                                             |
  |    SSH               ssh -i $SSH_KEY -p $VM_SSH_PORT root@$VM_HOST
  |                                                                     |
  |  CO-BUDDY FEATURES                                                  |
  |    Auto-repair       Port conflicts, disk space, dependencies       |
  |    Health Monitor    Background monitoring (logs: health-monitor.log)|
  |    Smart Recovery    Auto-restart failed services                   |
  |                                                                     |
  |  LOGS (100% IORA OS compatible)                                     |
  |    All services      ssh root@$VM_HOST -p $VM_SSH_PORT 'journalctl -u iora-* -f'
  |    Specific service  ssh root@$VM_HOST -p $VM_SSH_PORT 'journalctl -u iora-home -f'
  |    Last 100 lines    ssh root@$VM_HOST -p $VM_SSH_PORT './iora-dev-logs.sh'
  |    Follow all logs   ssh root@$VM_HOST -p $VM_SSH_PORT './iora-dev-logs.sh -f'
  |                                                                     |
  |  GLOBAL CONFIG                                                      |
  |    Get setting       ssh root@$VM_HOST -p $VM_SSH_PORT 'iora-get-config ha.url'
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
  |    Guest agent:      .\qga.ps1 ping | exec "cmd" (no IP needed)  |
  |    QMP control:      .\qmp.ps1 status | screenshot | pause       |
$(if ($skippedPorts.Count -gt 0) { "  |    NOT forwarded:   $($skippedPorts -join ', ') (busy on host)        |" })
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
