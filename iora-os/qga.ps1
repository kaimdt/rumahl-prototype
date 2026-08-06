# ============================================================================
# qga.ps1 - IORA Dev VM control over the QEMU Guest Agent (no IP needed)
# ============================================================================
# Windows twin of qga.sh: talks to the dev VM through the virtio-serial
# channel (qemu-guest-agent) over a localhost TCP socket. Works even when
# the VM has NO network/IP - the primary control channel for the dev loop:
#
#   .\qga.ps1 ping                          # is the agent reachable?
#   .\qga.ps1 status                         # ping + agent version
#   .\qga.ps1 exec "systemctl status iora-home"
#   .\qga.ps1 exec "journalctl -u iora-home -n 30"
#   .\qga.ps1 read C:\...\.cache  -> prints /etc/iora/iora-home.env
#   .\qga.ps1 read /etc/iora/iora-home.env
#   .\qga.ps1 write /tmp/test.txt "hello"
#   .\qga.ps1 reboot / shutdown
#   .\qga.ps1 help
#
# Socket: localhost:<QgaPort> (default 8109, auto-picked when busy).
# Protocol: JSON lines, base64 for file/output data.
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("ping", "status", "exec", "read", "write", "reboot", "shutdown", "help")]
    [string]$Action = "ping",
    [Parameter(Position = 1)]
    [string]$Arg1 = "",
    [Parameter(Position = 2)]
    [string]$Arg2 = "",
    [int]$QgaPort = 0,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$CACHE = Join-Path $SCRIPT_DIR ".cache"
$statePath = Join-Path $CACHE "runtime-state.json"
if ($QgaPort -eq 0 -and (Test-Path $statePath)) {
    try { $QgaPort = [int](Get-Content $statePath -Raw | ConvertFrom-Json).qgaPort } catch { }
}
if ($QgaPort -eq 0) { $QgaPort = 8109 }

# -- Low-level: send one JSON line, read one JSON line back -----------------
function Invoke-QgaJson {
    param([string]$Json, [int]$TimeoutSec = 10)
    $client = $null
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $QgaPort, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(3000)) {
            return $null
        }
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

function Get-QgaJsonField {
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
function Show-QgaUsage {
    Write-Host "Usage: .\qga.ps1 <action> [args]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  ping                      is the guest agent reachable?"
    Write-Host "  status                    ping + agent version"
    Write-Host "  exec ""<command>""           run a shell command in the VM"
    Write-Host "  read <path>               print a file from the VM"
    Write-Host "  write <path> <content>    write a file in the VM"
    Write-Host "  reboot | shutdown         guest OS reboot / ACPI shutdown"
    Write-Host "  help                      this overview"
    Write-Host ""
    Write-Host "Socket: 127.0.0.1:$QgaPort (auto-picked when busy, stored in .cache/runtime-state.json)"
}

if ($Help) { Show-QgaUsage; exit 0 }

function Invoke-QgaPing {
    $resp = Invoke-QgaJson '{"execute":"guest-ping"}'
    if ($resp -match '"return"') { Write-Host "OK" } else { Write-Host "[X] no reply - is the VM running? (qga chardev on 127.0.0.1:$QgaPort)" -ForegroundColor Red; exit 1 }
}

function Invoke-QgaStatus {
    $resp = Invoke-QgaJson '{"execute":"guest-ping"}'
    if ($resp -notmatch '"return"') { Write-Host "[X] no reply - is the VM running? (qga chardev on 127.0.0.1:$QgaPort)" -ForegroundColor Red; exit 1 }
    $info = Invoke-QgaJson '{"execute":"guest-info"}'
    $version = Get-QgaJsonField -Json $info -Key "return.version"
    # QGA uses underscore keys (supported_commands) - the hyphen form would
    # silently return null and report "0 commands".
    $supports = @(($info | ConvertFrom-Json).return.supported_commands).Count
    Write-Host "OK - QEMU Guest Agent $version ($supports commands)"
}

function Invoke-QgaExec {
    param([string]$Command, [int]$TimeoutSec = 120)
    $cmdJson = $Command | ConvertTo-Json
    $resp = Invoke-QgaJson ('{"execute":"guest-exec","arguments":{"path":"/bin/sh","arg":["-c",' + $cmdJson + '],"capture-output":true}}')
    if (-not $resp) { Write-Host "[X] guest-exec failed (no reply)" -ForegroundColor Red; exit 1 }
    $execPid = Get-QgaJsonField -Json $resp -Key "return.pid"
    if (-not $execPid) { Write-Host "[X] guest-exec failed: $resp" -ForegroundColor Red; exit 1 }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $st = Invoke-QgaJson ('{"execute":"guest-exec-status","arguments":{"pid":' + $execPid + '}}')
        if (-not $st) { continue }
        $exitCode = Get-QgaJsonField -Json $st -Key "return.exitcode"
        if ($exitCode -ne "") {
            $outData = Get-QgaJsonField -Json $st -Key "return.out-data"
            if ($outData) {
                try {
                    Write-Host ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($outData))) -NoNewline
                } catch { }
            }
            if ($exitCode -eq "0") { exit 0 } else { exit 1 }
        }
    }
    Write-Host "[X] guest-exec timed out" -ForegroundColor Red
    exit 1
}

function Read-QgaFile {
    param([string]$Path)
    $resp = Invoke-QgaJson ('{"execute":"guest-file-open","arguments":{"path":"' + $Path + '","mode":"r"}}')
    $handle = Get-QgaJsonField -Json $resp -Key "return"
    if (-not $handle) { Write-Host "[X] guest-file-open failed: $resp" -ForegroundColor Red; exit 1 }
    $data = Invoke-QgaJson ('{"execute":"guest-file-read","arguments":{"handle":' + $handle + ',"count":1048576}}')
    $buf = Get-QgaJsonField -Json $data -Key "return.buf-data"
    if ($buf) {
        Write-Host ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($buf))) -NoNewline
    }
    Invoke-QgaJson ('{"execute":"guest-file-close","arguments":{"handle":' + $handle + '}}') | Out-Null
}

function Write-QgaFile {
    param([string]$Path, [string]$Content)
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Content))
    $resp = Invoke-QgaJson ('{"execute":"guest-file-open","arguments":{"path":"' + $Path + '","mode":"w"}}')
    $handle = Get-QgaJsonField -Json $resp -Key "return"
    if (-not $handle) { Write-Host "[X] guest-file-open (write) failed: $resp" -ForegroundColor Red; exit 1 }
    Invoke-QgaJson ('{"execute":"guest-file-write","arguments":{"handle":' + $handle + ',"buf-b64":"' + $b64 + '"}}') | Out-Null
    Invoke-QgaJson ('{"execute":"guest-file-close","arguments":{"handle":' + $handle + '}}') | Out-Null
    Write-Host "written: $Path"
}

switch ($Action) {
    "ping"     { Invoke-QgaPing }
    "status"   { Invoke-QgaStatus }
    "exec"     { Invoke-QgaExec -Command $Arg1 }
    "read"     { Read-QgaFile -Path $Arg1 }
    "write"    { Write-QgaFile -Path $Arg1 -Content $Arg2 }
    "reboot"   { Invoke-QgaJson '{"execute":"guest-reboot"}' | Out-Null; Write-Host "reboot sent" }
    "shutdown" { Invoke-QgaJson '{"execute":"guest-shutdown"}' | Out-Null; Write-Host "shutdown sent" }
    "help"     { Show-QgaUsage }
}
