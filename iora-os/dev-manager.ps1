[CmdletBinding()]
param([switch]$Doctor, [switch]$Once)

$managerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$rustManager = Join-Path $managerRoot "backend\target\release\iora-dev-manager.exe"
if (-not (Test-Path $rustManager)) { $rustManager = Join-Path $managerRoot "backend\target\debug\iora-dev-manager.exe" }
if (-not $Once -and -not $env:IORA_DEV_MANAGER_LEGACY) {
    $rustArguments = @("--root", $managerRoot)
    if ($Doctor) { $rustArguments += "--doctor" }
    if (Test-Path $rustManager) {
        & $rustManager @rustArguments
        exit $LASTEXITCODE
    }
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        & cargo run --manifest-path (Join-Path $managerRoot "backend\Cargo.toml") -p iora-dev-manager -- @rustArguments
        exit $LASTEXITCODE
    }
    Write-Warning "Rust Dev Manager is not built and Cargo is unavailable; using the compatibility PowerShell interface."
}

$ErrorActionPreference = "Continue"
$script:Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:Cache = Join-Path $script:Root ".cache"
$script:StatePath = Join-Path $script:Cache "runtime-state.json"
$script:SettingsPath = Join-Path $script:Cache "dev-manager-settings.json"
$script:DevLocal = Join-Path $script:Root "dev-local.ps1"
$script:Modules = Join-Path $script:Root "dev-manager"

Import-Module (Join-Path $script:Modules "RuntimeState.psm1") -Force
Import-Module (Join-Path $script:Modules "VmChannels.psm1") -Force
Import-Module (Join-Path $script:Modules "Readiness.psm1") -Force
Import-Module (Join-Path $script:Modules "VmLifecycle.psm1") -Force

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

function Start-DevVm { param([ValidateSet("slirp", "bridge")][string]$NetworkMode)
    $state = Get-ValidatedState
    if (Test-IoraProcess -State $state) { Write-Host "The VM is already running (PID $($state.pid))." -ForegroundColor Yellow; return }
    $settings = Get-IoraManagerSettings -Path $script:SettingsPath
    $settings.networkMode = $NetworkMode
    Save-IoraManagerSettings -Settings $settings -Path $script:SettingsPath
    [void](Start-IoraVmBackend -DevLocalPath $script:DevLocal -Settings $settings)
}

function Enter-QgaShell {
    $state = Get-ValidatedState
    if (-not (Test-IoraQga -State $state)) { Write-Host "QGA is unavailable." -ForegroundColor Red; return }
    Write-Host "QGA rescue shell. Type 'exit' to return. Commands run as root without SSH." -ForegroundColor Cyan
    while ($true) {
        $command = Read-Host "qga#"
        if ($command -in @("exit", "quit", "q")) { break }
        if (-not $command) { continue }
        $result = Invoke-IoraQgaExec -State $state -Command $command -TimeoutSeconds 120
        if (-not $result) { Write-Host "No QGA response." -ForegroundColor Red; continue }
        if ($result.StdOut) { Write-Host $result.StdOut -NoNewline }
        if ($result.StdErr) { Write-Host $result.StdErr -ForegroundColor Yellow -NoNewline }
        if ($result.ExitCode -ne 0) { Write-Host "exit code: $($result.ExitCode)" -ForegroundColor Red }
    }
}

function Open-IoraSshOrRescue {
    param($Connection)
    if ((Test-IoraTcpPort -HostName $Connection.Host -Port $Connection.SshPort) -and (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
        & (Get-Command ssh.exe).Source -i (Join-Path $script:Cache "iora-dev-key") -p $Connection.SshPort "root@$($Connection.Host)"
    } else {
        Write-Host "SSH is unavailable; opening the network-independent QGA shell." -ForegroundColor Yellow
        Enter-QgaShell
    }
}

function Show-VmControl {
    $state = Get-ValidatedState
    do {
        Clear-Host
        $qmp = if (Test-IoraProcess -State $state) { Get-IoraQmpStatus -State $state } else { $null }
        Write-Host "IORA VM Control`n" -ForegroundColor Cyan
        Write-Host "Process: $(if (Test-IoraProcess $state) { "PID $($state.pid)" } else { "Stopped" })"
        Write-Host "QMP:     $(if ($qmp) { "$($qmp.Status), $($qmp.CpuCount) vCPU, $($qmp.RamGB) GB" } else { "Unavailable" })"
        Write-Host "Disk:    $($state.vmDisk)"
        Write-Host "Golden:  $($state.goldenSnapshot)"
        Write-Host "`n[1] Start Slirp  [2] Start Bridge  [3] Pause  [4] Resume"
        Write-Host "[5] Reset         [6] Graceful stop [7] Hard stop"
        Write-Host "[8] Golden snapshot [9] Full rebuild [L] QEMU logs [B] Back"
        $action = (Read-Host "Select").ToUpperInvariant()
        switch ($action) {
            "1" { Start-DevVm -NetworkMode slirp }
            "2" { Start-DevVm -NetworkMode bridge }
            "3" { [void](Invoke-IoraVmQmpAction -State $state -Action pause) }
            "4" { [void](Invoke-IoraVmQmpAction -State $state -Action resume) }
            "5" { [void](Invoke-IoraVmQmpAction -State $state -Action reset) }
            "6" { if (-not (Stop-IoraVmGracefully -State $state)) { Write-Host "Graceful shutdown timed out; hard stop remains available." -ForegroundColor Yellow; Read-Host "Press Enter" | Out-Null } }
            "7" { [void](Stop-IoraVmHard -State $state) }
            "8" { & $script:DevLocal -Freeze }
            "9" { $hostExecutable = (Get-Process -Id $PID).Path; Start-Process $hostExecutable -ArgumentList @("-NoProfile", "-File", $script:DevLocal, "-Rebuild") }
            "L" {
                Clear-Host; Write-Host "QEMU Logs`n" -ForegroundColor Cyan
                foreach ($name in @("qemu-stderr.log", "qemu-serial.log")) {
                    $path = Join-Path $script:Cache $name
                    Write-Host "--- $name ---" -ForegroundColor DarkCyan
                    if (Test-Path $path) { Get-Content $path -Tail 100 } else { Write-Host "No log file available." -ForegroundColor DarkGray }
                }
                Read-Host "Press Enter" | Out-Null
            }
        }
        $state = Get-ValidatedState
    } while ($action -ne "B")
}

function Show-Settings {
    $settings = Get-IoraManagerSettings -Path $script:SettingsPath
    Clear-Host; Write-Host "IORA VM Settings`n" -ForegroundColor Cyan
    Write-Host "Current: Network=$($settings.networkMode), RAM=$($settings.ram), CPUs=$($settings.cpuCount), Mode=$($settings.mode), Watcher=$($settings.autoWatcher), Sync=$($settings.autoSync)"
    $network = Read-Host "Network mode [slirp/bridge] (Enter keeps current)"
    $ram = Read-Host "RAM, e.g. 8GB (Enter keeps current)"
    $cpu = Read-Host "vCPU count (Enter keeps current)"
    $mode = Read-Host "Development mode [source/build] (Enter keeps current)"
    $watcher = Read-Host "Start watcher with VM [on/off] (Enter keeps current)"
    $sync = Read-Host "Start source sync with VM [on/off] (Enter keeps current)"
    if ($network -in @("slirp", "bridge")) { $settings.networkMode = $network }
    if ($ram -match '^\d+(GB|G)$') { $settings.ram = $ram }
    if ($cpu -match '^\d+$' -and [int]$cpu -ge 1 -and [int]$cpu -le 64) { $settings.cpuCount = [int]$cpu }
    if ($mode -in @("source", "build")) { $settings.mode = $mode }
    if ($watcher -in @("on", "off")) { $settings.autoWatcher = $watcher -eq "on" }
    if ($sync -in @("on", "off")) { $settings.autoSync = $sync -eq "on" }
    Save-IoraManagerSettings -Settings $settings -Path $script:SettingsPath
    Write-Host "Settings saved. They apply on the next VM start." -ForegroundColor Green
    Read-Host "Press Enter" | Out-Null
}

function Show-ServiceControl {
    do {
        $state = Get-ValidatedState
        Clear-Host; Write-Host "IORA Service Control`n" -ForegroundColor Cyan
        $list = Invoke-IoraQgaExec -State $state -Command "systemctl list-units --type=service 'iora-*' --all --no-pager" -TimeoutSeconds 20
        if ($list) { Write-Host $list.StdOut } else { Write-Host "QGA unavailable." -ForegroundColor Red }
        Write-Host "`n[R] Restart  [S] Start  [T] Stop  [L] Logs  [H] Health  [D] Dependencies  [B] Back"
        $action = (Read-Host "Select").ToUpperInvariant()
        if ($action -in @("R", "S", "T", "L", "H", "D")) {
            $service = Read-Host "Service name (e.g. iora-home)"
            if ($service -notmatch '^[a-zA-Z0-9_.@-]+$') {
                Write-Host "Invalid systemd unit name." -ForegroundColor Red
                Read-Host "Press Enter" | Out-Null
                continue
            }
        }
        switch ($action) {
            "R" { [void](Invoke-IoraQgaExec $state "systemctl restart '$service' && systemctl is-active '$service'" 90) }
            "S" { [void](Invoke-IoraQgaExec $state "systemctl start '$service' && systemctl is-active '$service'" 90) }
            "T" { [void](Invoke-IoraQgaExec $state "systemctl stop '$service'; systemctl is-active '$service' || true" 90) }
            "L" { Invoke-QgaCommandView "$service logs" "journalctl -u '$service' -n 150 --no-pager"; Read-Host "Press Enter" | Out-Null }
            "H" { Invoke-QgaCommandView "$service health" "systemctl status '$service' --no-pager; systemctl is-active '$service'"; Read-Host "Press Enter" | Out-Null }
            "D" { Invoke-QgaCommandView "$service dependencies" "systemctl list-dependencies --all '$service' --no-pager"; Read-Host "Press Enter" | Out-Null }
        }
    } while ($action -ne "B")
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
    Write-Host "`n  [V] VM control                [D] Doctor"
    Write-Host "  [C] Service control           [F] Failed service logs"
    Write-Host "  [A] SSH / QGA rescue shell    [O] Open website"
    Write-Host "  [P] Start critical phases     [I] VM settings"
    Write-Host "  [W] Start watcher             [Y] Start source sync"
    Write-Host "  [1] Quick start Slirp         [2] Quick start Bridge"
    Write-Host "  [Q] Quit`n"
    return @{ State = $state; Connection = $connection; Report = $report }
}

if ($Doctor) { [void](Invoke-DoctorView); exit $(if ((Get-ValidatedState).lifecycle -eq "Ready") { 0 } else { 1 }) }

do {
    $dashboard = Show-Dashboard
    if ($Once) { break }
    $choice = (Read-Host "Select").ToUpperInvariant()
    switch ($choice) {
        "1" { Start-DevVm -NetworkMode slirp }
        "2" { Start-DevVm -NetworkMode bridge }
        "V" { Show-VmControl }
        "D" { [void](Invoke-DoctorView); Read-Host "Press Enter" | Out-Null }
        "C" { Show-ServiceControl }
        "F" { Invoke-QgaCommandView "Failed Services" "systemctl --failed --no-pager; journalctl -p err -n 100 --no-pager"; Read-Host "Press Enter" | Out-Null }
        "A" { Open-IoraSshOrRescue -Connection $dashboard.Connection }
        "O" { Start-Process "http://$($dashboard.Connection.Host):$($dashboard.Connection.HomePort)" }
        "P" { Start-CriticalServices; Read-Host "Press Enter" | Out-Null }
        "I" { Show-Settings }
        "W" { & $script:DevLocal -Watcher; $dashboard.State.watcherStatus = "Running"; Save-IoraRuntimeState $dashboard.State $script:StatePath }
        "Y" { Start-Process -FilePath "wsl" -WorkingDirectory $script:Root -ArgumentList @("bash", "dev-sync.sh", "--watch", "--vm-host", $dashboard.Connection.Host, "--vm-port", $dashboard.Connection.SshPort); $dashboard.State.syncStatus = "Watching"; Save-IoraRuntimeState $dashboard.State $script:StatePath }
    }
} while ($choice -ne "Q")
