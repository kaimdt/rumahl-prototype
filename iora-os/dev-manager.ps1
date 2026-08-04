[CmdletBinding()]
param([switch]$Doctor, [switch]$Once)

$ErrorActionPreference = "Continue"
$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:Cache = Join-Path $script:Root ".cache"
$script:StatePath = Join-Path $script:Cache "runtime-state.json"
$script:DevLocal = Join-Path $script:Root "dev-local.ps1"
$script:Modules = Join-Path $script:Root "dev-manager"

Import-Module (Join-Path $script:Modules "RuntimeState.psm1") -Force
Import-Module (Join-Path $script:Modules "VmChannels.psm1") -Force
Import-Module (Join-Path $script:Modules "Readiness.psm1") -Force

function Get-ValidatedState {
    $state = Read-IoraRuntimeState -Path $script:StatePath
    $state = Clear-IoraStaleRuntimeState -State $state
    if (Test-IoraProcess -State $state) {
        if (Test-IoraQga -State $state) {
            $guestIp = Get-IoraGuestIp -State $state
            if ($state.networkMode -eq "bridge" -and $guestIp -and $guestIp -ne $state.vmHost) { $state.vmHost = $guestIp }
        }
    }
    Save-IoraRuntimeState -State $state -Path $script:StatePath
    return $state
}

function Show-Check { param([string]$Name, [bool]$Ok, [string]$Detail = "")
    $color = if ($Ok) { "Green" } else { "Red" }; $mark = if ($Ok) { "OK" } else { "FAIL" }
    Write-Host ("[{0,-4}] {1}{2}" -f $mark, $Name, $(if ($Detail) { ": $Detail" } else { "" })) -ForegroundColor $color
}

function Invoke-DoctorView {
    $state = Get-ValidatedState
    $connection = Get-IoraConnection -State $state
    $report = Invoke-IoraReadiness -State $state -Connection $connection
    Clear-Host
    Write-Host "IORA Dev Doctor`n" -ForegroundColor Cyan
    Show-Check "QEMU process" $report.Checks.Process $(if ($state.pid) { "PID $($state.pid)" } else { "not running" })
    Show-Check "QMP" $report.Checks.Qmp "127.0.0.1:$($state.qmpPort)"
    Show-Check "Guest Agent" $report.Checks.Qga "127.0.0.1:$($state.qgaPort)"
    Show-Check "VM boot" $report.Checks.Boot
    Show-Check "systemd" $report.Checks.Systemd
    Show-Check "Network" $report.Checks.Network "$($connection.Mode), $($connection.Host)"
    Show-Check "Dependencies" $report.Checks.Dependencies "PostgreSQL / Redis"
    Show-Check "IORA services" $report.Checks.Services $(if ($report.FailedUnits.Count) { $report.FailedUnits -join ", " } else { "no failed units" })
    Show-Check "iora-home internal" $report.Checks.InternalHome
    Show-Check "iora-home host" $report.Checks.ExternalHome $report.HostHealth.Url
    Write-Host "`nStatus: $($report.Lifecycle)" -ForegroundColor $(if ($report.Lifecycle -eq "Ready") { "Green" } elseif ($report.Lifecycle -eq "Degraded") { "Yellow" } else { "Red" })
    if ($report.HomeDiagnosis.Code -ne "healthy") {
        Write-Host "`n$($report.HomeDiagnosis.Summary)" -ForegroundColor Yellow
        Write-Host "Actions:" -ForegroundColor Cyan
        $report.HomeDiagnosis.Actions | ForEach-Object { Write-Host "  - $_" }
    }
    $state.lifecycle = $report.Lifecycle
    $state.lastError = if ($report.Lifecycle -in @("Ready", "Stopped")) { $null } else { $report.HomeDiagnosis.Summary }
    if ($report.Lifecycle -eq "Ready") { $state.lastReadyAt = (Get-Date).ToUniversalTime().ToString("o") }
    Save-IoraRuntimeState -State $state -Path $script:StatePath
    return $report
}

function Invoke-QgaCommandView { param([string]$Title, [string]$Command)
    $state = Get-ValidatedState; Clear-Host; Write-Host "$Title`n" -ForegroundColor Cyan
    if (-not (Test-IoraQga -State $state)) { Write-Host "Guest Agent is unavailable." -ForegroundColor Red; return }
    $result = Invoke-IoraQgaExec -State $state -Command $Command -TimeoutSeconds 30
    if ($result) { Write-Host $result.StdOut; if ($result.StdErr) { Write-Host $result.StdErr -ForegroundColor Yellow } }
}

function Start-DevVm { param([switch]$Bridge)
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script:DevLocal)
    if ($Bridge) { $arguments += "-Bridge" }
    $hostExecutable = (Get-Process -Id $PID).Path
    Start-Process -FilePath $hostExecutable -ArgumentList $arguments
}

function Start-CriticalServices {
    $state = Get-ValidatedState
    if (-not (Test-IoraQga -State $state)) { Write-Host "QGA unavailable; cannot start services safely." -ForegroundColor Red; return }
    $phases = @(
        @("postgresql", "redis-server", "docker"),
        @("iora-secrets", "iora-security", "iora-core", "iora-gateway"),
        @("iora-home", "iora-api", "iora-files", "iora-connector"),
        @("iora-intelligence", "iora-developer-app")
    )
    for ($index = 0; $index -lt $phases.Count; $index++) {
        Write-Host "Starting phase $($index + 1): $($phases[$index] -join ', ')" -ForegroundColor Cyan
        foreach ($service in $phases[$index]) {
            $unit = if ($service -match '^(postgresql|redis-server|docker)$') { $service } else { "$service.service" }
            $result = Invoke-IoraQgaExec -State $state -Command "systemctl start '$unit' && systemctl is-active --quiet '$unit'" -TimeoutSeconds 90
            Write-Host "  ${service}: $(if ($result -and $result.ExitCode -eq 0) { 'active' } else { 'failed' })" -ForegroundColor $(if ($result -and $result.ExitCode -eq 0) { "Green" } else { "Red" })
            Start-Sleep -Seconds 1
        }
    }
}

function Show-Dashboard {
    $state = Get-ValidatedState; $connection = Get-IoraConnection -State $state
    $report = Invoke-IoraReadiness -State $state -Connection $connection
    Clear-Host
    Write-Host "  IORA Dev Manager" -ForegroundColor Cyan
    Write-Host "  ----------------" -ForegroundColor DarkGray
    Write-Host ("  VM Status:    {0}" -f $report.Lifecycle)
    Write-Host ("  Network:      {0}" -f $connection.Mode)
    Write-Host ("  VM IP:        {0}" -f $connection.Host)
    Write-Host ("  Connectivity: {0}" -f $(if ($connection.Mode -eq "bridge") { "Direct LAN access (no forwarded ports)" } else { (($state.forwardedPorts | ForEach-Object { "$($_.host)->$($_.guest)" }) -join ", ") }))
    Write-Host ("  SSH:          {0}:{1} ({2})" -f $connection.Host, $connection.SshPort, $(if (Test-IoraTcpPort $connection.Host $connection.SshPort) { "Connected" } else { "Unavailable" }))
    Write-Host ("  Website:      {0}" -f $(if ($report.Checks.ExternalHome) { "Healthy" } else { "Unavailable" }))
    Write-Host ("  Guest Agent:  {0}" -f $(if ($report.Checks.Qga) { "Connected" } else { "Unavailable" }))
    Write-Host ("  Hot Reload:   {0}" -f $state.watcherStatus)
    Write-Host ("  Source Sync:  {0}" -f $state.syncStatus)
    Write-Host "`n  [1] Start VM (Slirp)          [2] Start VM (Bridge)"
    Write-Host "  [3] Doctor                    [4] Services"
    Write-Host "  [5] Failed service logs       [6] SSH"
    Write-Host "  [7] Open website              [8] Start critical services"
    Write-Host "  [9] Pause / resume VM         [G] Golden snapshot"
    Write-Host "  [W] Start watcher             [Y] Start source sync"
    Write-Host "  [S] Graceful shutdown         [X] Hard stop"
    Write-Host "  [Q] Quit`n"
    return @{ State = $state; Connection = $connection; Report = $report }
}

if ($Doctor) { [void](Invoke-DoctorView); exit $(if ((Get-ValidatedState).lifecycle -eq "Ready") { 0 } else { 1 }) }

do {
    $dashboard = Show-Dashboard
    if ($Once) { break }
    $choice = (Read-Host "Select").ToUpperInvariant()
    switch ($choice) {
        "1" { Start-DevVm }
        "2" { Start-DevVm -Bridge }
        "3" { [void](Invoke-DoctorView); Read-Host "Press Enter" | Out-Null }
        "4" { Invoke-QgaCommandView "IORA Services" "systemctl list-units --type=service 'iora-*' --no-pager"; Read-Host "Press Enter" | Out-Null }
        "5" { Invoke-QgaCommandView "Failed Services" "systemctl --failed --no-pager; journalctl -p err -n 100 --no-pager"; Read-Host "Press Enter" | Out-Null }
        "6" { & (Get-Command ssh.exe).Source -i (Join-Path $script:Cache "iora-dev-key") -p $dashboard.Connection.SshPort "root@$($dashboard.Connection.Host)" }
        "7" { Start-Process "http://$($dashboard.Connection.Host):$($dashboard.Connection.HomePort)" }
        "8" { Start-CriticalServices; Read-Host "Press Enter" | Out-Null }
        "9" { $status = Invoke-IoraQmp -State $dashboard.State -Command '{"execute":"query-status"}'; $command = if ($status -match '"paused"') { '{"execute":"cont"}' } else { '{"execute":"stop"}' }; Invoke-IoraQmp -State $dashboard.State -Command $command | Out-Null }
        "G" { & $script:DevLocal -Freeze }
        "W" { & $script:DevLocal -Watcher; $dashboard.State.watcherStatus = "Running"; Save-IoraRuntimeState $dashboard.State $script:StatePath }
        "Y" { Start-Process -FilePath "wsl" -WorkingDirectory $script:Root -ArgumentList @("bash", "dev-sync.sh", "--watch", "--vm-host", $dashboard.Connection.Host, "--vm-port", $dashboard.Connection.SshPort); $dashboard.State.syncStatus = "Watching"; Save-IoraRuntimeState $dashboard.State $script:StatePath }
        "S" { Invoke-IoraQmp -State $dashboard.State -Command '{"execute":"system_powerdown"}' | Out-Null }
        "X" { & $script:DevLocal -Stop }
    }
} while ($choice -ne "Q")
