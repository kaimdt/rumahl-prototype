Set-StrictMode -Version Latest

$script:StateVersion = 1

function New-IoraRuntimeState {
    param([string]$CachePath)
    [ordered]@{
        version = $script:StateVersion
        pid = $null
        lifecycle = "Stopped"
        networkMode = "slirp"
        vmHost = "127.0.0.1"
        sshPort = 2222
        homePort = 8126
        forwardedPorts = @()
        qgaPort = 8109
        qmpPort = 8130
        firmware = $null
        acceleration = $null
        vmDisk = $null
        goldenSnapshot = $null
        startedAt = $null
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        provisioned = $false
        watcherStatus = "Stopped"
        syncStatus = "Stopped"
        lastReadyAt = $null
        lastSyncAt = $null
        lastError = $null
        cachePath = $CachePath
    }
}

function Read-IoraRuntimeState {
    param([Parameter(Mandatory)][string]$Path)
    $state = New-IoraRuntimeState -CachePath (Split-Path -Parent $Path)
    if (-not (Test-Path $Path)) { return [pscustomobject]$state }
    try {
        $saved = Get-Content $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        foreach ($property in $saved.PSObject.Properties) {
            if ($state.Contains($property.Name)) { $state[$property.Name] = $property.Value }
        }
    } catch {
        $state.lastError = "Runtime state could not be read: $($_.Exception.Message)"
    }
    return [pscustomobject]$state
}

function Save-IoraRuntimeState {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][string]$Path)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $State.version = $script:StateVersion
    $State.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    $temporary = "$Path.tmp"
    $State | ConvertTo-Json -Depth 8 | Set-Content -Path $temporary -Encoding UTF8
    Move-Item -Path $temporary -Destination $Path -Force
}

function Test-IoraProcess {
    param($State)
    if (-not $State.pid) { return $false }
    return $null -ne (Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue)
}

function Get-IoraConnection {
    param([Parameter(Mandatory)]$State)
    if ($State.networkMode -eq "bridge") {
        return [pscustomobject]@{ Host = $State.vmHost; SshPort = 22; HomePort = 8126; Mode = "bridge" }
    }
    return [pscustomobject]@{ Host = "127.0.0.1"; SshPort = [int]$State.sshPort; HomePort = [int]$State.homePort; Mode = "slirp" }
}

function Update-IoraRuntimeState {
    param([Parameter(Mandatory)]$State, [Parameter(Mandatory)][hashtable]$Values)
    foreach ($key in $Values.Keys) {
        if ($State.PSObject.Properties.Name -contains $key) { $State.$key = $Values[$key] }
    }
    return $State
}

function Clear-IoraStaleRuntimeState {
    param([Parameter(Mandatory)]$State)
    if (Test-IoraProcess -State $State) { return $State }
    $State.pid = $null
    $State.lifecycle = "Stopped"
    $State.watcherStatus = "Stopped"
    $State.syncStatus = "Stopped"
    $State.lastReadyAt = $null
    return $State
}

Export-ModuleMember -Function New-IoraRuntimeState, Read-IoraRuntimeState, Save-IoraRuntimeState, Test-IoraProcess, Get-IoraConnection, Update-IoraRuntimeState, Clear-IoraStaleRuntimeState
