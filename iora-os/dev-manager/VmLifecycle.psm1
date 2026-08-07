Set-StrictMode -Version Latest

function Get-IoraManagerSettings {
    param([Parameter(Mandatory)][string]$Path)
    $defaults = [ordered]@{ version = 1; networkMode = "slirp"; ram = "8GB"; cpuCount = 4; mode = "source"; autoWatcher = $true; autoSync = $true }
    if (Test-Path $Path) {
        try {
            $saved = Get-Content $Path -Raw | ConvertFrom-Json
            foreach ($property in $saved.PSObject.Properties) {
                if ($defaults.Contains($property.Name)) { $defaults[$property.Name] = $property.Value }
            }
        } catch { }
    }
    [pscustomobject]$defaults
}

function Save-IoraManagerSettings {
    param([Parameter(Mandatory)]$Settings, [Parameter(Mandatory)][string]$Path)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $temporary = "$Path.tmp"
    $Settings | ConvertTo-Json -Depth 4 | Set-Content $temporary -Encoding UTF8
    Move-Item $temporary $Path -Force
}

function Start-IoraVmBackend {
    param([Parameter(Mandatory)][string]$DevLocalPath, [Parameter(Mandatory)]$Settings)
    $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $DevLocalPath, "-Ram", $Settings.ram, "-CpuCount", [string]$Settings.cpuCount, "-Mode", $Settings.mode)
    if ($Settings.networkMode -eq "bridge") { $arguments += "-Bridge" }
    if (-not $Settings.autoWatcher) { $arguments += "-NoWatch" }
    if (-not $Settings.autoSync) { $arguments += "-NoSync" }
    $hostExecutable = (Get-Process -Id $PID).Path
    Start-Process -FilePath $hostExecutable -ArgumentList $arguments -PassThru
}

function Stop-IoraVmGracefully {
    param([Parameter(Mandatory)]$State, [int]$TimeoutSeconds = 60)
    if (-not (Test-IoraProcess -State $State)) { return $true }
    if (Test-IoraQga -State $State) {
        [void](Invoke-IoraQgaJson -State $State -Json '{"execute":"guest-shutdown"}')
    } elseif (Test-IoraQmp -State $State) {
        [void](Invoke-IoraQmp -State $State -Command '{"execute":"system_powerdown"}')
    } else { return $false }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-IoraProcess -State $State)) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Stop-IoraVmHard {
    param([Parameter(Mandatory)]$State)
    if (-not $State.pid) { return $true }
    Stop-Process -Id ([int]$State.pid) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    return -not (Test-IoraProcess -State $State)
}

function Invoke-IoraVmQmpAction {
    param([Parameter(Mandatory)]$State, [ValidateSet("pause", "resume", "reset", "powerdown")][string]$Action)
    $commands = @{ pause = '{"execute":"stop"}'; resume = '{"execute":"cont"}'; reset = '{"execute":"system_reset"}'; powerdown = '{"execute":"system_powerdown"}' }
    $response = Invoke-IoraQmp -State $State -Command $commands[$Action]
    return [bool]($response -and $response -match '"return"')
}

function Get-IoraQmpStatus {
    param([Parameter(Mandatory)]$State)
    $status = Invoke-IoraQmp -State $State -Command '{"execute":"query-status"}'
    $memory = Invoke-IoraQmp -State $State -Command '{"execute":"query-memory-size-summary"}'
    $cpus = Invoke-IoraQmp -State $State -Command '{"execute":"query-cpus-fast"}'
    try {
        $statusObject = $status | ConvertFrom-Json
        $memoryObject = $memory | ConvertFrom-Json
        $cpuObject = $cpus | ConvertFrom-Json
        return [pscustomobject]@{
            Status = $statusObject.return.status
            Running = [bool]$statusObject.return.running
            RamGB = [Math]::Round($memoryObject.return.'base-memory' / 1GB, 1)
            CpuCount = @($cpuObject.return).Count
        }
    } catch { return $null }
}

Export-ModuleMember -Function Get-IoraManagerSettings, Save-IoraManagerSettings, Start-IoraVmBackend, Stop-IoraVmGracefully, Stop-IoraVmHard, Invoke-IoraVmQmpAction, Get-IoraQmpStatus
