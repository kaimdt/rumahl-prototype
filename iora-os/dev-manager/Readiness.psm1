Set-StrictMode -Version Latest

function Test-IoraTcpPort {
    param([string]$HostName, [int]$Port, [int]$TimeoutMilliseconds = 1500)
    $client = $null
    try {
        $client = [Net.Sockets.TcpClient]::new()
        $result = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne($TimeoutMilliseconds)) { return $false }
        $client.EndConnect($result); return $true
    } catch { return $false } finally { if ($client) { $client.Dispose() } }
}

function Get-IoraLifecycle {
    param([hashtable]$Checks)
    if (-not $Checks.Process) { return "Stopped" }
    if (-not $Checks.Qmp) { return "Starting" }
    if (-not $Checks.Qga) { return "Booting" }
    if (-not $Checks.Boot) { return "Booting" }
    if (-not $Checks.Systemd) { return "Provisioning" }
    if (-not $Checks.Network) { return "Waiting for network" }
    if (-not $Checks.Dependencies) { return "Waiting for dependencies" }
    if (-not $Checks.Services) { return "Starting services" }
    if (-not $Checks.InternalHome) { return "Degraded" }
    if (-not $Checks.ExternalHome) { return "Degraded" }
    if (-not $Checks.Sync -or -not $Checks.Watcher) { return "Degraded" }
    return "Ready"
}

function Test-IoraHostHealth {
    param([Parameter(Mandatory)]$Connection)
    $url = "http://$($Connection.Host):$($Connection.HomePort)/api/health"
    # .NET HttpWebRequest: PS 5.1 writes Invoke-WebRequest failures into the
    # transcript as "TerminatingError(...)" even when caught - raw .NET
    # exceptions bypass the PowerShell error pipeline and stay silent.
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Timeout = 4000
        $response = $req.GetResponse()
        $code = [int]$response.StatusCode
        $response.Close()
        return [pscustomobject]@{ Healthy = $code -eq 200; Url = $url; Error = $null }
    } catch {
        return [pscustomobject]@{ Healthy = $false; Url = $url; Error = $_.Exception.Message }
    }
}

function Get-IoraHomeDiagnosis {
    param([bool]$InternalHealthy, [bool]$ExternalHealthy, [string]$ListenOutput = "")
    if (-not $InternalHealthy) {
        return [pscustomobject]@{ Code = "service-unavailable"; Summary = "iora-home is not healthy inside the VM."; Actions = @("Restart iora-home", "Open iora-home journal", "Check PostgreSQL") }
    }
    if (-not $ExternalHealthy) {
        $bindOnly = $ListenOutput -match '127\.0\.0\.1:8126'
        return [pscustomobject]@{
            Code = $(if ($bindOnly) { "loopback-bind" } else { "network-path" })
            Summary = $(if ($bindOnly) { "iora-home only listens on the VM loopback interface." } else { "iora-home is healthy internally but unreachable from the host." })
            Actions = @("Check bind address", "Check VM firewall", "Refresh bridge IP", "Check host routing")
        }
    }
    return [pscustomobject]@{ Code = "healthy"; Summary = "iora-home is reachable inside the VM and from the host."; Actions = @() }
}

function Invoke-IoraReadiness {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)]$Connection)
    $qmp = Test-IoraQmp -State $State
    $qga = Test-IoraQga -State $State
    $boot = $false; $systemd = $false; $network = $false; $dependencies = $false; $services = $false; $internalHome = $false; $listen = ""
    $failedUnits = @()
    if ($qga) {
        $bootResult = Invoke-IoraQgaExec -State $State -Command 'test -f /var/lib/cloud/instance/boot-finished' -TimeoutSeconds 8
        $boot = $bootResult -and $bootResult.ExitCode -eq 0
        $systemdResult = Invoke-IoraQgaExec -State $State -Command 'systemctl is-system-running 2>/dev/null' -TimeoutSeconds 8
        $systemd = $systemdResult -and $systemdResult.StdOut.Trim() -in @("running", "degraded")
        $ipResult = Invoke-IoraQgaExec -State $State -Command 'ip -4 route get 1.1.1.1 >/dev/null 2>&1' -TimeoutSeconds 8
        $network = $ipResult -and $ipResult.ExitCode -eq 0
        $dependencyResult = Invoke-IoraQgaExec -State $State -Command 'pg_isready -q && (command -v redis-cli >/dev/null 2>&1 && redis-cli ping 2>/dev/null | grep -q PONG || true)' -TimeoutSeconds 10
        $dependencies = $dependencyResult -and $dependencyResult.ExitCode -eq 0
        $failedResult = Invoke-IoraQgaExec -State $State -Command "systemctl --failed --no-legend 'iora-*' 2>/dev/null | awk '{print `$1}'" -TimeoutSeconds 8
        if ($failedResult -and $failedResult.StdOut) { $failedUnits = @($failedResult.StdOut -split "`n" | Where-Object { $_ }) }
        $services = $failedUnits.Count -eq 0
        $homeResult = Invoke-IoraQgaExec -State $State -Command 'curl -fsS --max-time 4 http://127.0.0.1:8126/api/health >/dev/null' -TimeoutSeconds 8
        $internalHome = $homeResult -and $homeResult.ExitCode -eq 0
        $listenResult = Invoke-IoraQgaExec -State $State -Command "ss -lntp 2>/dev/null | grep ':8126 ' || true" -TimeoutSeconds 8
        if ($listenResult) { $listen = $listenResult.StdOut }
    }
    $hostHealth = Test-IoraHostHealth -Connection $Connection
    $checks = @{
        Process = Test-IoraProcess -State $State; Qmp = $qmp; Qga = $qga; Boot = $boot; Systemd = $systemd
        Network = $network; Dependencies = $dependencies; Services = $services; InternalHome = $internalHome
        ExternalHome = $hostHealth.Healthy; Sync = $State.syncStatus -in @("Synced", "Watching"); Watcher = $State.watcherStatus -eq "Running"
    }
    [pscustomobject]@{
        Lifecycle = Get-IoraLifecycle -Checks $checks
        Checks = $checks
        FailedUnits = $failedUnits
        HostHealth = $hostHealth
        HomeDiagnosis = Get-IoraHomeDiagnosis -InternalHealthy $internalHome -ExternalHealthy $hostHealth.Healthy -ListenOutput $listen
    }
}

Export-ModuleMember -Function Test-IoraTcpPort, Get-IoraLifecycle, Test-IoraHostHealth, Get-IoraHomeDiagnosis, Invoke-IoraReadiness
