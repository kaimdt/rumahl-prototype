# ============================================================================
# qmp.ps1 - IORA Dev VM hypervisor control over QEMU Machine Protocol
# ============================================================================
# Windows twin of qmp.sh: controls QEMU itself (not the guest) - the same
# channel Proxmox uses. Together with qga.ps1 the VM is no black box.
#
#   .\qmp.ps1 status                    # running/paused + CPU/RAM/block info
#   .\qmp.ps1 pause | resume            # freeze / unfreeze the VM
#   .\qmp.ps1 powerdown | reset
#   .\qmp.ps1 screenshot <file.png>     # PNG of the VM console
#   .\qmp.ps1 sendkey <qcode>           # e.g. enter, f1, ctrl-alt-delete
#   .\qmp.ps1 hmp "info block"          # any HMP monitor command
#   .\qmp.ps1 balloon 4096              # set VM RAM (needs virtio-balloon)
#   .\qmp.ps1 net off|on                # disconnect/reconnect the VM NIC
#
# Socket: localhost:<QmpPort> (default 8130, auto-picked when busy).
# Protocol: QMP JSON with capabilities handshake.
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("status", "info", "pause", "resume", "powerdown", "reset", "screenshot", "sendkey", "hmp", "balloon", "net")]
    [string]$Action = "status",
    [Parameter(Position = 1)]
    [string]$Arg1 = "",
    [Parameter(Position = 2)]
    [string]$Arg2 = "",
    [int]$QmpPort = 8130
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$CACHE = Join-Path $SCRIPT_DIR ".cache"

# -- Low-level: QMP command with capabilities handshake ---------------------
function Invoke-QmpJson {
    param([string]$Json, [int]$TimeoutSec = 10)
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $QmpPort, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(3000)) { return $null }
        $client.EndConnect($iar)
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        $writer = New-Object System.IO.StreamWriter($stream, [System.Text.Encoding]::UTF8)
        $writer.NewLine = "`n"
        $writer.AutoFlush = $true
        # Handshake: greeting -> qmp_capabilities -> ack
        [void]$reader.ReadLine()
        $writer.WriteLine('{"execute":"qmp_capabilities"}')
        [void]$reader.ReadLine()
        $writer.WriteLine($Json)
        $line = $reader.ReadLine()
        if ($null -eq $line) { return $null }
        return $line.Trim()
    } catch {
        return $null
    } finally {
        if ($client) { $client.Close() }
    }
}

function Get-QmpField {
    param([string]$Json, [string]$Key)
    try {
        $obj = $Json | ConvertFrom-Json
        $parts = $Key.Split('.')
        $cur = $obj
        foreach ($p in $parts) {
            if ($null -eq $cur) { return "" }
            $cur = $cur.($p)
        }
        if ($null -eq $cur) { return "" }
        return [string]$cur
    } catch { return "" }
}

# -- Commands ---------------------------------------------------------------
function Show-QmpStatus {
    $st = Invoke-QmpJson '{"execute":"query-status"}'
    if (-not $st) { Write-Host "[X] QMP not reachable - is the VM running?" -ForegroundColor Red; exit 1 }
    $status = Get-QmpField -Json $st -Key "return.status"
    Write-Host "VM status: $status"
    $cpus = Invoke-QmpJson '{"execute":"query-cpus-fast"}'
    $cpuCount = 0
    try {
        $arr = $cpus | ConvertFrom-Json
        $cpuCount = @($arr.return).Count
    } catch { }
    Write-Host "vCPUs : $cpuCount"
    $mem = Invoke-QmpJson '{"execute":"query-memory-size-summary"}'
    $memMb = ""
    try {
        $r = $mem | ConvertFrom-Json
        $memMb = [Math]::Round($r.return.'base-memory' / 1GB, 1)
    } catch { }
    Write-Host "RAM   : $memMb GB (balloonable)"
    $blk = Invoke-QmpJson '{"execute":"query-block"}'
    try {
        $devs = @($blk | ConvertFrom-Json | Select-Object -ExpandProperty return)
        Write-Host ("Disks : " + (($devs | ForEach-Object { $_.device }) -join ", "))
    } catch { }
}

switch ($Action) {
    "status"    { Show-QmpStatus }
    "info"      { Show-QmpStatus }
    "pause"     { $r = Invoke-QmpJson '{"execute":"stop"}'; if ($r -match '"return"') { Write-Host "paused" } else { Write-Host "[X] $r" -ForegroundColor Red } }
    "resume"    { $r = Invoke-QmpJson '{"execute":"cont"}'; if ($r -match '"return"') { Write-Host "resumed" } else { Write-Host "[X] $r" -ForegroundColor Red } }
    "powerdown" { Invoke-QmpJson '{"execute":"system_powerdown"}' | Out-Null; Write-Host "powerdown sent" }
    "reset"     { Invoke-QmpJson '{"execute":"system_reset"}' | Out-Null; Write-Host "reset sent" }
    "screenshot" {
        $out = if ($Arg1) { $Arg1 } else { Join-Path $CACHE "vm-screenshot.png" }
        $fn = $out | ConvertTo-Json
        $r = Invoke-QmpJson ('{"execute":"screendump","arguments":{"filename":' + $fn + '}}')
        if ($r -match '"return"') { Write-Host "screenshot: $out" } else { Write-Host "[X] screendump failed: $r" -ForegroundColor Red }
    }
    "sendkey" {
        $key = if ($Arg1) { $Arg1 } else { "enter" }
        $r = Invoke-QmpJson ('{"execute":"sendkey","arguments":{"keys":[{"type":"qcode","data":"' + $key + '"}]}}')
        if ($r -match '"return"') { Write-Host "key sent: $key" } else { Write-Host "[X] sendkey failed: $r" -ForegroundColor Red }
    }
    "hmp" {
        $cmd = $Arg1 | ConvertTo-Json
        $r = Invoke-QmpJson ('{"execute":"human-monitor-command","arguments":{"command-line":' + $cmd + '}}')
        $out = Get-QmpField -Json $r -Key "return"
        Write-Host $out
    }
    "balloon" {
        $mb = if ($Arg1) { $Arg1 } else { "4096" }
        $r = Invoke-QmpJson ('{"execute":"balloon","arguments":{"value":' + $mb + '}}')
        if ($r -match '"return"') { Write-Host "balloon set to $mb MB" } else { Write-Host "[X] balloon failed: $r" -ForegroundColor Red }
    }
    "net" {
        switch ($Arg1) {
            "off" { $r = Invoke-QmpJson '{"execute":"set_link","arguments":{"name":"n0","up":false}}'; if ($r -match '"return"') { Write-Host "NIC disconnected" } }
            "on"  { $r = Invoke-QmpJson '{"execute":"set_link","arguments":{"name":"n0","up":true}}'; if ($r -match '"return"') { Write-Host "NIC connected" } }
            default { Write-Host "Usage: .\qmp.ps1 net off|on" -ForegroundColor Yellow }
        }
    }
}
