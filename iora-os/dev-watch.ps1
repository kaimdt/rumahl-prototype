# ============================================================================
# dev-watch.ps1 - IORA OS Dev-Loop (Windows host)
# ============================================================================
# Watches the Rust workspace and frontend, cross-compiles for Linux, uploads
# changed binaries via SSH and restarts the corresponding systemd services on
# the dev VM started by dev-local.ps1.
#
# Design goals: idempotent, autonomous, fault-tolerant.
#
# Usage:
#   .\dev-watch.ps1                       Build + watch + deploy
#   .\dev-watch.ps1 -NoWatch              Build once and exit
#   .\dev-watch.ps1 -RustOnly             Skip frontend
#   .\dev-watch.ps1 -FrontendOnly         Skip Rust
#   .\dev-watch.ps1 -Target <triple>      Override Cargo target
#   .\dev-watch.ps1 -SkipSccache          Don't use sccache
#   .\dev-watch.ps1 -VmHost 127.0.0.1     VM SSH host
#   .\dev-watch.ps1 -VmPort 2222          VM SSH port
#   .\dev-watch.ps1 -SshKey <file>        SSH key path
#   .\dev-watch.ps1 -NoRestart            Upload but don't restart services
# ============================================================================

[CmdletBinding()]
param(
    [switch]$NoWatch,
    [switch]$RustOnly,
    [switch]$FrontendOnly,
    [string]$Target = $env:IORA_DEV_TARGET,
    [switch]$SkipSccache,
    [string]$VmHost = "127.0.0.1",
    [int]$VmPort = 2222,
    [string]$SshKey,
    [switch]$NoRestart
)

$ErrorActionPreference = "Continue"
if (-not $Target) { $Target = "x86_64-unknown-linux-gnu" }

# -- Paths -----------------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
    $RepoRoot = (& git -C $ScriptDir rev-parse --show-toplevel 2>$null)
    if (-not $RepoRoot) { throw "no git" }
} catch {
    $RepoRoot = Split-Path -Parent $ScriptDir
}

$Cache       = Join-Path $ScriptDir ".cache"
$Shared      = Join-Path $RepoRoot ".iora-dev"
$BinDir      = Join-Path $Shared "binaries"
$SccacheDir  = Join-Path $Shared "sccache"
$HashDir     = Join-Path $Cache "hashes"
$LogFile     = Join-Path $Cache "dev-watch.log"
foreach ($p in @($Cache, $Shared, $BinDir, $SccacheDir, $HashDir)) {
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

if (-not $SshKey) { $SshKey = Join-Path $Cache "iora-dev-key" }

# Log rotation
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) {
    Move-Item $LogFile "$LogFile.1" -Force -ErrorAction SilentlyContinue
}
try { Start-Transcript -Path $LogFile -Append -ErrorAction Stop | Out-Null } catch {}

# -- Workspace detection ---------------------------------------------------
$Workspace = $null
foreach ($p in @((Join-Path $RepoRoot "iora-os\backend"), (Join-Path $RepoRoot "backend"))) {
    if (Test-Path (Join-Path $p "Cargo.toml")) { $Workspace = $p; break }
}
if (-not $Workspace) {
    Write-Host "[X] Cannot find Rust workspace (looked for iora-os/backend or backend)" -ForegroundColor Red
    exit 1
}

$FrontendDir = $null
foreach ($p in @((Join-Path $RepoRoot "frontend"), (Join-Path $RepoRoot "desktop"))) {
    if (Test-Path (Join-Path $p "package.json")) { $FrontendDir = $p; break }
}

$DoRust     = -not $FrontendOnly
$DoFrontend = (-not $RustOnly) -and ($null -ne $FrontendDir)
$Watch      = -not $NoWatch
$DoRestart  = -not $NoRestart

# -- Logging helpers -------------------------------------------------------
function Log-Info ($m)  { Write-Host "[*] $m" -ForegroundColor Cyan }
function Log-Ok   ($m)  { Write-Host "[+] $m" -ForegroundColor Green }
function Log-Warn ($m)  { Write-Host "[!] $m" -ForegroundColor Yellow }
function Log-Err  ($m)  { Write-Host "[X] $m" -ForegroundColor Red }
function Log-Dim  ($m)  { Write-Host "    $m" -ForegroundColor DarkGray }

# -- SSH plumbing (multiplexed via ControlMaster on Linux/macOS, but on
#    Windows OpenSSH multiplexing isn't supported well, so we live without).
$Script:SshOpts = @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "IdentitiesOnly=yes",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ConnectTimeout=10",
    "-i", $SshKey
)

function Invoke-Ssh {
    param([Parameter(Mandatory)][string]$Cmd, [int]$TimeoutSec = 30)
    & ssh @Script:SshOpts -p $VmPort "root@$VmHost" $Cmd 2>$null
    return $LASTEXITCODE
}

function Invoke-SshCapture {
    param([Parameter(Mandatory)][string]$Cmd)
    $out = & ssh @Script:SshOpts -p $VmPort "root@$VmHost" $Cmd 2>$null
    return ,@($LASTEXITCODE, ($out -join "`n"))
}

function Send-Scp {
    param([Parameter(Mandatory)][string]$LocalPath, [Parameter(Mandatory)][string]$RemotePath)
    & scp @Script:SshOpts -P $VmPort -q $LocalPath "root@${VmHost}:${RemotePath}" 2>$null
    return $LASTEXITCODE
}

function Test-VmReachable {
    if (-not (Test-Path $SshKey)) { return $false }
    & ssh @Script:SshOpts -o ConnectTimeout=5 -o BatchMode=yes -p $VmPort "root@$VmHost" "true" 2>$null
    return ($LASTEXITCODE -eq 0)
}

# -- Service auto-discovery ------------------------------------------------
function Get-AllServices {
    $services = New-Object System.Collections.Generic.List[string]
    foreach ($base in @("services", "tools", "apps\system", "dev")) {
        $dir = Join-Path $Workspace $base
        if (-not (Test-Path $dir)) { continue }
        Get-ChildItem -Path $dir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            if ((Test-Path (Join-Path $_.FullName "Cargo.toml")) -and ($_.Name -like "iora-*")) {
                if (-not $services.Contains($_.Name)) { $services.Add($_.Name) }
            }
        }
    }
    return $services
}

$Script:AllServices = Get-AllServices
Log-Info "Discovered $($Script:AllServices.Count) iora-* crates"

# -- Toolchain detection --------------------------------------------------
$Script:UseZigbuild = $false
$Script:Toolchain   = "auto"

function Initialize-Toolchain {
    $brBin = Join-Path $RepoRoot "iora-os\output\host\bin\x86_64-linux-gcc"
    if (Test-Path $brBin) {
        $env:PATH = (Split-Path $brBin) + ";" + $env:PATH
        ${env:CC_x86_64_unknown_linux_gnu} = $brBin
        $script:Target = "x86_64-unknown-linux-gnu"
        $Script:Toolchain = "buildroot"
        return
    }
    if (Get-Command x86_64-linux-musl-gcc -ErrorAction SilentlyContinue) {
        ${env:CC_x86_64_unknown_linux_musl} = (Get-Command x86_64-linux-musl-gcc).Source
        $script:Target = "x86_64-unknown-linux-musl"
        $Script:Toolchain = "musl"
        return
    }
    if (Get-Command x86_64-linux-gnu-gcc -ErrorAction SilentlyContinue) {
        ${env:CC_x86_64_unknown_linux_gnu} = (Get-Command x86_64-linux-gnu-gcc).Source
        $script:Target = "x86_64-unknown-linux-gnu"
        $Script:Toolchain = "gnu"
        return
    }
    if ((Get-Command cargo-zigbuild -ErrorAction SilentlyContinue) -and (Get-Command zig -ErrorAction SilentlyContinue)) {
        $Script:UseZigbuild = $true
        $Script:Toolchain = "zigbuild"
        # Clear Windows OpenSSL leakage that would break Linux targets
        $env:OPENSSL_LIB_DIR = ""
        $env:OPENSSL_INCLUDE_DIR = ""
        $env:OPENSSL_DIR = ""
        return
    }
    $Script:Toolchain = "host"
    Log-Warn "No cross compiler found. Falling back to host toolchain."
    Log-Warn "Install one of: cargo-zigbuild + zig (recommended on Windows)"
    Log-Warn "  → see install-requirements.ps1"
}

function Initialize-RustTarget {
    $installed = rustup target list --installed 2>$null
    if ($installed -notmatch [regex]::Escape($Target)) {
        Log-Info "Installing Rust target $Target ..."
        rustup target add $Target 2>$null | Out-Null
    }
}

function Initialize-Sccache {
    $env:SCCACHE_DIR = $SccacheDir
    if ($SkipSccache) { return }
    if (Get-Command sccache -ErrorAction SilentlyContinue) {
        $env:RUSTC_WRAPPER = "sccache"
        if (-not $env:SCCACHE_CACHE_SIZE) { $env:SCCACHE_CACHE_SIZE = "5G" }
        Log-Ok "sccache enabled ($SccacheDir, max $($env:SCCACHE_CACHE_SIZE))"
    } else {
        Log-Warn "sccache not found - builds will be slower (cargo install sccache)"
    }
}

# -- Hash tracking ---------------------------------------------------------
function Get-FileSha {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return "" }
    return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

function Test-BinChanged {
    param([string]$Name, [string]$Bin)
    $hashFile = Join-Path $HashDir $Name
    $cur = Get-FileSha $Bin
    $prev = ""
    if (Test-Path $hashFile) { $prev = (Get-Content $hashFile -Raw -ErrorAction SilentlyContinue).Trim() }
    if ($cur -eq $prev) { return $false }
    Set-Content -Path $hashFile -Value $cur -NoNewline
    return $true
}

# -- Deploy ---------------------------------------------------------------
function Invoke-DeployBinary {
    param([string]$Name, [string]$Bin)
    $remote = "/usr/bin/$Name"
    $tmp = "/tmp/.iora-deploy-$Name.$PID"

    if ((Send-Scp $Bin $tmp) -ne 0) {
        Log-Err "    $Name : scp failed"
        return $false
    }
    if ((Invoke-Ssh "install -m 0755 '$tmp' '$remote' && rm -f '$tmp'") -ne 0) {
        Log-Err "    $Name : install failed"
        Invoke-Ssh "rm -f '$tmp'" | Out-Null
        return $false
    }
    if ($DoRestart) {
        Invoke-Ssh "systemctl try-restart $Name 2>/dev/null || systemctl restart $Name 2>/dev/null || true" | Out-Null
    }
    Write-Host "    -> $Name" -ForegroundColor Green
    return $true
}

function Invoke-DeployMany {
    param([string[]]$Services)
    $deployed = 0; $failed = 0
    $targetDir = Join-Path $Workspace "target\$Target\debug"

    foreach ($svc in $Services) {
        $bin = Join-Path $targetDir $svc
        if (-not (Test-Path $bin)) {
            Log-Dim "$svc : binary not built, skipping"
            continue
        }
        if (-not (Test-BinChanged $svc $bin)) {
            Log-Dim "$svc : unchanged"
            continue
        }
        # Stash copy in shared dir (9p fallback)
        Copy-Item $bin (Join-Path $BinDir $svc) -Force -ErrorAction SilentlyContinue
        if (Invoke-DeployBinary $svc $bin) { $deployed++ } else { $failed++ }
    }
    Set-Content -Path (Join-Path $BinDir ".trigger") -Value ([DateTimeOffset]::Now.ToUnixTimeSeconds()) -ErrorAction SilentlyContinue
    Write-Host "  deployed=$deployed failed=$failed" -ForegroundColor DarkGray
}

# -- Build: Rust -----------------------------------------------------------
$Script:RustN = 0
function Invoke-BuildRust {
    if (-not $DoRust) { return }
    $Script:RustN++
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host ""
    Write-Host "──[Rust #$($Script:RustN) @ $(Get-Date -Format HH:mm:ss)]──────────────────────" -ForegroundColor Yellow

    Push-Location $Workspace
    try {
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        if ($Script:UseZigbuild) {
            & cargo zigbuild --target $Target --workspace --color always 2>&1 | ForEach-Object { Write-Host $_ }
        } else {
            & cargo build --target $Target --workspace --color always 2>&1 | ForEach-Object { Write-Host $_ }
        }
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevEA
    } finally {
        Pop-Location
    }
    $sw.Stop()

    if ($exit -ne 0) {
        Log-Err "Rust build FAILED (exit $exit) after $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
        return
    }
    Log-Ok "Rust build OK in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
    if (Test-VmReachable) {
        Invoke-DeployMany $Script:AllServices
    } else {
        Log-Warn "VM not reachable, skipping deploy"
    }
}

# -- Build: Frontend -------------------------------------------------------
$Script:FeN = 0
function Invoke-BuildFrontend {
    if (-not $DoFrontend) { return }
    if (-not $FrontendDir) { return }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Log-Warn "npm not found, skipping frontend"; return
    }
    $Script:FeN++
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host ""
    Write-Host "──[Frontend #$($Script:FeN) @ $(Get-Date -Format HH:mm:ss)]──────────────────" -ForegroundColor Yellow

    Push-Location $FrontendDir
    try {
        $prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        if (-not (Test-Path "node_modules")) {
            Log-Info "Running 'npm install' (one-time)..."
            & npm install --no-audit --no-fund 2>&1 | ForEach-Object { Write-Host $_ }
        }
        & npm run build 2>&1 | ForEach-Object { Write-Host $_ }
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevEA
    } finally {
        Pop-Location
    }
    $sw.Stop()

    if ($exit -ne 0) {
        Log-Err "Frontend build FAILED (exit $exit) after $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
        return
    }
    Log-Ok "Frontend build OK in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"

    $dist = Join-Path $FrontendDir "dist"
    if ((Test-Path $dist) -and (Test-VmReachable)) {
        Invoke-DeployFrontend $dist
    }
}

function Invoke-DeployFrontend {
    param([string]$Dist)
    $tar = Join-Path $Cache "iora-frontend.tar.gz"
    Push-Location $Dist
    try {
        & tar -czf $tar . 2>$null
    } finally { Pop-Location }
    if (-not (Test-Path $tar)) { Log-Err "tar failed"; return }
    if ((Send-Scp $tar "/tmp/iora-frontend.tar.gz") -ne 0) {
        Log-Err "frontend upload failed"; return
    }
    Invoke-Ssh @'
set -e
mkdir -p /opt/iora/build/dist
rm -rf /opt/iora/build/dist/*
tar xzf /tmp/iora-frontend.tar.gz -C /opt/iora/build/dist
rm -f /tmp/iora-frontend.tar.gz
systemctl try-restart iora-home 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true
'@ | Out-Null
    Remove-Item $tar -ErrorAction SilentlyContinue
    Log-Ok "  frontend deployed -> /opt/iora/build/dist"
}

# -- Health / status -------------------------------------------------------
function Show-Health {
    if (-not (Test-VmReachable)) { Log-Warn "VM not reachable"; return }
    Log-Info "Failed units:"
    Invoke-Ssh "systemctl --failed --no-legend --no-pager 2>/dev/null | awk '{print \$1, \$3}' | head -20" | Out-Null
    Log-Info "iora-home /api/health:"
    Invoke-Ssh "curl -sf --max-time 5 http://127.0.0.1:8126/api/health || curl -sf --max-time 5 http://127.0.0.1:8126/health || echo unreachable" | Out-Null
}

function Show-Status {
    if (-not (Test-VmReachable)) { Log-Warn "VM not reachable"; return }
    Write-Host ""
    Write-Host "  Service                       Active     Binary" -ForegroundColor Yellow
    Write-Host "  ────────────────────────────────────────────────────"
    foreach ($svc in $Script:AllServices) {
        $rc1, $active = Invoke-SshCapture "systemctl is-active $svc 2>/dev/null"
        $rc2, $bin    = Invoke-SshCapture "test -f /usr/bin/$svc && echo yes || echo no"
        $color = "DarkGray"
        switch ($active.Trim()) {
            "active"     { $color = "Green" }
            "failed"     { $color = "Red" }
            "activating" { $color = "Yellow" }
        }
        Write-Host ("  {0,-28}  " -f $svc) -NoNewline
        Write-Host ("{0,-9}" -f $active.Trim()) -ForegroundColor $color -NoNewline
        Write-Host ("  $($bin.Trim())")
    }
    Write-Host ""
}

# -- Watcher (FileSystemWatcher + debounce) -------------------------------
$Script:RustDirty = $false
$Script:FeDirty   = $false

$watchers = @()
function New-Watcher {
    param([string]$Path, [string[]]$Filters, [string]$Kind)
    if (-not (Test-Path $Path)) { return }
    foreach ($f in $Filters) {
        $w = New-Object System.IO.FileSystemWatcher
        $w.Path = $Path
        $w.IncludeSubdirectories = $true
        $w.Filter = $f
        $w.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor `
                          [System.IO.NotifyFilters]::FileName -bor `
                          [System.IO.NotifyFilters]::DirectoryName
        $w.EnableRaisingEvents = $true
        $script:watchers += $w

        $handler = {
            $p = $Event.SourceEventArgs.FullPath
            if ($p -match '[\\/](target|node_modules|\.git|dist|\.iora-dev|\.next)([\\/]|$)') { return }
            if ($Event.MessageData -eq "rust") {
                [System.Threading.Interlocked]::Exchange([ref]$Script:RustDirty, $true) | Out-Null
            } else {
                [System.Threading.Interlocked]::Exchange([ref]$Script:FeDirty, $true) | Out-Null
            }
        }
        # NOTE: PowerShell can't set a script-level [bool] via Interlocked because
        # [bool] isn't supported. Use a small wrapper via Get-Variable instead.
        $simpleHandler = if ($Kind -eq "rust") {
            { Set-Variable -Scope Global -Name 'IoraRustDirty' -Value $true }
        } else {
            { Set-Variable -Scope Global -Name 'IoraFeDirty' -Value $true }
        }
        Register-ObjectEvent -InputObject $w -EventName Changed -Action $simpleHandler | Out-Null
        Register-ObjectEvent -InputObject $w -EventName Created -Action $simpleHandler | Out-Null
        Register-ObjectEvent -InputObject $w -EventName Renamed -Action $simpleHandler | Out-Null
    }
}

function Start-Watchers {
    foreach ($sub in @("services", "shared", "tools", "apps", "dev")) {
        New-Watcher (Join-Path $Workspace $sub) @("*.rs", "*.toml") "rust"
    }
    if ($DoFrontend) {
        foreach ($sub in @("src", "public")) {
            New-Watcher (Join-Path $FrontendDir $sub) @("*.ts","*.tsx","*.js","*.jsx","*.css","*.html","*.json") "fe"
        }
    }
    Log-Dim "watcher: FileSystemWatcher x $($script:watchers.Count)"
}

function Stop-Watchers {
    foreach ($w in $script:watchers) {
        try { $w.EnableRaisingEvents = $false; $w.Dispose() } catch {}
    }
    Get-EventSubscriber | Where-Object { $_.SourceObject -is [System.IO.FileSystemWatcher] } |
        ForEach-Object { Unregister-Event -SubscriptionId $_.SubscriptionId -ErrorAction SilentlyContinue }
}

# -- Header / cleanup ------------------------------------------------------
function Write-Header {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║              IORA OS Dev-Loop (intelligent)                       ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host "  Workspace : $Workspace"
    Write-Host "  Frontend  : $(if ($FrontendDir) { $FrontendDir } else { '<none>' })"
    Write-Host "  Target    : $Target  (toolchain: $($Script:Toolchain))"
    Write-Host "  VM        : root@${VmHost}:$VmPort"
    if (-not (Test-Path $SshKey)) {
        Log-Warn "SSH key missing: $SshKey  (start the VM first: .\dev-local.ps1)"
    }
}

function Invoke-Cleanup {
    Stop-Watchers
    try { Stop-Transcript | Out-Null } catch {}
}

# -- Bootstrap -------------------------------------------------------------
Write-Header
Initialize-Toolchain
Initialize-RustTarget
Initialize-Sccache

if (Test-VmReachable) { Log-Ok "VM reachable" } else { Log-Warn "VM not reachable - will retry on each build" }

Invoke-BuildRust
Invoke-BuildFrontend

if (-not $Watch) {
    Log-Info "Initial build complete; -NoWatch set, exiting."
    Invoke-Cleanup
    exit 0
}

$Global:IoraRustDirty = $false
$Global:IoraFeDirty   = $false
Start-Watchers

Write-Host ""
Write-Host "┌──────────────────────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│  [B] full rebuild   [R] Rust    [F] Frontend                     │"
Write-Host "│  [D] redeploy       [S] status  [H] health   [Q] quit            │"
Write-Host "└──────────────────────────────────────────────────────────────────┘" -ForegroundColor Cyan

try {
    while ($true) {
        # Debounced rebuild trigger
        if ($Global:IoraRustDirty) {
            $Global:IoraRustDirty = $false
            Start-Sleep -Milliseconds 600  # let bursts settle
            $Global:IoraRustDirty = $false
            Invoke-BuildRust
        }
        if ($Global:IoraFeDirty) {
            $Global:IoraFeDirty = $false
            Start-Sleep -Milliseconds 600
            $Global:IoraFeDirty = $false
            Invoke-BuildFrontend
        }

        if ([Console]::KeyAvailable) {
            $k = [Console]::ReadKey($true)
            switch ($k.Key) {
                "B" { $Global:IoraRustDirty = $true; $Global:IoraFeDirty = $true }
                "R" { $Global:IoraRustDirty = $true }
                "F" { $Global:IoraFeDirty = $true }
                "D" {
                    if (Test-VmReachable) {
                        Get-ChildItem $HashDir -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
                        Invoke-DeployMany $Script:AllServices
                    } else { Log-Warn "VM not reachable" }
                }
                "S" { Show-Status }
                "H" { Show-Health }
                "Q" { Log-Info "bye."; break }
            }
            if ($k.Key -eq "Q") { break }
        }

        Start-Sleep -Milliseconds 200
    }
} finally {
    Invoke-Cleanup
}
