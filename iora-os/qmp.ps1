# ============================================================================
# qmp.ps1 - IORA Dev VM hypervisor control over QEMU Machine Protocol
# ============================================================================
# Windows twin of qmp.sh: controls QEMU itself (not the guest) - the same
# channel Proxmox uses. Together with qga.ps1 the VM is no black box.
#
#   .\qmp.ps1 status                    # running/paused + CPU/RAM/block info
#   .\qmp.ps1 ps | list                  # aliases for status
#   .\qmp.ps1 pause | resume            # freeze / unfreeze the VM
#   .\qmp.ps1 powerdown | reset
#   .\qmp.ps1 screenshot <file.png>     # PNG of the VM console
#   .\qmp.ps1 sendkey <qcode>           # e.g. enter, f1, ctrl-alt-delete
#   .\qmp.ps1 hmp "info block"          # any HMP monitor command
#   .\qmp.ps1 balloon 4096              # set VM RAM (needs virtio-balloon)
#   .\qmp.ps1 net off|on                # disconnect/reconnect the VM NIC
#   .\qmp.ps1 help                      # this overview
#
# Socket: localhost:<QmpPort> (default 8130, auto-picked when busy).
# Protocol: QMP JSON with capabilities handshake.
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("status", "ps", "list", "info", "pause", "resume", "powerdown", "reset", "screenshot", "sendkey", "hmp", "balloon", "net", "help")]
    [string]$Action = "status",
    [Parameter(Position = 1)]
    [string]$Arg1 = "",
    [Parameter(Position = 2)]
    [string]$Arg2 = "",
    [int]$QmpPort = 0,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$CACHE = Join-Path $SCRIPT_DIR ".cache"
$statePath = Join-Path $CACHE "runtime-state.json"
if ($QmpPort -eq 0 -and (Test-Path $statePath)) {
    try { $QmpPort = [int](Get-Content $statePath -Raw | ConvertFrom-Json).qmpPort } catch { }
}
if ($QmpPort -eq 0) { $QmpPort = 8130 }

# -- Low-level: QMP command with capabilities handshake ---------------------
# QEMU can interleave asynchronous events ({"event":...}) with command
# responses at any point. A single ReadLine may return an event instead of
# the reply - which made "status" report empty fields. Read until a line
# that is an actual response (has a "return" or "error" member) arrives.
function Read-QmpResponse {
    param($Reader)
    while ($true) {
        $line = $Reader.ReadLine()
        if ($null -eq $line) { return $null }
        if ($line -match '"(return|error)"') { return $line.Trim() }
    }
}

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
        # .NET Framework's [Text.Encoding]::UTF8 emits a BOM; the StreamWriter
        # would prefix every command with EF BB BF and QEMU answers with
        # "JSON parse error, stray '\uFFFD'" (shifting every response by one)
        # - use a BOM-less encoding like the raw-byte qga channel does.
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        $writer = New-Object System.IO.StreamWriter($stream, $utf8NoBom)
        $writer.NewLine = "`n"
        $writer.AutoFlush = $true
        # Handshake: greeting -> qmp_capabilities -> ack (skip events)
        [void]$reader.ReadLine()
        $writer.WriteLine('{"execute":"qmp_capabilities"}')
        if ($null -eq (Read-QmpResponse $reader)) { return $null }
        $writer.WriteLine($Json)
        return Read-QmpResponse $reader
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
function Show-QmpUsage {
    Write-Host "Usage: .\qmp.ps1 <action> [args]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  status                    running/paused + CPU/RAM/block info"
    Write-Host "  ps | list                 aliases for status"
    Write-Host "  pause | resume            freeze / unfreeze the VM"
    Write-Host "  powerdown | reset         ACPI shutdown / hard reset"
    Write-Host "  screenshot <file.png>     PNG of the VM console"
    Write-Host "  sendkey <qcode>           e.g. enter, f1, ctrl-alt-delete"
    Write-Host "  hmp ""info block""          any HMP monitor command"
    Write-Host "  balloon <mb>              set VM RAM (needs virtio-balloon)"
    Write-Host "  net off|on                disconnect/reconnect the VM NIC"
    Write-Host "  help                      this overview"
    Write-Host ""
    Write-Host "Socket: 127.0.0.1:$QmpPort (auto-picked when busy, stored in .cache/runtime-state.json)"
}

if ($Help) { Show-QmpUsage; exit 0 }

function Show-QmpStatus {
    $st = Invoke-QmpJson '{"execute":"query-status"}'
    if (-not $st) { Write-Host "[X] QMP not reachable on 127.0.0.1:$QmpPort - is the VM running?" -ForegroundColor Red; exit 1 }
    $status = Get-QmpField -Json $st -Key "return.status"
    if (-not $status) {
        Write-Host "[X] unexpected QMP response: $st" -ForegroundColor Red
        exit 1
    }
    Write-Host "VM status: $status"
    $cpus = Invoke-QmpJson '{"execute":"query-cpus-fast"}'
    $cpuCount = "n/a"
    try {
        $arr = $cpus | ConvertFrom-Json
        $cpuCount = @($arr.return).Count
    } catch { }
    Write-Host "vCPUs : $cpuCount"
    $mem = Invoke-QmpJson '{"execute":"query-memory-size-summary"}'
    $memMb = "n/a"
    try {
        $r = $mem | ConvertFrom-Json
        $memMb = [Math]::Round($r.return.'base-memory' / 1GB, 1)
    } catch { }
    Write-Host "RAM   : $memMb GB (balloonable)"
    $blk = Invoke-QmpJson '{"execute":"query-block"}'
    try {
        $devs = @($blk | ConvertFrom-Json | Select-Object -ExpandProperty return)
        Write-Host ("Disks : " + (($devs | ForEach-Object { $_.device }) -join ", "))
    } catch {
        Write-Host "Disks : n/a"
    }
    $up = Invoke-QmpJson '{"execute":"query-uptime"}'
    $uptime = Get-QmpField -Json $up -Key "return.uptime"
    if ($uptime) {
        $ts = [TimeSpan]::FromSeconds([int64]$uptime)
        Write-Host "Uptime: $($ts.Days)d $($ts.Hours)h $($ts.Minutes)m"
    }
}

switch ($Action) {
    "status"    { Show-QmpStatus }
    "ps"        { Show-QmpStatus }
    "list"      { Show-QmpStatus }
    "info"      { Show-QmpStatus }
    "help"      { Show-QmpUsage }
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
