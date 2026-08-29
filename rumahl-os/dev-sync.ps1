# ============================================================================
# dev-sync.ps1 - rumahl Dev VM continuous source sync (Windows native)
# ============================================================================
# Windows 10/11 + WSL2-NAT: the VM's forwarded ports (SSH 2222, Vite 5173)
# live on the Windows loopback (127.0.0.1). WSL2 NAT cannot reach that
# address, so the bash-based dev-sync.sh fails with "host unreachable" even
# though the Windows SSH client reaches the VM perfectly.
#
# This Windows-native watcher pushes changed source files into the 1:1 mirror
# (/home/ora/ora) with the Win32 OpenSSH `scp` client (proven reliable). Vite
# HMR inside the VM reloads on the next write, so the mirror stays live.
#
# It mirrors the repository to the VM with `--delete`-like semantics by
# tracking the set of files it has already sent: deleted host files are
# removed from the VM, and the mirror path /<repo> maps to /home/ora/ora.
# node_modules/.git/.cache/target/build artifacts are never sent.
#
# Usage:
#   .\dev-sync.ps1 --vm-host 127.0.0.1 --vm-port 2222 --ssh-key <key>
#   .\dev-sync.ps1 --once                              (single push, then exit)
#   .\dev-sync.ps1 --help
# ============================================================================
[CmdletBinding()]
param(
    [string]$VmHost = "127.0.0.1",
    [int]$VmPort = 2222,
    [string]$SshKey,
    [switch]$Once,
    [int]$IntervalMs = 800,
    [switch]$Quiet,
    [switch]$Help
)

$ErrorActionPreference = "Continue"

# Note: parameters below use PowerShell's native single-dash convention
# (e.g. -vm-host 127.0.0.1). Callers inside this repo pass them that way.

if ($Help) {
    @"
rumahl Dev VM continuous source sync (Windows native)

The VM mirrors the repo at /home/ora/ora. This script watches the host repo and
pushes changed files into the mirror via Windows-native scp (works under WSL2
NAT where the bash mirror does not).

Usage:
  .\dev-sync.ps1 -vm-host 127.0.0.1 -vm-port 2222 -ssh-key <key>
  .\dev-sync.ps1 -once
"@ | ForEach-Object { Write-Host $_ }
    exit 0
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (& git -C $ScriptDir rev-parse --show-toplevel 2>$null)
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $ScriptDir }
if (-not $SshKey) { $SshKey = Join-Path $ScriptDir ".cache\rumahl-dev-key" }

if (-not (Test-Path $SshKey)) {
    Write-Error "SSH key not found: $SshKey (start the VM first)."
    exit 1
}
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) {
    Write-Error "OpenSSH client not found. Install: Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
    exit 1
}
if (-not (Get-Command scp.exe -ErrorAction SilentlyContinue)) {
    Write-Error "scp.exe not found (OpenSSH client)."
    exit 1
}

# --- SSH / scp options -------------------------------------------------------
$SshOpts = @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "-o", "AddressFamily=inet",
    "-o", "LogLevel=ERROR"
)
$Ssh = "ssh.exe"; $Scp = "scp.exe"

function Invoke-Ssh { param([string]$Cmd)
    & $Ssh @SshOpts -i $SshKey -p $VmPort "root@$VmHost" $Cmd 2>$null
    return $LASTEXITCODE
}

# --- Watch state: files we have already pushed ------------------------------
$sent = @{}
$statePath = Join-Path $ScriptDir ".cache\dev-sync-sent.json"
if (Test-Path $statePath) {
    try { $sent = @(Get-Content $statePath -Raw | ConvertFrom-Json) } catch {}
}
# { } from ConvertFrom-Json of an object; normalise to a set of keys
$sentSet = @{}
foreach ($k in $sent) { if ($k -is [string]) { $sentSet[$k] = $true } }

$ExcludedDirs = @('.git', 'node_modules', '.cache', 'target', '.rumahl-dev', 'dist', 'buildroot-*', 'releases', '.venv')
function Test-Excluded { param([string]$Rel)
    $parts = $Rel -split '[\\/]'
    foreach ($p in $parts) {
        if ($ExcludedDirs -contains $p) { return $true }
        if ($p -like 'buildroot-*' -or $p -eq '.ghq' -or $p -eq 'releases') { return $true }
        if ($p -like '*.img' -or $p -like '*.gcow2' -or $p -like '*.iso' -or $p -like '*.tar.gz') { return $true }
    }
    return $false
}

# --- Push a batch of changed files -------------------------------------------
function Push-Batch {
    param([string[]]$Changes)
    foreach ($rel in $Changes) {
        $src = Join-Path $RepoRoot $rel
        if (-not (Test-Path $src)) {
            # Deleted on the host -> remove from the mirror
            $remoteRel = $rel -replace '\\', '/'
            $remote = "root@$($VmHost):/home/ora/ora/$remoteRel"
            & $Ssh @SshOpts -i $SshKey -p $VmPort "root@$VmHost" "rm -f '/home/ora/ora/$remoteRel'" 2>$null | Out-Null
            continue
        }
        $remoteRel = $rel -replace '\\', '/'
        $remote = "root@$($VmHost):/home/ora/ora/$remoteRel"
        if (-not $Quiet) { Write-Host ("  + {0}" -f $remoteRel) }
        & $Scp @SshOpts -i $SshKey -P $VmPort "$src" $remote 2>$null
        if ($LASTEXITCODE -eq 0) { $sentSet[$rel] = $true }
    }
}

# --- One full mirror (push everything the first time or on --once) -----------
function Invoke-FullSync {
    $files = @(Get-ChildItem -Path $RepoRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $rel = $_.FullName.Substring($RepoRoot.Length + 1)
            (-not (Test-Excluded $rel)) -and (-not $_.FullName.Contains("\.cache\")) -and (-not $_.FullName.Contains("\node_modules\"))
        } | ForEach-Object { $_.FullName.Substring($RepoRoot.Length + 1) })
    # Only send files we haven't already sent (incremental)
    $toSend = @($files | Where-Object { -not $sentSet.ContainsKey($_) })
    if ($toSend.Count -gt 0) {
        Write-Host ("Mirror: {0} new/changed files" -f $toSend.Count)
        Push-Batch -Changes $toSend
    } else {
        if (-not $Quiet) { Write-Host "Mirror: no changes" }
    }
    # Persist sent-set
    $sentSet.Keys | ConvertTo-Json | Set-Content $statePath -Encoding UTF8
}

# --- Watch loop --------------------------------------------------------------
function Test-Reachable {
    $out = & $Ssh @SshOpts -i $SshKey -p $VmPort "root@$VmHost" "true" 2>$null
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-Reachable)) {
    Write-Warn "VM not reachable at root@${VmHost}:${VmPort} - waiting for it to come up..."
}
if ($Once) {
    Invoke-FullSync
    exit 0
}

Invoke-FullSync

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $RepoRoot
$watcher.IncludeSubdirectories = $true
# Send changed, created, renamed and deleted events
$watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::FileName -bor [IO.NotifyFilters]::DirectoryName -bor [IO.NotifyFilters]::Size
$queued = New-Object System.Collections.Generic.HashSet[string]
$queueLock = New-Object System.Threading.Mutex($false)
$debounce = [int]$IntervalMs

$handler = {
    param($Source, $EventArgs)
    $full = $EventArgs.FullPath
    if (-not $full) { return }
    $rel = $full.Substring($RepoRoot.Length + 1)
    if ($null -eq $rel -or "" -eq $rel) { return }
    if (Test-Excluded $rel) { return }
    if ($null -ne $EventArgs.ChangeType -and $EventArgs.ChangeType -eq [IO.WatcherChangeTypes]::Directory) { return }
    $null = $queueLock.WaitOne(2000)
    try { [void]$queued.Add($rel) } finally { $queueLock.ReleaseMutex() }
}

$events = Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $handler
$events = Register-ObjectEvent -InputObject $watcher -EventName Created -Action $handler
$events = Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $handler
$events = Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action $handler
$watcher.EnableRaisingEvents = $true

Write-Host ("Watching {0} -> root@{1}:{2}:/home/ora/ora (Ctrl+C to stop)" -f $RepoRoot, $VmHost, $VmPort)

try {
    while ($true) {
        Start-Sleep -Milliseconds $debounce
        $toPush = @()
        $null = $queueLock.WaitOne(5000)
        try {
            if ($queued.Count -gt 0) {
                $toPush = @($queued | Select-Object -First 500)
                $queued.Clear()
            }
        } finally { $queueLock.ReleaseMutex() }
        if ($toPush.Count -gt 0) {
            if (-not (Test-Reachable)) {
                if (-not $Quiet) { Write-Warn "VM unreachable - skipping push" }
                continue
            }
            Push-Batch -Changes $toPush
            $sentSet.Keys | ConvertTo-Json | Set-Content $statePath -Encoding UTF8
        }
    }
} finally {
    $watcher.EnableRaisingEvents = $false
    Get-EventSubscriber | Where-Object { $_.SourceObject -eq $watcher } | ForEach-Object { Unregister-Event -SubscriptionId $_.SubscriptionId -ErrorAction SilentlyContinue }
    $watcher.Dispose()
}
