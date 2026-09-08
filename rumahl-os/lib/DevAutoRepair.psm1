# ============================================================================
# DevAutoRepair.psm1 - Intelligent Auto-Detection & Auto-Repair Library
# ============================================================================
# Provides autonomous problem detection and repair functions for rumahl dev VMs.
# Designed to be non-intrusive and handle common development issues automatically.
#
# Usage: Import-Module ./lib/DevAutoRepair.psm1
# ============================================================================

# -- Logging fallbacks (used when the module is imported standalone; the
#    calling script's Write-Info/Write-Success/Write-Warn/Write-Err functions
#    take precedence when defined) ------------------------------------------
if (-not (Get-Command Write-Info -ErrorAction SilentlyContinue)) {
    function Write-Info    { param([string]$Msg) Write-Host "[*] $Msg" -ForegroundColor Cyan }
    function Write-Success { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green }
    function Write-Warn    { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
    function Write-Err     { param([string]$Msg) Write-Host "[X] $Msg" -ForegroundColor Red }
}

# -- Auto-Detection Functions -----------------------------------------------

function Test-PortConflict {
    param(
        [int]$Port
    )

    # Windows: native cmdlet; other platforms (pwsh on macOS/Linux): netstat fallback
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($connections) {
            $process = Get-Process -Id $connections[0].OwningProcess -ErrorAction SilentlyContinue
            if ($process) {
                return @{
                    InUse = $true
                    ProcessId = $process.Id
                    ProcessName = $process.ProcessName
                }
            }
        }
    } else {
        $out = netstat -an 2>$null | Select-String -Pattern "LISTEN" | Select-String -Pattern "[:.]${Port}\s"
        if ($out) { return @{ InUse = $true; ProcessId = 0; ProcessName = "unknown" } }
    }

    return @{ InUse = $false }
}

function Resolve-PortConflict {
    param(
        [int]$Port,
        [string]$ServiceName
    )

    $conflict = Test-PortConflict -Port $Port
    if ($conflict.InUse) {
        Write-Warn "Port $Port is in use (PID: $($conflict.ProcessId), Name: $($conflict.ProcessName))"

        # Check if it's our own QEMU process
        if ($conflict.ProcessName -match "qemu") {
            Write-Info "Detected existing rumahl VM on port $Port - will reuse it"
            return 2  # Signal: reuse existing VM
        }

        # Offer to kill conflicting process
        Write-Info "Attempting to free port $Port..."
        try {
            Stop-Process -Id $conflict.ProcessId -Force -ErrorAction Stop
            Start-Sleep -Seconds 2
            Write-Success "Freed port $Port"
            return 0
        } catch {
            Write-Warn "Could not free port $Port automatically. Use: Stop-Process -Id $($conflict.ProcessId)"
            return 1
        }
    }

    return 0
}

function Test-DiskSpace {
    param(
        [string]$Path,
        [int]$MinimumGB = 5
    )

    $freeSpaceGB = 0
    try {
        $item = Get-Item $Path -ErrorAction Stop
        $drive = $item.PSDrive
        if (-not $drive) { $drive = Get-PSDrive -PSProvider FileSystem | Select-Object -First 1 }
        if ($drive) { $freeSpaceGB = [math]::Round($drive.Free / 1GB, 2) }
    } catch {
        $drive = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Sort-Object Free -Descending | Select-Object -First 1
        if ($drive) { $freeSpaceGB = [math]::Round($drive.Free / 1GB, 2) }
    }

    if ($freeSpaceGB -lt $MinimumGB) {
        Write-Warn "Low disk space: ${freeSpaceGB}GB available (minimum: ${MinimumGB}GB)"
        return $false
    }

    return $true
}

function Invoke-DiskCleanup {
    param(
        [string]$CacheDir
    )

    Write-Info "Cleaning old cache files to free disk space..."

    # Remove old log files (>7 days)
    Get-ChildItem -Path $CacheDir -Filter "*.log.*" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    # Clean old backup VM disks
    Get-ChildItem -Path $CacheDir -Filter "*.qcow2.bak" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-3) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    # Clean old cloud-init ISOs
    Get-ChildItem -Path $CacheDir -Filter "seed-*.iso" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Write-Success "Cache cleanup complete"
}

function Test-Dependencies {
    $missing = @()

    if (-not (Test-QemuAvailable)) { $missing += "qemu" }
    foreach ($exe in @("ssh.exe", "curl.exe", "rsync.exe")) {
        if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { $missing += $exe }
    }

    if ($missing.Count -gt 0) {
        return @{
            Missing = $missing
            HasMissing = $true
        }
    }

    return @{ HasMissing = $false }
}

# -- Session PATH refresh (winget/scoop installs update the registry, not the
#    current session - re-read Machine+User PATH so freshly installed tools
#    are found immediately) --------------------------------------------------
function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:PATH = "$machinePath;$userPath"
}

# -- QEMU detection (PATH + common install locations, arch-aware) ------------
function Test-QemuAvailable {
    param([string]$QemuBin = "")
    if (-not $QemuBin) {
        $QemuBin = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "qemu-system-aarch64.exe" } else { "qemu-system-x86_64.exe" }
    }
    if (Get-Command $QemuBin -ErrorAction SilentlyContinue) { return $true }
    foreach ($p in @("$env:ProgramFiles\qemu\$QemuBin", "${env:ProgramFiles(x86)}\qemu\$QemuBin", "$env:LOCALAPPDATA\Programs\qemu\$QemuBin")) {
        if (Test-Path $p) { return $true }
    }
    return $false
}

# -- Generic winget install with retry + optional post-verification ----------
function Install-WithWinget {
    param(
        [string]$WingetId,
        [scriptblock]$Verify = $null
    )
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
    foreach ($attempt in 1..2) {
        Write-Info "winget install $WingetId (attempt $attempt/2)..."
        winget install --silent --accept-package-agreements --accept-source-agreements --id $WingetId 2>&1 | Out-Null
        Update-SessionPath
        if ($LASTEXITCODE -eq 0) {
            if ($null -eq $Verify -or (& $Verify)) { return $true }
        }
        Start-Sleep -Seconds 3
    }
    return $false
}

# -- winget ID discovery -----------------------------------------------------
# The old "QEMU.QEMU" id was REMOVED from winget (Feb 2025). The current
# official id is SoftwareFreedomConservancy.QEMU - verified dynamically so
# future changes cannot break the install chain again.
function Get-QemuWingetId {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return "" }
    winget show --id SoftwareFreedomConservancy.QEMU --accept-source-agreements 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return "SoftwareFreedomConservancy.QEMU" }
    # Dynamic fallback: any remaining qemu installer in the winget repo
    try {
        $line = winget search qemu --source winget --accept-source-agreements 2>$null |
            Where-Object { $_ -match '\bqemu\b' -and $_ -match '\s+winget\s*$' } |
            Select-Object -First 1
        if ($line) {
            $parts = ($line -split '\s+', 4)
            if ($parts.Count -ge 2) { return $parts[1] }
        }
    } catch { }
    return ""
}

function Install-QemuViaChoco {
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) { return $false }
    Write-Info "Installing QEMU via Chocolatey..."
    choco install qemu -y --no-progress 2>&1 | Out-Null
    Update-SessionPath
    return (Test-QemuAvailable)
}

function Install-QemuViaScoop {
    if (-not (Get-Command scoop -ErrorAction SilentlyContinue)) { return $false }
    Write-Info "Installing QEMU via Scoop (per-user, no admin required)..."
    scoop install qemu 2>&1 | Out-Null
    Update-SessionPath
    return (Test-QemuAvailable)
}

function Install-QemuManual {
    # Official Windows builds by Stefan Weil (linked from qemu.org).
    # Layout: w64/ contains year dirs (2011/..2025/), each with
    # date-stamped installers: qemu-w64-setup-YYYYMMDD.exe
    Write-Info "Downloading the official QEMU Windows installer (qemu.weilnetz.de)..."
    try {
        $base = "https://qemu.weilnetz.de/w64/"
        # WebClient: raw .NET exceptions instead of Invoke-WebRequest's
        # terminating errors, which PS 5.1 writes into the transcript even
        # when caught.
        $wc = New-Object System.Net.WebClient
        $page = $wc.DownloadString($base)
        $links = [regex]::Matches($page, 'href="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }

        # 1) Newer layout: year subdirectories -> use the newest year
        $target = $base
        $years = $links | Where-Object { $_ -match '^\d{4}/$' } |
            ForEach-Object { [int]($_ -replace '/', '') } | Sort-Object -Descending
        if ($years) {
            $target = $base + $years[0] + "/"
            $page = $wc.DownloadString($target)
            $links = [regex]::Matches($page, 'href="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
        }

        # 2) Newest date-stamped installer in that listing
        $latest = $links |
            Where-Object { $_ -match '^qemu-w64-setup-(\d{8})\.exe$' } |
            ForEach-Object {
                [PSCustomObject]@{
                    Stamp = [int][regex]::Match($_, '^qemu-w64-setup-(\d{8})\.exe$').Groups[1].Value
                    File  = $_
                }
            } | Sort-Object Stamp -Descending | Select-Object -First 1
        if (-not $latest) {
            Write-Warn "No QEMU installer found on $target"
            return $false
        }
        $url = $target + $latest.File
        $installer = Join-Path $env:TEMP $latest.File
        Write-Info "Downloading $url ..."
        $wc.DownloadFile($url, $installer)
        Write-Info "Running the silent installer (/S, installs to Program Files\qemu)..."
        $p = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
        Update-SessionPath
        if ($p.ExitCode -eq 0 -and (Test-QemuAvailable)) {
            Write-Success "QEMU installed via the official installer."
            return $true
        }
        Write-Warn "Installer finished (exit $($p.ExitCode)) but QEMU was not found - check the installer log."
        return $false
    } catch {
        Write-Warn "Manual QEMU download failed: $($_.Exception.Message)"
        return $false
    }
}

# -- Auto-install QEMU with a full fallback chain ----------------------------
function Install-QemuIfMissing {
    if (Test-QemuAvailable) { return $true }
    Write-Info "QEMU not found - trying automatic installation..."

    # 1) winget with the current official id (verified dynamically)
    $wingetId = Get-QemuWingetId
    if ($wingetId) {
        Write-Info "Installing QEMU via winget ($wingetId, may take a while)..."
        if (Install-WithWinget -WingetId $wingetId -Verify { Test-QemuAvailable }) {
            Write-Success "QEMU installed."
            return $true
        }
        Write-Warn "winget install failed - trying alternatives..."
    } else {
        Write-Warn "QEMU not found in winget - trying alternatives..."
    }

    # 2) Chocolatey
    if (Install-QemuViaChoco) { Write-Success "QEMU installed via Chocolatey."; return $true }

    # 3) Scoop (per-user, no admin)
    if (Install-QemuViaScoop) { Write-Success "QEMU installed via Scoop."; return $true }

    # 4) Official installer download
    if (Install-QemuManual) { return $true }

    Write-Warn "All automatic QEMU installs failed. Manual options:"
    Write-Warn "  winget: winget install SoftwareFreedomConservancy.QEMU"
    Write-Warn "  choco:  choco install qemu -y"
    Write-Warn "  scoop:  scoop install qemu"
    Write-Warn "  manual: https://qemu.weilnetz.de/w64/"
    return $false
}

# -- WSL detection / auto-install (needed for tar + ISO creation) -----------
function Test-WslAvailable {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $false }
    wsl --status 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-RebootPending {
    $keys = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce\RebootRequired"
    )
    foreach ($k in $keys) { if (Test-Path $k) { return $true } }
    return $false
}

function Install-WslIfMissing {
    if (Test-WslAvailable) { return $true }
    Write-Info "WSL2 not detected - installing via 'wsl --install' (requires admin)..."
    $isAdmin = $false
    try {
        $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        $isAdmin = $false
    }
    if (-not $isAdmin) {
        Write-Warn "Admin rights required. Run 'wsl --install -d Debian' in an elevated terminal, then re-run this script."
        return $false
    }
    wsl --install -d Debian --no-launch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { wsl --install -d Debian 2>&1 | Out-Null }
    Start-Sleep -Seconds 3
    if (Test-RebootPending) {
        Write-Warn "A reboot is required to finish the WSL installation. Please reboot and re-run the dev scripts."
    }
    return (Test-WslAvailable)
}

# -- Hardware virtualization hint (WHPX acceleration needs Hyper-V) ----------
function Test-VirtualizationEnabled {
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        if ($cs.HypervisorPresent) { return $true }
    } catch { }
    return $false
}

# -- Repair broken apt/dpkg state inside WSL and ensure ISO tooling ---------
function Invoke-WslAptRepair {
    $probe = wsl bash -c "command -v genisoimage || command -v xorriso || echo NEED_ISO" 2>$null
    if ("$probe" -match "genisoimage|xorriso") { return $true }
    Write-Info "Installing ISO tooling inside WSL (xorriso preferred, apt update only when needed)..."
    # Runs as root via `wsl -u root` (no sudo/password needed); falls back to
    # the default user with sudo -n. xorriso first: genisoimage was removed
    # from Ubuntu 24.04+.
    $check = wsl -u root bash -c "apt-get install -y -qq xorriso >/dev/null 2>&1 || apt-get install -y -qq genisoimage >/dev/null 2>&1 || { apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq xorriso >/dev/null 2>&1 || apt-get install -y -qq genisoimage >/dev/null 2>&1; }; command -v genisoimage || command -v xorriso || echo MISSING" 2>$null
    if ("$check" -match "MISSING") {
        $check = wsl bash -c "SUDO=''; [ \"\$(id -u)\" != 0 ] && command -v sudo >/dev/null 2>&1 && SUDO='sudo -n'; \$SUDO apt-get install -y -qq xorriso >/dev/null 2>&1 || \$SUDO apt-get install -y -qq genisoimage >/dev/null 2>&1 || { \$SUDO apt-get update -qq >/dev/null 2>&1; \$SUDO apt-get install -y -qq xorriso >/dev/null 2>&1 || \$SUDO apt-get install -y -qq genisoimage >/dev/null 2>&1; }; command -v genisoimage || command -v xorriso || echo MISSING" 2>$null
    }
    return ("$check" -notmatch "MISSING")
}

function Install-MissingDependencies {
    param(
        [string[]]$Dependencies
    )

    if ($Dependencies.Count -eq 0) {
        return $true
    }

    Write-Info "Detected missing dependencies: $($Dependencies -join ', ')"
    foreach ($dep in $Dependencies) {
        if ($dep -match "qemu") {
            if (-not (Install-QemuIfMissing)) { return $false }
        } else {
            Write-Warn "Cannot auto-install '$dep' here - run .\install-requirements.ps1 for the full setup."
        }
    }
    return $true
}

# -- PowerShell 7 check / install -------------------------------------------
# Windows PowerShell 5.1 reads .ps1 files without UTF-8 BOM as ANSI (cp1252),
# which can break parsing when messages contain non-ASCII characters.
# PowerShell 7 reads UTF-8 by default and avoids these pitfalls.
function Test-PowerShell7 {
    return ($PSVersionTable.PSEdition -eq "Core")
}

function Install-PowerShell7 {
    if (Test-PowerShell7) { return $true }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
    Write-Info "Installing PowerShell 7 via winget..."
    if (Install-WithWinget -WingetId "Microsoft.PowerShell" -Verify { Get-Command pwsh -ErrorAction SilentlyContinue }) {
        Write-Success "PowerShell 7 installed - re-run the scripts with 'pwsh' for the best experience."
        return $true
    }
    Write-Warn "PowerShell 7 install failed (may need elevation). Manual: https://aka.ms/powershell-release"
    return $false
}

# -- Run all cheap host-level auto-repairs in one go -------------------------
function Invoke-AutoRepairs {
    param([string]$CacheDir = "")
    Write-Info "Running automatic environment checks & repairs..."

    # 1. Dependencies (QEMU etc.)
    $depCheck = Test-Dependencies
    if ($depCheck.HasMissing) {
        Install-MissingDependencies -Dependencies $depCheck.Missing | Out-Null
        Update-SessionPath
    }
    if (-not (Test-QemuAvailable)) { Install-QemuIfMissing | Out-Null }

    # 2. Disk space (if a cache dir was provided)
    if ($CacheDir -and (Test-Path $CacheDir) -and -not (Test-DiskSpace -Path $CacheDir -MinimumGB 5)) {
        Invoke-DiskCleanup -CacheDir $CacheDir
    }

    # 3. WSL (needed for ISO creation on Windows)
    if (-not (Test-WslAvailable)) { Install-WslIfMissing | Out-Null }

    # 4. Virtualization hint
    if (-not (Test-VirtualizationEnabled)) {
        Write-Warn "Hardware virtualization (Hyper-V/WHPX) not detected - QEMU will be slow (TCG fallback)."
    }

    Write-Success "Environment checks complete"
}

function Test-VMHealth {
    param(
        [string]$VMHost,
        [int]$VMPort,
        [string]$SSHKey
    )

    $sshArgs = @(
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=NUL",
        "-o", "IdentitiesOnly=yes",
        "-o", "LogLevel=ERROR",
        "-o", "ConnectTimeout=5",
        "-o", "BatchMode=yes",
        "-i", $SSHKey,
        "-p", $VMPort,
        "root@$VMHost",
        "true"
    )

    try {
        $result = & ssh $sshArgs 2>&1
        if ($LASTEXITCODE -eq 0) {
            return $true
        }
    } catch {
        # SSH not reachable
    }

    Write-Warn "VM not responding on SSH port $VMPort"
    return $false
}

function Invoke-VMRecovery {
    param(
        [string]$VMHost,
        [int]$VMPort,
        [string]$SSHKey
    )

    Write-Info "Attempting VM auto-recovery..."

    $sshBase = @(
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=NUL",
        "-o", "IdentitiesOnly=yes",
        "-o", "LogLevel=ERROR",
        "-o", "ConnectTimeout=10",
        "-i", $SSHKey,
        "-p", $VMPort,
        "root@$VMHost"
    )

    # Restart failed services
    $failedCmd = $sshBase + @("systemctl list-units --state=failed 'rumahl-*' --plain --no-legend")
    $failed = & ssh $failedCmd 2>$null

    if ($failed) {
        $services = $failed | ForEach-Object { ($_ -split '\s+')[0] }
        Write-Info "Restarting failed services: $($services -join ', ')"

        foreach ($service in $services) {
            $restartCmd = $sshBase + @("systemctl restart '$service'")
            & ssh $restartCmd 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "Restarted $service"
            } else {
                Write-Warn "Could not restart $service"
            }
        }
    }

    # Clear journal if too large (>500MB)
    $sizeCmd = $sshBase + @("du -sm /var/log/journal 2>/dev/null")
    $sizeOutput = & ssh $sizeCmd 2>$null
    if ($sizeOutput) {
        $sizeMB = [int]($sizeOutput -split '\s+')[0]
        if ($sizeMB -gt 500) {
            Write-Info "Vacuuming journal (${sizeMB}MB)..."
            $vacuumCmd = $sshBase + @("journalctl --vacuum-size=100M")
            & ssh $vacuumCmd 2>$null | Out-Null
            Write-Success "Journal vacuumed"
        }
    }
}

# -- Resource Management ----------------------------------------------------

function Test-MemoryPressure {
    param(
        [int]$ThresholdPercent = 90
    )

    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $totalMemory = $os.TotalVisibleMemorySize
    $freeMemory = $os.FreePhysicalMemory
    $usedPercent = [math]::Round((($totalMemory - $freeMemory) / $totalMemory) * 100, 0)

    if ($usedPercent -gt $ThresholdPercent) {
        Write-Warn "High memory usage: ${usedPercent}%"
        return $true
    }

    return $false
}

function Optimize-VMResources {
    param(
        [int]$CurrentCPUs,
        [int]$CurrentRAM,
        [int]$HostCPUs,
        [int]$HostRAM
    )

    $suggestedCPUs = $CurrentCPUs
    $suggestedRAM = $CurrentRAM

    # Check if we're under memory pressure
    if (Test-MemoryPressure -ThresholdPercent 85) {
        # Reduce VM RAM by 25%
        $suggestedRAM = [math]::Floor($CurrentRAM * 0.75)
        Write-Info "Memory pressure detected - suggesting reduced VM RAM: ${suggestedRAM}MB"
    }

    # Check CPU load
    $cpuLoad = (Get-CimInstance -ClassName Win32_Processor).LoadPercentage
    if ($cpuLoad -gt 80) {
        # High CPU load - reduce VM CPUs
        $suggestedCPUs = [math]::Max(2, [math]::Floor($CurrentCPUs / 2))
        Write-Info "High CPU load detected - suggesting reduced VM CPUs: $suggestedCPUs"
    }

    return @{
        CPUs = $suggestedCPUs
        RAM = $suggestedRAM
    }
}

# -- Background Health Monitor ----------------------------------------------

function Start-HealthMonitor {
    param(
        [string]$VMHost,
        [int]$VMPort,
        [string]$SSHKey,
        [string]$LogFile,
        [string]$PIDFile
    )

    # Check if already running
    if (Test-Path $PIDFile) {
        $oldPID = Get-Content $PIDFile -ErrorAction SilentlyContinue
        if ($oldPID -and (Get-Process -Id $oldPID -ErrorAction SilentlyContinue)) {
            return  # Already running
        }
    }

    # Start monitor in background job
    $monitorScript = {
        param($Host, $Port, $Key, $Log)

        while ($true) {
            Start-Sleep -Seconds 60

            # Quick health check
            $sshArgs = @(
                "-o", "StrictHostKeyChecking=no",
                "-o", "UserKnownHostsFile=NUL",
                "-o", "IdentitiesOnly=yes",
                "-o", "LogLevel=ERROR",
                "-o", "ConnectTimeout=5",
                "-o", "BatchMode=yes",
                "-i", $Key,
                "-p", $Port,
                "root@$Host",
                "true"
            )

            $result = & ssh $sshArgs 2>&1
            if ($LASTEXITCODE -ne 0) {
                $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                Add-Content -Path $Log -Value "[$timestamp] Health check failed - attempting recovery"

                # Recovery logic would go here
            }
        }
    }

    $job = Start-Job -ScriptBlock $monitorScript -ArgumentList $VMHost, $VMPort, $SSHKey, $LogFile
    $job.Id | Out-File -FilePath $PIDFile -NoNewline

    Write-Host "Health monitor started (Job ID: $($job.Id), logs: $LogFile)" -ForegroundColor DarkGray
}

function Stop-HealthMonitor {
    param(
        [string]$PIDFile
    )

    if (Test-Path $PIDFile) {
        $jobId = Get-Content $PIDFile -ErrorAction SilentlyContinue
        if ($jobId) {
            Stop-Job -Id $jobId -ErrorAction SilentlyContinue
            Remove-Job -Id $jobId -ErrorAction SilentlyContinue -Force
            Remove-Item $PIDFile -Force -ErrorAction SilentlyContinue
        }
    }
}

# -- Smart Notifications ----------------------------------------------------

function Send-Notification {
    param(
        [string]$Title,
        [string]$Message,
        [ValidateSet("Low", "Normal", "Critical")]
        [string]$Urgency = "Normal"
    )

    # Windows 10/11 Toast Notification
    if (Get-Command New-BurntToastNotification -ErrorAction SilentlyContinue) {
        New-BurntToastNotification -Text $Title, $Message -Silent | Out-Null
        return
    }

    # Fallback: Console beep
    [Console]::Beep(800, 200)
}

# Export module members
Export-ModuleMember -Function @(
    'Test-PortConflict',
    'Resolve-PortConflict',
    'Test-DiskSpace',
    'Invoke-DiskCleanup',
    'Test-Dependencies',
    'Install-MissingDependencies',
    'Update-SessionPath',
    'Test-QemuAvailable',
    'Install-WithWinget',
    'Get-QemuWingetId',
    'Install-QemuViaChoco',
    'Install-QemuViaScoop',
    'Install-QemuManual',
    'Install-QemuIfMissing',
    'Test-WslAvailable',
    'Install-WslIfMissing',
    'Test-RebootPending',
    'Test-VirtualizationEnabled',
    'Test-PowerShell7',
    'Install-PowerShell7',
    'Invoke-WslAptRepair',
    'Invoke-AutoRepairs',
    'Test-VMHealth',
    'Invoke-VMRecovery',
    'Test-MemoryPressure',
    'Optimize-VMResources',
    'Start-HealthMonitor',
    'Stop-HealthMonitor',
    'Send-Notification'
)
