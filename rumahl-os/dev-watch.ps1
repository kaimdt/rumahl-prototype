# ============================================================================
# dev-watch.ps1 - rumahl OS Dev-Loop TUI (Windows host)
# ============================================================================
# Terminal UI with persistent regions: header, build output, status bar, menu.
# Watches the Rust workspace + frontend, cross-compiles for Linux, deploys
# binaries and frontend to the dev VM via SSH.
# ============================================================================

[CmdletBinding()]
param(
    [switch]$NoWatch,
    [switch]$RustOnly,
    [switch]$FrontendOnly,
    [string]$Target = $env:RUMAHL_DEV_TARGET,
    [switch]$SkipSccache,
    [string]$VmHost = "127.0.0.1",
    [int]$VmPort = 2222,
    [string]$SshKey,
    [switch]$NoRestart
)

$ErrorActionPreference = "Continue"
if (-not $Target) { $Target = "x86_64-unknown-linux-gnu" }

# ═══════════════════════════════════════════════════════════════════════════
# PATHS & INIT
# ═══════════════════════════════════════════════════════════════════════════
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
    $RepoRoot = (& git -C $ScriptDir rev-parse --show-toplevel 2>$null)
    if (-not $RepoRoot) { throw "no git" }
} catch { $RepoRoot = Split-Path -Parent $ScriptDir }

$Cache      = Join-Path $ScriptDir ".cache"
$Shared     = Join-Path $RepoRoot ".rumahl-dev"
$BinDir     = Join-Path $Shared "binaries"
$SccacheDir = Join-Path $Shared "sccache"
$HashDir    = Join-Path $Cache "hashes"
foreach ($p in @($Cache, $Shared, $BinDir, $SccacheDir, $HashDir)) {
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}
if (-not $SshKey) { $SshKey = Join-Path $Cache "rumahl-dev-key" }

$Workspace = $null
foreach ($p in @((Join-Path $RepoRoot "rumahl-os\backend"), (Join-Path $RepoRoot "backend"))) {
    if (Test-Path (Join-Path $p "Cargo.toml")) { $Workspace = $p; break }
}
if (-not $Workspace) { Write-Host "[X] Cannot find Rust workspace" -ForegroundColor Red; exit 1 }

$FrontendDir = $null
foreach ($p in @((Join-Path $RepoRoot "frontend"), (Join-Path $RepoRoot "desktop"))) {
    if (Test-Path (Join-Path $p "package.json")) { $FrontendDir = $p; break }
}

$DoRust     = -not $FrontendOnly
$DoFrontend = (-not $RustOnly) -and ($null -ne $FrontendDir)
$Watch      = -not $NoWatch
$DoRestart  = -not $NoRestart

# ═══════════════════════════════════════════════════════════════════════════
# TUI ENGINE – ANSI escape codes + screen regions
# ═══════════════════════════════════════════════════════════════════════════
$Script:TuiWidth  = [Math]::Min([Console]::WindowWidth, 120)
$Script:TuiHeight = [Console]::WindowHeight
$Script:HeaderH   = 2
$Script:StatusH   = 4
$Script:MenuH     = 3
$Script:ContentH  = [Math]::Max(8, $Script:TuiHeight - $Script:HeaderH - $Script:StatusH - $Script:MenuH - 2)
$Script:ContentBuf = New-Object System.Collections.Generic.List[string]
$Script:ContentMax = 200

# Colors
$C_RESET  = "`e[0m"
$C_BOLD   = "`e[1m"
$C_DIM    = "`e[2m"
$C_CYAN   = "`e[36m"
$C_GREEN  = "`e[32m"
$C_YELLOW = "`e[33m"
$C_RED    = "`e[31m"
$C_GRAY   = "`e[90m"
$C_WHITE  = "`e[37m"
$C_BG     = "`e[48;5;236m"

function Tui-Init {
    [Console]::CursorVisible = $false
    [Console]::Clear()
    $Host.UI.RawUI.WindowTitle = "rumahl Dev-Loop"
}

function Tui-Shutdown {
    [Console]::CursorVisible = $true
    [Console]::SetCursorPosition(0, $Script:TuiHeight - 1)
    Write-Host ""
}

function Tui-WriteAt {
    param([int]$X, [int]$Y, [string]$Text)
    [Console]::SetCursorPosition($X, $Y)
    Write-Host $Text -NoNewline
}

function Tui-FillLine {
    param([int]$Y, [string]$Char = " ", [string]$Color = "")
    $fill = $Char * ($Script:TuiWidth)
    [Console]::SetCursorPosition(0, $Y)
    if ($Color) { Write-Host $fill -NoNewline -ForegroundColor $Color }
    else { Write-Host $fill -NoNewline }
}

function Tui-DrawBox {
    param([int]$Y, [int]$H, [string]$Color)
    $top = $([char]0x2500) * ($Script:TuiWidth - 2)
    $bot = $([char]0x2500) * ($Script:TuiWidth - 2)
    Tui-WriteAt 0 $Y "$([char]0x250C)$top$([char]0x2510)"
    for ($i = 1; $i -lt $H - 1; $i++) {
        Tui-WriteAt 0 ($Y + $i) "$([char]0x2502)"
        Tui-WriteAt ($Script:TuiWidth - 1) ($Y + $i) "$([char]0x2502)"
    }
    Tui-WriteAt 0 ($Y + $H - 1) "$([char]0x2514)$bot$([char]0x2518)"
}

# -- Content buffer -------------------------------------------------------- 
function Tui-Log {
    param([string]$Text, [string]$Color = "White")
    foreach ($line in ($Text -split "`n")) {
        if ($Script:ContentBuf.Count -ge $Script:ContentMax) {
            $Script:ContentBuf.RemoveAt(0)
        }
        $Script:ContentBuf.Add("$Color|$line")
    }
}

function Tui-LogInfo   ($t) { Tui-Log $t "Cyan" }
function Tui-LogOk     ($t) { Tui-Log "  $t" "Green" }
function Tui-LogWarn   ($t) { Tui-Log $t "Yellow" }
function Tui-LogError  ($t) { Tui-Log $t "Red" }
function Tui-LogDim    ($t) { Tui-Log "  $t" "Gray" }
function Tui-LogRaw    ($t) { Tui-Log $t "White" }

function Tui-RenderContent {
    $startY = $Script:HeaderH + 1
    $visible = $Script:ContentH
    $total = $Script:ContentBuf.Count
    $start = [Math]::Max(0, $total - $visible)
    
    for ($i = 0; $i -lt $visible; $i++) {
        $idx = $start + $i
        [Console]::SetCursorPosition(1, $startY + $i)
        if ($idx -lt $total) {
            $entry = $Script:ContentBuf[$idx]
            $sep = $entry.IndexOf('|')
            $color = $entry.Substring(0, $sep)
            $text = $entry.Substring($sep + 1)
            $text = if ($text.Length -gt $Script:TuiWidth - 2) { $text.Substring(0, $Script:TuiWidth - 2) } else { $text.PadRight($Script:TuiWidth - 2) }
            switch ($color) {
                "Green"  { Write-Host $text -NoNewline -ForegroundColor Green }
                "Yellow" { Write-Host $text -NoNewline -ForegroundColor Yellow }
                "Red"    { Write-Host $text -NoNewline -ForegroundColor Red }
                "Cyan"   { Write-Host $text -NoNewline -ForegroundColor Cyan }
                "Gray"   { Write-Host $text -NoNewline -ForegroundColor DarkGray }
                default  { Write-Host $text -NoNewline }
            }
        } else {
            Write-Host (" " * ($Script:TuiWidth - 2)) -NoNewline
        }
    }
}

# -- Header ----------------------------------------------------------------
function Tui-RenderHeader {
    $time = Get-Date -Format "HH:mm:ss"
    $uptime = [math]::Floor(((Get-Date) - $Script:StartTime).TotalMinutes)
    $title = "rumahl OS Dev-Loop  |  $time  |  up ${uptime}min  |  $($Script:Toolchain)"
    Tui-FillLine 0 " " 
    Tui-FillLine 1 " "
    Tui-WriteAt 1 0 $title
    $ws = if ($Workspace.Length -gt 60) { "..." + $Workspace.Substring($Workspace.Length - 57) } else { $Workspace }
    Tui-WriteAt 1 1 "Workspace: $ws" 
}

# -- Status bar ------------------------------------------------------------
function Tui-RenderStatus {
    $y = $Script:HeaderH + $Script:ContentH + 1
    $w = $Script:TuiWidth - 2
    
    # Line 1: separators + build stats
    Tui-FillLine $y ([char]0x2500)
    $rustOk = if ($Script:LastRustOk) { "  $([math]::Floor(((Get-Date)-$Script:LastRustOk).TotalMinutes))min ago" } else { "never" }
    $feOk   = if ($Script:LastFeOk)   { "  $([math]::Floor(((Get-Date)-$Script:LastFeOk).TotalMinutes))min ago" } else { "never" }
    Tui-WriteAt 1 ($y + 1) "Rust: $($Script:RustBuilds) builds ($($Script:RustFailures) fail) | ${rustOk}s | FE: $($Script:FeBuilds) builds ($($Script:FeFailures) fail) | ${feOk}s"

    # Line 2: VM + services
    if ($Script:VmOnline) {
        $svcStr = "Services: $($Script:ActiveServices) active"
        if ($Script:FailedServices -gt 0) { $svcStr += ", $($Script:FailedServices) FAILED" }
        $healthStr = if ($Script:HomeVersion) { 
            "rumahl-home: ONLINE v$($Script:HomeVersion) | entities: $($Script:HomeEntities)"
        } else { "rumahl-home: OFFLINE" }
        Tui-WriteAt 1 ($y + 2) "$healthStr | $svcStr"
    } else {
        Tui-WriteAt 1 ($y + 2) "VM: OFFLINE (SSH not reachable) - start with .\dev-local.ps1"
    }
}

# -- Menu bar --------------------------------------------------------------
function Tui-RenderMenu {
    $y = $Script:HeaderH + $Script:ContentH + $Script:StatusH + 1
    Tui-FillLine $y ([char]0x2500)
    $menu = "[B]uild all  [R]ust  [F]rontend  [D]eploy  [S]tatus  [L]ogs  [W]eb  [H]elp  [Q]uit"
    Tui-WriteAt (($Script:TuiWidth - $menu.Length) / 2) ($y + 1) $menu
}

# -- Full render -----------------------------------------------------------
function Tui-Render {
    Tui-RenderHeader
    Tui-RenderContent
    Tui-RenderStatus
    Tui-RenderMenu
}

# ═══════════════════════════════════════════════════════════════════════════
# STATUS ENGINE – background refresh every 2s
# ═══════════════════════════════════════════════════════════════════════════
$Script:VmOnline     = $false
$Script:HomeVersion  = $null
$Script:HomeEntities = 0
$Script:ActiveServices  = 0
$Script:FailedServices  = 0
$Script:InactiveServices = 0
$Script:StartTime    = Get-Date
$Script:LastRustOk   = $null
$Script:LastRustDur  = "-"
$Script:LastFeOk     = $null
$Script:LastFeDur    = "-"
$Script:RustBuilds   = 0
$Script:RustFailures = 0
$Script:FeBuilds     = 0
$Script:FeFailures   = 0

function Update-Status {
    # VM reachable?
    if ((-not (Test-Path $SshKey)) -or ((& ssh @Script:SshOpts -o ConnectTimeout=3 -o BatchMode=yes -p $VmPort "root@$VmHost" "true" 2>$null) -and ($LASTEXITCODE -ne 0))) {
        $Script:VmOnline = $false
        $Script:HomeVersion = $null
        return
    }
    $Script:VmOnline = $true
    
    # Health endpoint
    $healthJson = & ssh @Script:SshOpts -p $VmPort "root@$VmHost" "curl -sf --max-time 2 http://127.0.0.1:8126/health 2>/dev/null" 2>$null
    if ($LASTEXITCODE -eq 0 -and $healthJson) {
        try {
            $j = $healthJson | ConvertFrom-Json
            $Script:HomeVersion = $j.version
            $Script:HomeEntities = $j.entity_count
        } catch { $Script:HomeVersion = $null }
    } else {
        $Script:HomeVersion = $null
    }
    
    # Service count
    $svcOut = & ssh @Script:SshOpts -p $VmPort "root@$VmHost" "systemctl list-units --type=service 'rumahl-*' --no-legend --no-pager 2>/dev/null | awk '{print \$4}'" 2>$null
    if ($svcOut) {
        $active = 0; $failed = 0
        foreach ($line in ($svcOut -split "`n")) {
            if ($line -match '^active') { $active++ }
            elseif ($line -match '^failed') { $failed++ }
        }
        $Script:ActiveServices = $active
        $Script:FailedServices = $failed
    }
}

# Background status refresh (simple approach: toggle flag)
$Script:StatusDirty = $true
$Script:StatusTimer = [System.Timers.Timer]::new(5000)
$Script:StatusTimer.AutoReset = $true
$Script:StatusTimer.Enabled = $true
$null = Register-ObjectEvent -InputObject $Script:StatusTimer -EventName Elapsed -Action {
    Update-Status
    Set-Variable -Scope Global -Name 'rumahlStatusDirty' -Value $true
}

$Global:rumahlStatusDirty = $false

# ═══════════════════════════════════════════════════════════════════════════
# SSH / DEPLOY (unchanged core logic)
# ═══════════════════════════════════════════════════════════════════════════
$Script:SshOpts = @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "IdentitiesOnly=yes",
    "-o", "LogLevel=ERROR",
    "-o", "ServerAliveInterval=60",
    "-o", "ServerAliveCountMax=30",
    "-o", "ConnectTimeout=10",
    "-o", "TCPKeepAlive=yes",
    "-i", $SshKey
)

function Invoke-Ssh {
    param([string]$Cmd)
    & ssh @Script:SshOpts -p $VmPort "root@$VmHost" $Cmd 2>$null
    return $LASTEXITCODE
}

function Invoke-SshCapture {
    param([string]$Cmd)
    $out = & ssh @Script:SshOpts -p $VmPort "root@$VmHost" $Cmd 2>$null
    return ,@($LASTEXITCODE, ($out -join "`n"))
}

function Send-Scp {
    param([string]$LocalPath, [string]$RemotePath)
    & scp @Script:SshOpts -P $VmPort -q $LocalPath "root@${VmHost}:${RemotePath}" 2>$null
    return $LASTEXITCODE
}

# ═══════════════════════════════════════════════════════════════════════════
# SERVICE DISCOVERY & TOOLCHAIN
# ═══════════════════════════════════════════════════════════════════════════
function Get-AllServices {
    $services = New-Object System.Collections.Generic.List[string]
    foreach ($base in @("services", "tools", "apps\system", "dev")) {
        $dir = Join-Path $Workspace $base
        if (-not (Test-Path $dir)) { continue }
        Get-ChildItem -Path $dir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            if ((Test-Path (Join-Path $_.FullName "Cargo.toml")) -and ($_.Name -like "rumahl-*")) {
                if (-not $services.Contains($_.Name)) { $services.Add($_.Name) }
            }
        }
    }
    return $services
}

$Script:AllServices = Get-AllServices
$Script:UseZigbuild = $false
$Script:Toolchain   = "auto"

function Initialize-Toolchain {
    $brBin = Join-Path $RepoRoot "rumahl-os\output\host\bin\x86_64-linux-gcc"
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
        $env:OPENSSL_LIB_DIR = ""; $env:OPENSSL_INCLUDE_DIR = ""; $env:OPENSSL_DIR = ""
        return
    }
    $Script:Toolchain = "host"
    if ($Target -like "*-linux-*") {
        if ((Get-Command cargo-zigbuild -ErrorAction SilentlyContinue) -and (Get-Command zig -ErrorAction SilentlyContinue)) {
            $Script:UseZigbuild = $true
            $Script:Toolchain = "zigbuild"
            $env:OPENSSL_LIB_DIR = ""; $env:OPENSSL_INCLUDE_DIR = ""; $env:OPENSSL_DIR = ""
            return
        }
    }
}

function Initialize-RustTarget {
    $installed = rustup target list --installed 2>$null
    if ($installed -notmatch [regex]::Escape($Target)) {
        Tui-LogInfo "Installing Rust target $Target ..."
        rustup target add $Target 2>$null | Out-Null
    }
}

function Initialize-Sccache {
    $env:SCCACHE_DIR = $SccacheDir
    if ($SkipSccache) { return }
    if (Get-Command sccache -ErrorAction SilentlyContinue) {
        $env:RUSTC_WRAPPER = "sccache"
        if (-not $env:SCCACHE_CACHE_SIZE) { $env:SCCACHE_CACHE_SIZE = "5G" }
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# HASH TRACKING & DEPLOY
# ═══════════════════════════════════════════════════════════════════════════
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

function Invoke-DeployBinary {
    param([string]$Name, [string]$Bin)
    $remote = "/usr/bin/$Name"
    $tmp = "/tmp/.rumahl-deploy-$Name.$PID"
    if ((Send-Scp $Bin $tmp) -ne 0) { Tui-LogError "  $Name : scp failed"; return $false }
    if ((Invoke-Ssh "install -m 0755 '$tmp' '$remote' && rm -f '$tmp'") -ne 0) {
        Tui-LogError "  $Name : install failed"
        Invoke-Ssh "rm -f '$tmp'" | Out-Null
        return $false
    }
    if ($DoRestart) {
        Invoke-Ssh "systemctl try-restart $Name 2>/dev/null || systemctl restart $Name 2>/dev/null || true" | Out-Null
    }
    Tui-LogOk "-> $Name deployed"
    return $true
}

function Invoke-DeployMany {
    param([string[]]$Services)
    $deployed = 0; $failed = 0
    $targetDir = Join-Path $Workspace "target\$Target\debug"
    foreach ($svc in $Services) {
        $bin = Join-Path $targetDir $svc
        if (-not (Test-Path $bin)) { continue }
        if (-not (Test-BinChanged $svc $bin)) { continue }
        Copy-Item $bin (Join-Path $BinDir $svc) -Force -ErrorAction SilentlyContinue
        if (Invoke-DeployBinary $svc $bin) { $deployed++ } else { $failed++ }
    }
    if ($deployed -gt 0 -or $failed -gt 0) {
        Tui-LogInfo "Deployed: $deployed ok, $failed failed"
    } else {
        Tui-LogDim "deploy: no changes"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# BUILD: RUST
# ═══════════════════════════════════════════════════════════════════════════
$Script:RustN = 0
function Invoke-BuildRust {
    if (-not $DoRust) { return }
    $Script:RustN++
    $Script:RustBuilds++
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Tui-LogInfo "Rust #$($Script:RustN) - compiling $($Script:AllServices.Count) crates ($Target)..."
    Tui-RenderContent; Tui-RenderStatus  # show immediately

    Push-Location $Workspace
    try {
        $prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        if ($Script:UseZigbuild) {
            & cargo zigbuild --target $Target --workspace --color always 2>&1 | ForEach-Object { Tui-LogRaw $_ }
        } else {
            & cargo build --target $Target --workspace --color always 2>&1 | ForEach-Object { Tui-LogRaw $_ }
        }
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevEA
    } finally { Pop-Location }
    $sw.Stop()
    $dur = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $Script:LastRustDur = $dur

    if ($exit -ne 0) {
        $Script:RustFailures++
        Tui-LogError "Rust build FAILED after ${dur}s"
        Tui-LogInfo "Fix errors and press [R] to retry"
        return
    }
    $Script:LastRustOk = Get-Date
    Tui-LogOk "Rust build OK in ${dur}s"
    if ($Script:VmOnline) {
        Invoke-DeployMany $Script:AllServices
    } else {
        Tui-LogWarn "VM offline - binaries built but not deployed"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# BUILD: FRONTEND
# ═══════════════════════════════════════════════════════════════════════════
$Script:FeN = 0
function Invoke-BuildFrontend {
    if (-not $DoFrontend) { return }
    if (-not $FrontendDir) { return }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return }
    $Script:FeN++
    $Script:FeBuilds++
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Tui-LogInfo "Frontend #$($Script:FeN) - vite building..."
    Tui-RenderContent; Tui-RenderStatus

    Push-Location $FrontendDir
    try {
        $prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        if (-not (Test-Path "node_modules")) {
            Tui-LogInfo "npm install (one-time)..."
            & npm install --no-audit --no-fund 2>&1 | ForEach-Object { Tui-LogRaw $_ }
        }
        & npm run build 2>&1 | ForEach-Object { Tui-LogRaw $_ }
        $exit = $LASTEXITCODE
        $ErrorActionPreference = $prevEA
    } finally { Pop-Location }
    $sw.Stop()
    $dur = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $Script:LastFeDur = $dur

    if ($exit -ne 0) {
        $Script:FeFailures++
        Tui-LogError "Frontend build FAILED after ${dur}s"
        return
    }
    $Script:LastFeOk = Get-Date
    Tui-LogOk "Frontend build OK in ${dur}s"

    $dist = Join-Path $FrontendDir "dist"
    if ((Test-Path $dist) -and $Script:VmOnline) {
        Invoke-DeployFrontend $dist
    } elseif (Test-Path $dist) {
        Tui-LogWarn "VM offline - frontend built but not deployed"
    }
}

function Invoke-DeployFrontend {
    param([string]$Dist)
    $tar = Join-Path $Cache "rumahl-frontend.tar.gz"
    Push-Location $Dist
    try { & tar -czf $tar . 2>$null } finally { Pop-Location }
    if (-not (Test-Path $tar)) { Tui-LogError "tar failed"; return }
    if ((Send-Scp $tar "/tmp/rumahl-frontend.tar.gz") -ne 0) { Tui-LogError "frontend upload failed"; return }
    $scriptBlock = @'
set -e; mkdir -p /opt/rumahl/build/dist; rm -rf /opt/rumahl/build/dist/*
tar xzf /tmp/rumahl-frontend.tar.gz -C /opt/rumahl/build/dist
rm -f /tmp/rumahl-frontend.tar.gz
systemctl try-restart rumahl-home 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true
'@
    Invoke-Ssh $scriptBlock | Out-Null
    Remove-Item $tar -ErrorAction SilentlyContinue
    Tui-LogOk "frontend deployed -> /opt/rumahl/build/dist"
}

# ═══════════════════════════════════════════════════════════════════════════
# STATUS VIEWS
# ═══════════════════════════════════════════════════════════════════════════
function Show-StatusFull {
    if (-not $Script:VmOnline) { Tui-LogWarn "VM not reachable"; return }
    Tui-LogInfo "=== Service Status ==="
    foreach ($svc in $Script:AllServices) {
        $rc1, $active = Invoke-SshCapture "systemctl is-active $svc 2>/dev/null"
        $rc2, $bin    = Invoke-SshCapture "test -f /usr/bin/$svc && echo yes || echo no"
        $a = $active.Trim(); $b = $bin.Trim()
        $icon = if ($a -eq "active") { "[+]" } elseif ($a -eq "failed") { "[X]" } elseif ($a -eq "activating") { "[~]" } else { "[-]" }
        Tui-LogRaw "$icon $svc  $a  binary: $b"
    }
}

function Show-Logs {
    if (-not $Script:VmOnline) { Tui-LogWarn "VM offline"; return }
    Tui-LogInfo "=== rumahl-home recent logs ==="
    $log = & ssh @Script:SshOpts -p $VmPort "root@$VmHost" "journalctl -u rumahl-home --no-pager -n 20 2>/dev/null" 2>$null
    foreach ($l in ($log -split "`n")) { Tui-LogDim $l }
}

function Show-Help {
    Tui-LogInfo "=== Help ==="
    Tui-LogRaw "[B]  Build all (Rust + Frontend) - full rebuild"
    Tui-LogRaw "[R]  Rust only - compile & deploy binaries"
    Tui-LogRaw "[F]  Frontend only - vite build & deploy"
    Tui-LogRaw "[D]  Deploy - force re-deploy all binaries"
    Tui-LogRaw "[S]  Status - show per-service status"
    Tui-LogRaw "[L]  Logs - show rumahl-home journal"
    Tui-LogRaw "[W]  Web - open https://localhost"
    Tui-LogRaw "[H]  Help - this screen"
    Tui-LogRaw "[Q]  Quit - exit dev-loop (VM keeps running)"
    Tui-LogRaw ""
    Tui-LogRaw "Dashboard : https://localhost"
    Tui-LogRaw "Swagger   : http://localhost:8126/api/docs"
    Tui-LogOk  "VM control : .\dev-local.ps1 -Stop / -Status"
}

# ═══════════════════════════════════════════════════════════════════════════
# WATCHER
# ═══════════════════════════════════════════════════════════════════════════
$watchers = @()
function New-Watcher {
    param([string]$Path, [string[]]$Filters, [string]$Kind)
    if (-not (Test-Path $Path)) { return }
    foreach ($f in $Filters) {
        $w = New-Object System.IO.FileSystemWatcher
        $w.Path = $Path; $w.IncludeSubdirectories = $true; $w.Filter = $f
        $w.NotifyFilter = [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::FileName -bor [IO.NotifyFilters]::DirectoryName
        $w.EnableRaisingEvents = $true
        $script:watchers += $w
        $handler = if ($Kind -eq "rust") {
            { Set-Variable -Scope Global -Name 'rumahlRustDirty' -Value $true }
        } else {
            { Set-Variable -Scope Global -Name 'rumahlFeDirty' -Value $true }
        }
        Register-ObjectEvent -InputObject $w -EventName Changed -Action $handler | Out-Null
        Register-ObjectEvent -InputObject $w -EventName Created -Action $handler | Out-Null
        Register-ObjectEvent -InputObject $w -EventName Renamed -Action $handler | Out-Null
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
}

function Stop-Watchers {
    foreach ($w in $script:watchers) { try { $w.EnableRaisingEvents = $false; $w.Dispose() } catch {} }
    Get-EventSubscriber | Where-Object { $_.SourceObject -is [IO.FileSystemWatcher] } |
        ForEach-Object { Unregister-Event -SubscriptionId $_.SubscriptionId -ErrorAction SilentlyContinue }
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════
Tui-Init

# Bootstrap log
Tui-LogInfo "rumahl OS Dev-Loop starting..."
Tui-LogInfo "Workspace: $Workspace"
Tui-LogInfo "Target: $Target"
Tui-LogDim "$($Script:AllServices.Count) rumahl-* crates discovered"
Tui-RenderHeader; Tui-RenderContent

Initialize-Toolchain
Tui-LogOk "Toolchain: $($Script:Toolchain)"
Initialize-RustTarget
Initialize-Sccache
if (Get-Command sccache -ErrorAction SilentlyContinue) { Tui-LogOk "sccache enabled" }

# Initial status check
Update-Status
if ($Script:VmOnline) { Tui-LogOk "VM reachable at root@${VmHost}:$VmPort" }
else { Tui-LogWarn "VM not reachable - start with .\dev-local.ps1" }

# Initial build
Invoke-BuildRust
Invoke-BuildFrontend
$Global:rumahlStatusDirty = $true

if (-not $Watch) {
    Tui-LogInfo "Build complete; -NoWatch set, exiting."
    Start-Sleep 1
    Tui-Shutdown
    exit 0
}

Start-Watchers
$Global:rumahlRustDirty = $false
$Global:rumahlFeDirty   = $false

Tui-LogOk "Watching for changes... (${$script:watchers.Count} watchers active)"
Tui-Render

# ═══════════════════════════════════════════════════════════════════════════
# EVENT LOOP
# ═══════════════════════════════════════════════════════════════════════════
try {
    while ($true) {
        # File change triggers
        if ($Global:rumahlRustDirty) {
            $Global:rumahlRustDirty = $false
            Start-Sleep -Milliseconds 600
            $Global:rumahlRustDirty = $false
            Invoke-BuildRust
            $Global:rumahlStatusDirty = $true
            Tui-Render
        }
        if ($Global:rumahlFeDirty) {
            $Global:rumahlFeDirty = $false
            Start-Sleep -Milliseconds 600
            $Global:rumahlFeDirty = $false
            Invoke-BuildFrontend
            $Global:rumahlStatusDirty = $true
            Tui-Render
        }

        # Status refresh
        if ($Global:rumahlStatusDirty) {
            $Global:rumahlStatusDirty = $false
            Tui-RenderStatus
        }

        # Keyboard input
        if ([Console]::KeyAvailable) {
            $k = [Console]::ReadKey($true)
            switch ($k.Key) {
                "B" {
                    Tui-LogInfo "Manual: full rebuild (Rust + Frontend)"
                    Tui-RenderContent
                    $Global:rumahlRustDirty = $true; $Global:rumahlFeDirty = $true
                }
                "R" {
                    Tui-LogInfo "Manual: Rust rebuild"
                    Tui-RenderContent
                    $Global:rumahlRustDirty = $true
                }
                "F" {
                    Tui-LogInfo "Manual: Frontend rebuild"
                    Tui-RenderContent
                    $Global:rumahlFeDirty = $true
                }
                "D" {
                    if ($Script:VmOnline) {
                        Tui-LogInfo "Force re-deploying all binaries..."
                        Tui-RenderContent
                        Get-ChildItem $HashDir -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
                        Invoke-DeployMany $Script:AllServices
                        $Global:rumahlStatusDirty = $true
                        Tui-Render
                    } else { Tui-LogWarn "VM offline"; Tui-RenderContent }
                }
                "S" { Show-StatusFull; Tui-Render }
                "L" { Show-Logs; Tui-Render }
                "W" {
                    Tui-LogInfo "Opening https://localhost ..."
                    Start-Process "https://localhost" -ErrorAction SilentlyContinue
                    Tui-RenderContent
                }
                "H" { Show-Help; Tui-Render }
                "Q" {
                    Tui-LogInfo "Shutting down. VM keeps running."
                    Tui-LogDim "Stop VM: .\dev-local.ps1 -Stop"
                    Tui-RenderContent
                    Start-Sleep 1
                    break
                }
            }
            if ($k.Key -eq "Q") { break }
        }

        Start-Sleep -Milliseconds 100
    }
} finally {
    $Script:StatusTimer.Stop()
    $Script:StatusTimer.Dispose()
    Stop-Watchers
    Tui-Shutdown
}
