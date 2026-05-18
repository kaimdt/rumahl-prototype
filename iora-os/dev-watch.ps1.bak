# ═══════════════════════════════════════════════════════════════════
# IORA OS Dev-Loop - Watch, Cross-Compile, Sync to VM
# ═══════════════════════════════════════════════════════════════════
# Usage: .\dev-watch.ps1 [-SkipSccache] [-Target TARGET]
#
# Watches Rust sources, cross-compiles for the Linux VM target,
# syncs binaries to .iora-dev/ via the 9p shared folder.
# The VM picks them up via iora-hot-reload.
#
# Prerequisites (one-time):
#   rustup target add x86_64-unknown-linux-musl
#   cargo install sccache                              (optional)
# ═══════════════════════════════════════════════════════════════════

param(
    [switch]$SkipSccache,
    [string]$Target = "x86_64-unknown-linux-musl"
)

$ErrorActionPreference = "Continue"  # Don't die on native-command stderr (rustup, cargo, scoop)

# -- Auto-detect paths --------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Project root: git root or one level up
try {
    $ProjectRoot = git -C $ScriptDir rev-parse --show-toplevel 2>$null
} catch {
    $ProjectRoot = Split-Path -Parent $ScriptDir
}

# Workspace root (where Cargo.toml workspace lives)
$Workspace = $null
@(
    "$ProjectRoot\iora-os\backend",
    "$ProjectRoot\backend"
) | ForEach-Object {
    if (-not $Workspace -and (Test-Path "$_\Cargo.toml")) {
        $Workspace = $_
    }
}

if (-not $Workspace) {
    Write-Host "ERROR: Cannot find Rust workspace (iora-os/backend/ or backend/)" -ForegroundColor Red
    Write-Host "  Searched from: $ProjectRoot" -ForegroundColor Red
    exit 1
}

$SharedDir = "$ProjectRoot\.iora-dev"
$BinDir = "$SharedDir\binaries"
$SccacheDir = "$SharedDir\sccache"
$TriggerFile = "$BinDir\.trigger"
$DebounceMs = 1000

# -- Header -------------------------------------------------------------
$host.UI.RawUI.WindowTitle = "IORA OS Dev-Loop"
Clear-Host
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host " IORA OS Dev-Loop" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Workspace:  $Workspace"
Write-Host "  Target:     $Target"
Write-Host "  Shared dir: $SharedDir"
Write-Host "  Bin output: $BinDir"
Write-Host ""

# -- Shared folder check ------------------------------------------------
if (-not (Test-Path $SharedDir)) {
    Write-Host "  [!] Shared folder not found!" -ForegroundColor Red
    Write-Host "      Expected: $SharedDir" -ForegroundColor Red
    Write-Host "" -ForegroundColor Red
    Write-Host "  The dev-local.ps1 script creates this folder and shares" -ForegroundColor Yellow
    Write-Host "  it with the VM via 9p. Start the VM first:" -ForegroundColor Yellow
    Write-Host "    .\dev-local.ps1 -SkipWhpx" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  If the VM IS running, the folder should exist." -ForegroundColor Yellow
    Write-Host "  Check: ls $SharedDir" -ForegroundColor Yellow
    Write-Host ""
    # Create it anyway so the watcher doesn't fail later
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    New-Item -ItemType Directory -Force -Path $SccacheDir | Out-Null
}

# -- Dependencies: auto-install everything needed --------------------
Write-Host "  Checking dependencies..." -ForegroundColor DarkGray

# --- Scoop (package manager) ---
$scoopOk = $false
if (Get-Command scoop -ErrorAction SilentlyContinue) {
    $scoopOk = $true
    Write-Host "  scoop:      OK" -ForegroundColor DarkGray
} else {
    Write-Host "  scoop:      not installed" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Scoop is the recommended package manager for Windows." -ForegroundColor Yellow
    Write-Host "  It's needed to auto-install musl-cross (C cross-compiler)." -ForegroundColor Yellow
    Write-Host ""
    $choice = Read-Host "  Install scoop now? [Y/n]"
    if ($choice -eq '' -or $choice -eq 'y' -or $choice -eq 'Y') {
        Write-Host "  Installing scoop..." -ForegroundColor Yellow
        Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        irm get.scoop.sh | iex
        if (Get-Command scoop -ErrorAction SilentlyContinue) {
            $scoopOk = $true
            Write-Host "  scoop:      installed OK" -ForegroundColor Green
        } else {
            Write-Host "  scoop:      install failed - continuing without" -ForegroundColor Red
        }
    } else {
        Write-Host "  Skipping scoop install. Some auto-install features disabled." -ForegroundColor DarkGray
    }
}

# --- Rust target ---
$installedTargets = rustup target list --installed 2>&1
if ($installedTargets -notmatch [regex]::Escape($Target)) {
    Write-Host "  target:     installing $Target..." -ForegroundColor Yellow
    $prevEA = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    rustup target add $Target 2>&1 | Out-Null
    $ErrorActionPreference = $prevEA
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  target:     FAILED" -ForegroundColor Red
    } else {
        Write-Host "  target:     installed" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  target:     $Target OK" -ForegroundColor DarkGray
}

# --- Cross C compiler (native) ---
$crossCcInstalled = Get-Command x86_64-linux-musl-gcc -ErrorAction SilentlyContinue
$buildrootGcc = $false
@("$ProjectRoot\iora-os\output\host\bin", "$ProjectRoot\output\host\bin") | ForEach-Object {
    if (Test-Path "$_\x86_64-linux-gcc") { $buildrootGcc = $true }
}

if ($crossCcInstalled) {
    Write-Host "  cross-cc:   musl-gcc OK ($($crossCcInstalled.Source))" -ForegroundColor DarkGray
} elseif ($buildrootGcc) {
    Write-Host "  cross-cc:   Buildroot toolchain detected" -ForegroundColor DarkGray
} else {
    # No native cross-compiler - will use zigbuild (auto-installed if needed)
    Write-Host "  cross-cc:   none native (will use zigbuild)" -ForegroundColor DarkGray
}

# --- sccache (compile cache) ---
$env:SCCACHE_DIR = $SccacheDir
if (-not $SkipSccache) {
    if (Get-Command sccache -ErrorAction SilentlyContinue) {
        $env:RUSTC_WRAPPER = "sccache"
        $script:sccacheAvailable = $true
        Write-Host "  sccache:    OK" -ForegroundColor DarkGray
    } elseif ($scoopOk) {
        Write-Host "  sccache:    installing via scoop..." -ForegroundColor Yellow
        scoop install sccache 2>&1 | ForEach-Object {
            if ($_ -match "installed|error|ERROR") { Write-Host "              $_" -ForegroundColor DarkGray }
        }
        if (Get-Command sccache -ErrorAction SilentlyContinue) {
            $env:RUSTC_WRAPPER = "sccache"
            $script:sccacheAvailable = $true
            Write-Host "  sccache:    installed OK" -ForegroundColor Green
        } else {
            Write-Host "  sccache:    install failed - continuing without" -ForegroundColor Yellow
            $script:sccacheAvailable = $false
        }
    } elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
        Write-Host "  sccache:    installing via cargo (2-5 min)..." -ForegroundColor Yellow
        cargo install sccache 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "              $_" -ForegroundColor DarkGray }
        if (Get-Command sccache -ErrorAction SilentlyContinue) {
            $env:RUSTC_WRAPPER = "sccache"
            $script:sccacheAvailable = $true
            Write-Host "  sccache:    installed OK" -ForegroundColor Green
        } else {
            $script:sccacheAvailable = $false
        }
    } else {
        Write-Host "  sccache:    not found (optional)" -ForegroundColor DarkGray
        $script:sccacheAvailable = $false
    }
} else {
    Write-Host "  sccache:    disabled (-SkipSccache)" -ForegroundColor DarkGray
    $script:sccacheAvailable = $false
}

# -- Cross-compiler detection (needed for C/asm crates like ring) -----
# Priority: 1) Buildroot toolchain  2) system musl-gcc  3) system gnu-gcc
$CrossCc = $null
$CrossCcType = ""
$EffectiveTarget = $Target

# 1) Check Buildroot toolchain (from iora-os/output/host/bin/)
$buildrootPaths = @(
    "$ProjectRoot\iora-os\output\host\bin",
    "$ProjectRoot\output\host\bin"
)
foreach ($p in $buildrootPaths) {
    if (-not $CrossCc -and (Test-Path "$p\x86_64-linux-gcc")) {
        $CrossCc = "$p\x86_64-linux-gcc"
        $CrossCcType = "Buildroot"
        $EffectiveTarget = "x86_64-unknown-linux-gnu"
        $env:PATH = "$p;$env:PATH"
        # Tell cc-rs (C/asm compilation) which compiler to use
        $ccVar = "CC_$($EffectiveTarget.ToUpper().Replace('-', '_'))"
        Set-Item -Path "env:$ccVar" -Value "$CrossCc"
        Write-Host "  Toolchain:  Buildroot ($p)" -ForegroundColor Green
    }
}

# 2) Check system musl-gcc
if (-not $CrossCc) {
    $muslGcc = Get-Command x86_64-linux-musl-gcc -ErrorAction SilentlyContinue
    if ($muslGcc) {
        $CrossCc = $muslGcc.Source
        $CrossCcType = "musl"
        $EffectiveTarget = "x86_64-unknown-linux-musl"
        $ccVar = "CC_$($EffectiveTarget.ToUpper().Replace('-', '_'))"
        Set-Item -Path "env:$ccVar" -Value "$CrossCc"
        Write-Host "  Toolchain:  musl ($CrossCc)" -ForegroundColor Green
    }
}

# 3) Check system gnu-gcc
if (-not $CrossCc) {
    $gnuGcc = Get-Command x86_64-linux-gnu-gcc -ErrorAction SilentlyContinue
    if ($gnuGcc) {
        $CrossCc = $gnuGcc.Source
        $CrossCcType = "gnu"
        $EffectiveTarget = "x86_64-unknown-linux-gnu"
        $ccVar = "CC_$($EffectiveTarget.ToUpper().Replace('-', '_'))"
        Set-Item -Path "env:$ccVar" -Value "$CrossCc"
        Write-Host "  Toolchain:  gnu ($CrossCc)" -ForegroundColor Green
    }
}

# No native cross-compiler found - use zigbuild
$UseZigbuild = $false
if (-not $CrossCc) {
    # Check if cargo-zigbuild is installed
    $zigbuildOk = $false
    # Check for zig binary (required by cargo-zigbuild)
    $zigBin = Get-Command zig -ErrorAction SilentlyContinue
    $zigbuildBin = Get-Command cargo-zigbuild -ErrorAction SilentlyContinue

    if (-not $zigBin) {
        Write-Host "  zig:        not found (required by cargo-zigbuild)" -ForegroundColor Yellow
        if ($scoopOk) {
            Write-Host "              installing via scoop..." -ForegroundColor Yellow
            scoop install zig 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "              $_" -ForegroundColor DarkGray }
            $zigBin = Get-Command zig -ErrorAction SilentlyContinue
            if ($zigBin) { Write-Host "  zig:        installed OK" -ForegroundColor Green }
            else { Write-Host "  zig:        install failed" -ForegroundColor Red }
        } else {
            Write-Host "              Install: scoop install zig" -ForegroundColor DarkGray
            Write-Host "              Or: winget install zig.zig" -ForegroundColor DarkGray
        }
    }

    if ($zigbuildBin -and $zigBin) {
        $zigbuildOk = $true
        Write-Host "  Toolchain:  Zig (cargo-zigbuild)" -ForegroundColor Green
    } elseif ($zigBin) {
        Write-Host "  Toolchain:  installing cargo-zigbuild ..." -ForegroundColor Yellow
        cargo install cargo-zigbuild 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "              $_" -ForegroundColor DarkGray }
        $zigbuildBin = Get-Command cargo-zigbuild -ErrorAction SilentlyContinue
        if ($zigbuildBin) {
            $zigbuildOk = $true
            Write-Host "  Toolchain:  Zig (cargo-zigbuild) - ready" -ForegroundColor Green
        } else {
            Write-Host "  Toolchain:  FAILED to install cargo-zigbuild" -ForegroundColor Red
        }
    } else {
        Write-Host "  Toolchain:  Zig not available (install zig + cargo-zigbuild)" -ForegroundColor Yellow
        Write-Host "              scoop install zig && cargo install cargo-zigbuild" -ForegroundColor DarkGray
    }
    if ($zigbuildOk) {
        $UseZigbuild = $true
        # Zig targets have slightly different naming
        if ($Target -eq "x86_64-unknown-linux-musl") { $Target = "x86_64-unknown-linux-musl" }
    }
}

# Set cargo target to the effective target (may differ from user's -Target)
if ($EffectiveTarget -ne $Target) {
    Write-Host "  Target:     $EffectiveTarget (auto-selected for toolchain)" -ForegroundColor DarkGray
    $Target = $EffectiveTarget
}

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  [B] = force rebuild    [Q] = quit"
Write-Host "  [S] = sccache stats    [T] = toggle sccache"
Write-Host "  Watching for .rs / .toml changes..."
Write-Host ""

# -- Build function -----------------------------------------------------
$script:lastBuildTime = [DateTime]::MinValue
$script:buildCount = 0
$script:sccacheEnabled = $script:sccacheAvailable
$script:lastRustBuildInfo = ""
$script:lastFeBuildInfo = ""

function Invoke-WithRetry {
    param([ScriptBlock]$ScriptBlock, [int]$MaxRetries = 3, [int]$DelaySec = 2)
    $attempt = 0
    while ($attempt -lt $MaxRetries) {
        $attempt++
        try {
            & $ScriptBlock
            if ($LASTEXITCODE -eq 0) { return $true }
            if ($LASTEXITCODE -eq 255) {
                Write-Host "     SSH connection lost (attempt $attempt/$MaxRetries), retrying in ${DelaySec}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $DelaySec
                $DelaySec = [Math]::Min($DelaySec * 2, 15)
                continue
            }
            return $false
        } catch {
            if ($attempt -lt $MaxRetries) {
                Write-Host "     Command failed (attempt $attempt/$MaxRetries), retrying in ${DelaySec}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $DelaySec
                $DelaySec = [Math]::Min($DelaySec * 2, 15)
            } else {
                return $false
            }
        }
    }
    return $false
}

function Draw-Header {
    Clear-Host
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host " IORA OS Dev-Loop" -ForegroundColor Cyan
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host "  Workspace:  $Workspace"
    Write-Host "  Target:     $Target"
    Write-Host "  Shared dir: $SharedDir"
    Write-Host "  Bin output: $BinDir"
    if ($FrontendDir) { Write-Host "  Frontend:   $FrontendDir" }
    Write-Host ""
    Write-Host "==============================================================" -ForegroundColor Cyan
    Write-Host "  [B] = rebuild all  [F] = frontend    [Q] = quit"
    Write-Host "  [S] = sccache stats  [T] = toggle sccache"
    if ($script:lastRustBuildInfo) { Write-Host "  Rust:     $($script:lastRustBuildInfo)" -ForegroundColor DarkGray }
    if ($script:lastFeBuildInfo)   { Write-Host "  Frontend: $($script:lastFeBuildInfo)" -ForegroundColor DarkGray }
    Write-Host "  Watching for changes... (press key to act)" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Banner {
    Write-Host "--------------------------------------------------------------" -ForegroundColor DarkGray
}

function Build-AndSync {
    $now = [DateTime]::Now
    $elapsed = ($now - $script:lastBuildTime).TotalMilliseconds
    if ($elapsed -lt $DebounceMs) { return }
    $script:lastBuildTime = $now
    $script:buildCount++

    # Ensure output directories exist
    if (-not (Test-Path $BinDir)) {
        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    Write-Host ""
    Write-Banner
    Write-Host " [#$($script:buildCount)] Building workspace..." -ForegroundColor Yellow
    Write-Host "      $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor DarkGray
    Write-Banner

    Push-Location $Workspace
    try {
        # CRITICAL: PowerShell treats stderr from native commands as errors.
        # Cargo writes progress to stderr, so we must suppress that.
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'

        if ($script:UseZigbuild) {
            # Clear Windows OpenSSL paths so openssl-sys doesn't pick them up
            # (Windows .lib files can't be linked for a Linux target)
            $env:OPENSSL_LIB_DIR = ""
            $env:OPENSSL_INCLUDE_DIR = ""
            $env:OPENSSL_DIR = ""
            $env:OPENSSL_NO_VENDOR = "0"
            Write-Host "      (cross-compile mode - using rustls, no system OpenSSL needed)" -ForegroundColor DarkGray
            $cargoArgs = @(
                "zigbuild",
                "--target", $Target,
                "--workspace",
                "--color", "always"
            )
        } else {
            $cargoArgs = @(
                "build",
                "--target", $Target,
                "--workspace",
                "--color", "always"
            )
        }

        # Run cargo - don't capture stderr as errors
        $output = & cargo $cargoArgs 2>&1
        $exitCode = $LASTEXITCODE

        $ErrorActionPreference = $prevEA

        # Show output (already captured, just write it)
        if ($output) {
            $output | ForEach-Object { Write-Host $_ }
        }
    }
    catch {
        $exitCode = 1
        Write-Host "  ERROR: $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }

    $sw.Stop()

    if ($exitCode -eq 0) {
        Write-Host ""
        Write-Host "  OK  Build OK ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
        Write-Host "  Deploying to VM via SCP..." -ForegroundColor DarkGray

        $targetDir = "$Workspace\target\$Target\debug"
        $synced = 0
        $errors = @()
        $restarted = @()

        # SSH config
        $sshKey = Join-Path $ProjectRoot "iora-os\.cache\iora-dev-key"
        $sshBase = @("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=NUL", "-o", "IdentitiesOnly=yes", "-o", "AddressFamily=inet", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-i", $sshKey, "-p", "2222")
        $scpBase = @("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=NUL", "-o", "IdentitiesOnly=yes", "-o", "AddressFamily=inet", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3", "-i", $sshKey, "-P", "2222")

        # AUTO-DISCOVER: scan all iora-* binaries in the build output
        # Works for services/, tools/, apps/system/, and any future crates
        $allBins = Get-ChildItem $targetDir -Filter "iora-*" | Where-Object { -not $_.PSIsContainer -and $_.Name -notmatch '\.(d|pdb|rlib|rmeta)$' } | Sort-Object Name

        if ($allBins.Count -gt 0) {
            # Pre-create ALL directories on VM in one SSH call
            $dirList = ($allBins | ForEach-Object { "/opt/iora/build/$($_.Name)/bin" }) -join ' '
            & ssh $sshBase "root@127.0.0.1" "mkdir -p $dirList" 2>$null | Out-Null

            foreach ($binFile in $allBins) {
                $name = $binFile.Name
                $bin = $binFile.FullName

                try {
                    # Deploy to /usr/bin/ (where systemd expects it)
                    $vmPath = "/usr/bin/$name"
                    & scp $scpBase $bin "root@127.0.0.1:$vmPath"
                    $scpOk = ($LASTEXITCODE -eq 0)
                    if (-not $scpOk) {
                        Write-Host "     SCP retrying $name..." -ForegroundColor Yellow
                        Start-Sleep -Seconds 2
                        & scp $scpBase $bin "root@127.0.0.1:$vmPath"
                        $scpOk = ($LASTEXITCODE -eq 0)
                    }

                    if ($scpOk) {
                        Write-Host "    -> $name" -ForegroundColor DarkGray
                        $synced++

                        # Also copy to /opt/iora/build/ for systemd path units
                        & ssh $sshBase "root@127.0.0.1" "mkdir -p /opt/iora/build/$name/bin && cp /usr/bin/$name /opt/iora/build/$name/bin/$name && chmod 755 /usr/bin/$name /opt/iora/build/$name/bin/$name" 2>$null | Out-Null

                        # Restart systemd service if one exists
                        $restart = & ssh $sshBase "root@127.0.0.1" "systemctl restart $name 2>/dev/null && echo OK || echo SKIP" 2>$null
                        if ($restart -match "OK") { $restarted += $name }
                    } else {
                        $errors += "SCP failed: $name"
                    }
                } catch {
                    $errors += "Failed: $name - $_"
                }
            }
        }

        if ($restarted.Count -gt 0) {
            Write-Host "  Restarted: $($restarted -join ', ')" -ForegroundColor DarkGray
        }
        if ($errors.Count -gt 0) {
            Write-Host "  WARN: Some sync errors:" -ForegroundColor Yellow
            $errors | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
        }
        Write-Host "  Deployed $synced binaries" -ForegroundColor DarkGray
        $script:lastRustBuildInfo = "#$($script:buildCount) OK $([math]::Round($sw.Elapsed.TotalSeconds, 1))s, $synced binaries ($(Get-Date -Format 'HH:mm:ss'))"
        Write-Banner
        Draw-Header
    }
    else {
        Write-Host ""
        Write-Host "  FAIL  Build failed (exit code $exitCode)" -ForegroundColor Red
        Write-Host "        Check output above for compiler errors." -ForegroundColor DarkGray
        $script:lastRustBuildInfo = "#$($script:buildCount) FAILED ($(Get-Date -Format 'HH:mm:ss'))"
        Write-Banner
        Draw-Header
    }
}

# -- Frontend: detect, build, watch, deploy -------------------------
$FrontendDir = $null
$script:frontendBuildCount = 0
$script:lastFeBuildInfo = ""

# Auto-detect frontend directory relative to project root
@("$ProjectRoot\frontend", "$ScriptDir\..\..\frontend") | ForEach-Object {
    if (-not $FrontendDir -and (Test-Path "$_\package.json")) {
        $FrontendDir = $_
    }
}

$FrontendAvailable = $false
if ($FrontendDir) {
    $npmBin = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmBin -and (Test-Path "$FrontendDir\node_modules")) {
        $FrontendAvailable = $true
    }
}

function Build-AndSyncFrontend {
    if (-not $FrontendAvailable) { return }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $script:frontendBuildCount++

    Write-Host ""
    Write-Host "  [#$($script:frontendBuildCount)] Building frontend..." -ForegroundColor Yellow

    Push-Location $FrontendDir
    try {
        $prevEA = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = & npm run build 2>&1
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevEA
        if ($output) { $output | ForEach-Object { Write-Host $_ } }
    } catch {
        $exitCode = 1
    } finally {
        Pop-Location
    }
    $sw.Stop()

    if ($exitCode -eq 0) {
        Write-Host "  OK  Frontend OK ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
        Write-Host "  Deploying to VM..." -ForegroundColor DarkGray

        try {
            $tempTar = Join-Path $env:TEMP "iora-frontend-dist.tar.gz"
            Push-Location "$FrontendDir\dist"
            & tar -czf $tempTar * 2>$null
            Pop-Location

            if (Test-Path $tempTar) {
                & scp $scpBase $tempTar "root@127.0.0.1:/tmp/iora-frontend-dist.tar.gz" 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $deploy = & ssh $sshBase "root@127.0.0.1" "mkdir -p /opt/iora/build/dist && rm -rf /opt/iora/build/dist/* && tar xzf /tmp/iora-frontend-dist.tar.gz -C /opt/iora/build/dist && systemctl restart iora-home && echo DEPLOYED" 2>$null
                    if ($deploy -match "DEPLOYED") {
                        Write-Host "    -> frontend deployed + iora-home restarted" -ForegroundColor Green
                    }
                }
                Remove-Item $tempTar -Force 2>$null
            }
        } catch {
            Write-Host "  WARN: Deploy error: $_" -ForegroundColor Yellow
        }

        $script:lastFeBuildInfo = "#$($script:frontendBuildCount) OK $([math]::Round($sw.Elapsed.TotalSeconds, 1))s ($(Get-Date -Format 'HH:mm:ss'))"
        Draw-Header
    } else {
        Write-Host "  FAIL  Frontend build failed" -ForegroundColor Red
        $script:lastFeBuildInfo = "#$($script:frontendBuildCount) FAILED ($(Get-Date -Format 'HH:mm:ss'))"
        Draw-Header
    }
}

# -- File watchers ------------------------------------------------------
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $Workspace
$watcher.IncludeSubdirectories = $true
$watcher.Filter = "*.rs"
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::FileName
$watcher.EnableRaisingEvents = $true

$tomlWatcher = New-Object System.IO.FileSystemWatcher
$tomlWatcher.Path = $Workspace
$tomlWatcher.IncludeSubdirectories = $true
$tomlWatcher.Filter = "*.toml"
$tomlWatcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
$tomlWatcher.EnableRaisingEvents = $true

# Debounce timer - accumulate changes, fire once
$timer = $null
$syncRoot = New-Object Object

$onChange = {
    $changedFile = $Event.SourceEventArgs.FullPath
    # Skip target/ directory and .iora-dev/
    if ($changedFile -match '[\\/](target|\.iora-dev)[\\/]') { return }

    $short = $changedFile
    try { $short = $changedFile.Substring($Workspace.Length + 1) } catch { }

    Write-Host "  [watch] $short" -ForegroundColor DarkGray

    [System.Threading.Monitor]::Enter($syncRoot)
    try {
        if ($timer) {
            try { $timer.Stop(); $timer.Dispose() } catch { }
        }
        $timer = New-Object System.Timers.Timer($DebounceMs)
        $timer.AutoReset = $false
        $timer.add_Elapsed({ Build-AndSync })
        $timer.Start()
    }
    finally {
        [System.Threading.Monitor]::Exit($syncRoot)
    }
}

Register-ObjectEvent $watcher "Changed" -Action $onChange | Out-Null
Register-ObjectEvent $watcher "Created" -Action $onChange | Out-Null
Register-ObjectEvent $tomlWatcher "Changed" -Action $onChange | Out-Null

# Frontend watcher (if available)
if ($FrontendAvailable) {
    $feWatcher = New-Object System.IO.FileSystemWatcher
    $feWatcher.Path = $FrontendDir
    $feWatcher.IncludeSubdirectories = $true
    $feWatcher.Filter = "*"
    $feWatcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
    $feWatcher.EnableRaisingEvents = $true

    $feTimer = $null
    $feSyncRoot = New-Object Object

    $onFeChange = {
        $changedFile = $Event.SourceEventArgs.FullPath
        if ($changedFile -notmatch '[\\/](src|public)[\\/]' -and $changedFile -notmatch '[\\/](index\.html|package\.json|vite\.config\.\w+)$') { return }
        [System.Threading.Monitor]::Enter($feSyncRoot)
        try {
            if ($feTimer) { try { $feTimer.Stop(); $feTimer.Dispose() } catch { } }
            $feTimer = New-Object System.Timers.Timer($DebounceMs * 2)
            $feTimer.AutoReset = $false
            $feTimer.add_Elapsed({ Build-AndSyncFrontend })
            $feTimer.Start()
        } finally {
            [System.Threading.Monitor]::Exit($feSyncRoot)
        }
    }

    Register-ObjectEvent $feWatcher "Changed" -Action $onFeChange | Out-Null
}

# -- Show sccache stats -------------------------------------------------
function Show-SccacheStats {
    if (-not $script:sccacheEnabled) {
        Write-Host "  sccache is not enabled." -ForegroundColor DarkGray
        return
    }
    Write-Host ""
    Write-Host "  sccache stats:" -ForegroundColor Cyan
    sccache --show-stats 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ""
}

# -- Keyboard input loop ------------------------------------------------
Draw-Header
while ($true) {
    if ([Console]::KeyAvailable) {
        $key = [Console]::ReadKey($true)
        switch ($key.Key) {
            'B' { Build-AndSync; Build-AndSyncFrontend }
            'F' { Build-AndSyncFrontend }
            'S' { Show-SccacheStats; Draw-Header }
            'T' {
                $script:sccacheEnabled = -not $script:sccacheEnabled
                if ($script:sccacheEnabled) {
                    $env:RUSTC_WRAPPER = "sccache"
                }
                else {
                    Remove-Item Env:\RUSTC_WRAPPER -ErrorAction SilentlyContinue
                }
                Draw-Header
            }
            'Q' {
                Write-Host ""
                Write-Host "  Shutting down watcher..." -ForegroundColor Yellow
                if ($timer) {
                    try { $timer.Stop(); $timer.Dispose() } catch { }
                }
                if ($feTimer) {
                    try { $feTimer.Stop(); $feTimer.Dispose() } catch { }
                }
                $watcher.EnableRaisingEvents = $false
                $tomlWatcher.EnableRaisingEvents = $false
                $watcher.Dispose()
                $tomlWatcher.Dispose()
                if ($feWatcher) { $feWatcher.EnableRaisingEvents = $false; $feWatcher.Dispose() }
                Write-Host "  Done. ($($script:buildCount) Rust / $($script:frontendBuildCount) Frontend builds)" -ForegroundColor Green
                exit 0
            }
        }
    }
    Start-Sleep -Milliseconds 200
}
