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
# It is EVENT-DRIVEN (a FileSystemWatcher), not a full mirror: the VM is
# seeded during provisioning, so this only ships the files you edit. Only the
# source trees the VM mirrors are watched (frontend/src, frontend/public,
# rumahl-os/backend, apps, sdks, docs, custom_components) - huge artifact
# dirs (node_modules, target, .cache, images) are never enumerated.
#
# Usage:
#   pwsh -File dev-sync.ps1 -vm-host 127.0.0.1 -vm-port 2222 -ssh-key <key>
#   pwsh -File dev-sync.ps1 ... -once      (push tracked-changed files once)
#   pwsh -File dev-sync.ps1 ... -help
# ============================================================================
# Manual argument parsing (robust across `pwsh -File` and direct invocation;
# avoids an environment-specific typed-param parser quirk). Accepts both
# `-vm-host X` and `--vm-host X` forms.
param()
$VmHost = "127.0.0.1"; $VmPort = 2222; $SshKey = $null
$Once = $false; $Quiet = $false; $Help = $false; $IntervalMs = 800
$raw = @($args)
for ($i = 0; $i -lt $raw.Count; $i++) {
    $a = [string]$raw[$i]
    switch -Regex ($a) {
        '^--?vm-(host|Host)$'   { if ($i + 1 -lt $raw.Count) { $VmHost = [string]$raw[++$i] } }
        '^--?vm-(port|Port)$'   { if ($i + 1 -lt $raw.Count) { $VmPort = [int]$raw[++$i] } }
        '^--?ssh-(key|Key)$'    { if ($i + 1 -lt $raw.Count) { $SshKey = [string]$raw[++$i] } }
        '^--?interval-ms$'      { if ($i + 1 -lt $raw.Count) { $IntervalMs = [int]$raw[++$i] } }
        '^--?once$'             { $Once = $true }
        '^--?quiet$'            { $Quiet = $true }
        '^--?help$'             { $Help = $true }
    }
}

$ErrorActionPreference = "Continue"

if ($Help) {
    @"
rumahl Dev VM continuous source sync (Windows native)

The VM mirrors the repo at /home/ora/ora (seeded during provisioning). This
watcher ships the source files you edit into the mirror via Windows-native scp
(works under WSL2 NAT where the bash mirror does not). It is event-driven, so
it never walks the whole repo - only the edited files are transferred.

Usage:
  pwsh -File dev-sync.ps1 -vm-host 127.0.0.1 -vm-port 2222 -ssh-key <key>
  pwsh -File dev-sync.ps1 ... -once      (transfer tracked changed files once)
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

# --- Watched source subtrees (relative to the repo root) ---------------------
# The VM mirrors these. Huge artifact dirs are never watched.
$WatchedRoots = @('frontend\src', 'frontend\public', 'frontend\index.html', 'rumahl-os\backend', 'apps', 'sdks', 'docs', 'custom_components')
$ExcludedDirs = @('.git', 'node_modules', '.cache', 'target', '.rumahl-dev', 'dist', 'build', '.venv', 'releases', 'output', 'vendor')

function Test-Excluded { param([string]$Rel)
    $parts = $Rel -split '[\\/]'
    foreach ($p in $parts) {
        if ($ExcludedDirs -contains $p) { return $true }
        if ($p -like 'buildroot-*' -or $p -eq '.ghq') { return $true }
        if ($p -like '*.img' -or $p -like '*.qcow2' -or $p -like '*.iso' -or $p -like '*.tar.gz') { return $true }
    }
    return $false
}

# Is a path inside one of the watched subtrees?
function Test-Watched { param([string]$Rel)
    foreach ($root in $WatchedRoots) {
        $norm = $Rel -replace '/', '\'
        if ($norm -eq $root -or $norm.StartsWith("$root\")) { return $true }
    }
    return $false
}

# --- Push a batch of changed files -------------------------------------------
function Push-Batch {
    param([int[]]$Indexes, [hashtable]$ByRel)
    foreach ($relKey in $ByRel.Keys) {
        $src = Join-Path $RepoRoot $relKey
        $remoteRel = $relKey -replace '\\', '/'
        if (-not $src -or -not (Test-Path $src)) {
            # Deleted on the host -> remove from the mirror
            & ssh.exe @SshOpts -i $SshKey -p $VmPort "root@$VmHost" "rm -f '/home/ora/ora/$remoteRel'" 2>$null | Out-Null
            continue
        }
        $remote = "root@$($VmHost):/home/ora/ora/$remoteRel"
        if (-not $Quiet) { Write-Host ("  + {0}" -f $remoteRel) }
        & scp.exe @SshOpts -i $SshKey -P $VmPort "$src" $remote 2>$null
    }
}

# --- Reachability ------------------------------------------------------------
function Test-Reachable {
    & ssh.exe @SshOpts -i $SshKey -p $VmPort "root@$VmHost" "true" 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

# --- Persisted last-sync snapshot (relative path -> last write time) ---------
# Used so `-once`/startup only transfers files edited since the last run,
# instead of enumerating the whole mirror.
$statePath = Join-Path $ScriptDir ".cache\dev-sync-state.json"
$lastSeen = @{}
if (Test-Path $statePath) {
    try { $loaded = Get-Content $statePath -Raw | ConvertFrom-Json -AsHashtable; $lastSeen = $loaded } catch {}
}
function Save-State {
    $lastSeen | ConvertTo-Json -Depth 1 | Set-Content $statePath -Encoding UTF8
}

# --- Collect changed files since last-seen (only in watched trees) -----------
function Get-ChangedFiles {
    $changed = @{}
    foreach ($root in $WatchedRoots) {
        $full = Join-Path $RepoRoot $root
        if (-not (Test-Path $full)) { continue }
        if (Test-Path $full -PathType Leaf) {
            # A single file (e.g. frontend/index.html)
            $rel = $root -replace '[\\/]+', '\'
            $mtime = (Get-Item $full).LastWriteTimeUtc.Ticks
            if ($lastSeen.ContainsKey($rel)) { if ($lastSeen[$rel] -ne $mtime) { $changed[$rel] = $mtime } }
            else { $changed[$rel] = $mtime }
            continue
        }
        Get-ChildItem -Path $full -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = $_.FullName.Substring($RepoRoot.Length + 1) -replace '\\', '\'
            if (Test-Excluded $rel) { return }
            $mtime = $_.LastWriteTimeUtc.Ticks
            if ($lastSeen.ContainsKey($rel)) { if ($lastSeen[$rel] -ne $mtime) { $changed[$rel] = $mtime } }
            else { $changed[$rel] = $mtime }
        }
    }
    return $changed
}

# --- Initial sync (no full walk; only files changed since the last run) ------
if (-not (Test-Reachable)) {
    Write-Warn "VM not reachable at root@${VmHost}:${VmPort} - waiting..."
    # Wait up to ~60s for the VM
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-Reachable) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
    if (-not (Test-Reachable)) { Write-Warn "VM still unreachable - watching anyway (pushes will resume when it returns)." }
}

if (Test-Reachable) {
    $initial = Get-ChangedFiles
    if ($initial.Count -gt 0) {
        if (-not $Quiet) { Write-Host ("Initial: {0} changed file(s) since last sync" -f $initial.Count) }
        Push-Batch -ByRel $initial
        foreach ($k in $initial.Keys) { $lastSeen[$k] = $initial[$k] }
        Save-State
    } elseif (-not $Quiet) {
        Write-Host "Initial: no changes since last sync"
    }
}
if ($Once) {
    exit 0
}

# --- Watch loop --------------------------------------------------------------
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $RepoRoot
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::FileName -bor [IO.NotifyFilters]::DirectoryName -bor [IO.NotifyFilters]::Size
$queued = New-Object System.Collections.Generic.HashSet[string]
$queueLock = New-Object System.Threading.Mutex($false)

$handler = {
    param($Source, $EventArgs)
    $full = $EventArgs.FullPath
    if (-not $full) { return }
    if ($EventArgs.ChangeType -eq [IO.WatcherChangeTypes]::Directory) { return }
    $rel = $full.Substring($RepoRoot.Length + 1) -replace '\\', '\'
    if (-not (Test-Watched $rel)) { return }
    if (Test-Excluded $rel) { return }
    $null = $queueLock.WaitOne(2000)
    try { [void]$queued.Add($rel) } finally { $queueLock.ReleaseMutex() }
}
$null = Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $handler
$null = Register-ObjectEvent -InputObject $watcher -EventName Created -Action $handler
$null = Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $handler
$null = Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action $handler
$watcher.EnableRaisingEvents = $true

Write-Host ("Watching source trees -> root@{0}:{1}:/home/ora/ora (Ctrl+C to stop)" -f $VmHost, $VmPort)

# Seed state so we never re-push unchanged files on the next startup.
foreach ($root in $WatchedRoots) {
    $full = Join-Path $RepoRoot $root
    if (Test-Path $full -PathType Leaf) {
        $rel = $root -replace '[\\/]+', '\'
        $lastSeen[$rel] = (Get-Item $full).LastWriteTimeUtc.Ticks
    } elseif (Test-Path $full) {
        Get-ChildItem -Path $full -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = $_.FullName.Substring($RepoRoot.Length + 1) -replace '\\', '\'
            if (-not (Test-Excluded $rel)) { $lastSeen[$rel] = $_.LastWriteTimeUtc.Ticks }
        }
    }
}
Save-State

try {
    while ($true) {
        Start-Sleep -Milliseconds ([int]$IntervalMs)
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
            $byRel = @{}
            foreach ($rel in $toPush) {
                $full = Join-Path $RepoRoot $rel
                if (Test-Path $full) { $byRel[$rel] = (Get-Item $full).LastWriteTimeUtc.Ticks }
                else { $byRel[$rel] = 0 }
            }
            Push-Batch -ByRel $byRel
            foreach ($rel in $byRel.Keys) {
                if (Test-Path (Join-Path $RepoRoot $rel)) { $lastSeen[$rel] = $byRel[$rel] }
                else { $lastSeen.Remove($rel) }
            }
            Save-State
        }
    }
} finally {
    $watcher.EnableRaisingEvents = $false
    Get-EventSubscriber | Where-Object { $_.SourceObject -eq $watcher } | ForEach-Object { Unregister-Event -SubscriptionId $_.SubscriptionId -ErrorAction SilentlyContinue }
    $watcher.Dispose()
}
