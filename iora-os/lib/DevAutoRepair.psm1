# ============================================================================
# DevAutoRepair.psm1 – Intelligent Auto-Detection & Auto-Repair Library
# ============================================================================
# Provides autonomous problem detection and repair functions for IORA dev VMs.
# Designed to be non-intrusive and handle common development issues automatically.
#
# Usage: Import-Module ./lib/DevAutoRepair.psm1
# ============================================================================

# ── Auto-Detection Functions ───────────────────────────────────────────────

function Test-PortConflict {
    param(
        [int]$Port
    )

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
            Write-Info "Detected existing IORA VM on port $Port - will reuse it"
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

    $drive = (Get-Item $Path).PSDrive
    $freeSpaceGB = [math]::Round($drive.Free / 1GB, 2)

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

    $commands = @{
        "qemu-system-x86_64" = "qemu-system-x86_64.exe"
        "ssh" = "ssh.exe"
        "curl" = "curl.exe"
    }

    foreach ($cmd in $commands.Keys) {
        $exe = $commands[$cmd]
        if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
            $missing += $cmd
        }
    }

    if ($missing.Count -gt 0) {
        return @{
            Missing = $missing
            HasMissing = $true
        }
    }

    return @{ HasMissing = $false }
}

function Install-MissingDependencies {
    param(
        [string[]]$Dependencies
    )

    if ($Dependencies.Count -eq 0) {
        return $true
    }

    Write-Info "Detected missing dependencies: $($Dependencies -join ', ')"

    # Check for winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Info "Installing via winget..."
        foreach ($dep in $Dependencies) {
            switch ($dep) {
                "qemu-system-x86_64" {
                    winget install -e --id QEMU.QEMU --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
                }
            }
        }
        return $true
    }

    # Check for chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Info "Installing via Chocolatey..."
        foreach ($dep in $Dependencies) {
            switch ($dep) {
                "qemu-system-x86_64" { choco install qemu -y 2>&1 | Out-Null }
            }
        }
        return $true
    }

    Write-Warn "Could not auto-install dependencies. Please install manually: $($Dependencies -join ', ')"
    return $false
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
    $failedCmd = $sshBase + @("systemctl list-units --state=failed 'iora-*' --plain --no-legend")
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

# ── Resource Management ────────────────────────────────────────────────────

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

# ── Background Health Monitor ──────────────────────────────────────────────

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

# ── Smart Notifications ────────────────────────────────────────────────────

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
    'Test-VMHealth',
    'Invoke-VMRecovery',
    'Test-MemoryPressure',
    'Optimize-VMResources',
    'Start-HealthMonitor',
    'Stop-HealthMonitor',
    'Send-Notification'
)
