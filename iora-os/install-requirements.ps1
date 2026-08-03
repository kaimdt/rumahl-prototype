# ============================================================================
# install-requirements.ps1 - IORA dependency installer for Windows
# ============================================================================
# Installs the tools needed for the dev VM workflow on Windows:
#   - QEMU                         (runs the Debian dev VM)
#   - OpenSSH client               (ships with Windows 10+, ensures enabled)
#   - Git                          (for repo + dev-watch.ps1 path lookup)
#   - Rust + cross-compile target  (rustup, x86_64-unknown-linux-gnu/musl)
#   - cargo-zigbuild + zig         (the cross-compile glue)
#   - sccache                      (optional but speeds up rebuilds)
#   - Node.js LTS                  (frontend build pipeline)
#   - WSL2                         (used by dev-local.ps1 for ISO creation)
#
# Modes:
#   .\install-requirements.ps1                  # Full install (recommended)
#   .\install-requirements.ps1 -DevOnly         # Just the dev-loop tools
#   .\install-requirements.ps1 -Check           # Show what's missing
#   .\install-requirements.ps1 -SkipDocker      # Don't install Docker Desktop
#   .\install-requirements.ps1 -SkipNode        # Skip Node.js
#   .\install-requirements.ps1 -SkipRust        # Skip Rust toolchain
#   .\install-requirements.ps1 -Yes             # Non-interactive
# ============================================================================

[CmdletBinding()]
param(
    [switch]$DevOnly,
    [switch]$Check,
    [switch]$SkipDocker,
    [switch]$SkipRust,
    [switch]$SkipNode,
    [switch]$Yes
)

$ErrorActionPreference = "Continue"

function Log-Info ($m)  { Write-Host "[*] $m" -ForegroundColor Cyan }
function Log-Ok   ($m)  { Write-Host "[+] $m" -ForegroundColor Green }
function Log-Warn ($m)  { Write-Host "[!] $m" -ForegroundColor Yellow }
function Log-Err  ($m)  { Write-Host "[X] $m" -ForegroundColor Red }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Refresh the current session's PATH from the registry (winget/scoop installs
# update the registry, not the running session – without this, freshly
# installed tools are invisible until the shell is restarted)
function Update-SessionPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $newPath = ""
    if ($machinePath) { $newPath = $machinePath }
    if ($userPath) { $newPath = if ($newPath) { "$newPath;$userPath" } else { $userPath } }
    if ($newPath) { $env:PATH = $newPath }
}

function Confirm-Yes {
    param([string]$Question)
    if ($Yes) { return $true }
    $a = Read-Host "$Question [Y/n]"
    return ($a -eq "" -or $a -match '^[yY]')
}

# ── Package manager: prefer winget, fall back to scoop ──────────────────
$Pm = $null
if (Get-Command winget -ErrorAction SilentlyContinue) { $Pm = "winget" }
elseif (Get-Command scoop -ErrorAction SilentlyContinue) { $Pm = "scoop" }

function Ensure-Pm {
    if ($Pm) { return }
    Log-Warn "No package manager found (winget or scoop)."
    if ($Check) { Log-Warn "  (--check: would install Scoop)"; return }
    if (Confirm-Yes "Install Scoop now? (no admin required)") {
        try {
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
            Invoke-RestMethod -Uri get.scoop.sh -UseBasicParsing | Invoke-Expression
            $env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"
            if (Get-Command scoop -ErrorAction SilentlyContinue) {
                $script:Pm = "scoop"
                Update-SessionPath
                Log-Ok "Scoop installed."
            }
        } catch {
            Log-Err "Failed to install Scoop: $_"
        }
    }
    if (-not $Pm) {
        Log-Err "Cannot continue without a package manager. Install winget or scoop manually."
        exit 1
    }
}

function Install-Pkg {
    param([string]$Name, [string]$WingetId, [string]$ScoopName, [scriptblock]$Verify = $null)
    if ($Check) {
        Log-Warn "  (--check: $Name)"
        return $false
    }
    foreach ($attempt in 1..2) {
        $ok = $false
        switch ($Pm) {
            "winget" {
                if ($WingetId) {
                    Log-Info "winget install $WingetId (attempt $attempt/2)"
                    winget install --silent --accept-package-agreements --accept-source-agreements --id $WingetId 2>&1 | Out-Null
                    Update-SessionPath
                    $ok = ($LASTEXITCODE -eq 0)
                } else {
                    Log-Warn "No winget id for $Name – please install manually"
                }
            }
            "scoop" {
                if ($ScoopName) {
                    Log-Info "scoop install $ScoopName (attempt $attempt/2)"
                    scoop install $ScoopName 2>&1 | Out-Null
                    Update-SessionPath
                    $ok = ($LASTEXITCODE -eq 0)
                } else {
                    Log-Warn "No scoop name for $Name – please install manually"
                }
            }
        }
        if ($ok) {
            if ($null -eq $Verify -or (& $Verify)) { return $true }
            Log-Warn "$Name installed but not verified yet – retrying..."
            Start-Sleep -Seconds 3
        }
    }
    return $false
}

# ── Individual installers ───────────────────────────────────────────────
function Ensure-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) { Log-Ok "git already installed: $(git --version)"; return }
    Log-Info "Installing Git..."
    if (Install-Pkg "git" "Git.Git" "git" -Verify { Get-Command git -ErrorAction SilentlyContinue }) {
        Log-Ok "git installed: $(git --version)"
    } elseif (-not $Check) {
        Log-Warn "git install failed – manual: https://git-scm.com"
    }
}

function Ensure-OpenSsh {
    $sshcmd = Get-Command ssh -ErrorAction SilentlyContinue
    if ($sshcmd) { Log-Ok "ssh already installed: $($sshcmd.Source)"; return }
    Log-Info "Enabling Windows OpenSSH client capability..."
    if ($Check) { Log-Warn "  (--check: would enable OpenSSH.Client)"; return }
    if (-not (Test-Admin)) {
        Log-Warn "Admin rights required to enable OpenSSH capability."
        Log-Warn "Install via: 'Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0'"
        return
    }
    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0 -ErrorAction SilentlyContinue | Out-Null
    if (Get-Command ssh -ErrorAction SilentlyContinue) {
        Log-Ok "OpenSSH enabled."
    } else {
        Log-Warn "OpenSSH still missing – re-run this script elevated or enable it manually."
    }
}

# QEMU detection (PATH + common install locations, arch-aware)
function Test-QemuInstalled {
    $qemuBin = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "qemu-system-aarch64.exe" } else { "qemu-system-x86_64.exe" }
    if (Get-Command $qemuBin -ErrorAction SilentlyContinue) { return $true }
    foreach ($p in @("$env:ProgramFiles\qemu\$qemuBin", "${env:ProgramFiles(x86)}\qemu\$qemuBin", "$env:LOCALAPPDATA\Programs\qemu\$qemuBin")) {
        if (Test-Path $p) { return $true }
    }
    return $false
}

function Ensure-Qemu {
    if (Test-QemuInstalled) { Log-Ok "QEMU already installed."; return }
    Log-Info "Installing QEMU..."
    # NOTE: the correct winget ID is QEMU.QEMU – the plain "qemu" ID does not exist
    if (Install-Pkg "qemu" "QEMU.QEMU" "qemu" -Verify { Test-QemuInstalled }) {
        Log-Ok "QEMU installed."
    } elseif (-not $Check) {
        Log-Warn "QEMU install failed – manual: winget install QEMU.QEMU"
    }
    # Common path that's not always on PATH after install
    foreach ($p in @("$env:ProgramFiles\qemu", "$env:ProgramFiles(x86)\qemu")) {
        if ((Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
            Log-Info "Adding $p to PATH (current session)."
            $env:PATH = "$p;$env:PATH"
        }
    }
}

# WSL detection / install with reboot detection (needed for tar/ISO creation)
function Test-WslInstalled {
    if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { return $false }
    wsl --status 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-RebootPending {
    $keys = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"
    )
    foreach ($k in $keys) { if (Test-Path $k) { return $true } }
    return $false
}

function Ensure-Wsl {
    if (Test-WslInstalled) { Log-Ok "WSL2 already installed."; return }
    Log-Warn "WSL2 not detected. dev-local.ps1 requires WSL2 for tar/ISO creation."
    if ($Check) { Log-Warn "  (--check: would install WSL2)"; return }
    if (-not (Test-Admin)) {
        Log-Warn "Admin rights required: run 'wsl --install -d Debian' in an elevated PowerShell, then re-run."
        return
    }
    Log-Info "Installing WSL2 + default Debian distribution..."
    wsl --install -d Debian --no-launch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { wsl --install -d Debian 2>&1 | Out-Null }
    if (Test-RebootPending) {
        Log-Warn "A reboot is required to finish the WSL installation. Reboot, then re-run this script."
    }
    if (Test-WslInstalled) { Log-Ok "WSL2 installed." } else { Log-Warn "WSL2 not ready yet (reboot may be pending)." }
}

# Hardware virtualization check (WHPX acceleration + WSL2 need it)
function Test-VirtualizationEnabled {
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        return [bool]$cs.HypervisorPresent
    } catch { return $false }
}

function Ensure-Rust {
    if ($SkipRust) { Log-Info "Skipping Rust (-SkipRust)"; return }
    if ((Get-Command rustup -ErrorAction SilentlyContinue) -and (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Log-Ok "Rust already installed: $(rustc --version)"
    } else {
        Log-Info "Installing rustup (stable, minimal profile)..."
        if ($Check) { Log-Warn "  (--check: would install rustup)"; return }
        $rustupUrl = "https://win.rustup.rs/x86_64"
        $rustupExe = Join-Path $env:TEMP "rustup-init.exe"
        try {
            Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupExe -UseBasicParsing
            & $rustupExe -y --default-toolchain stable --profile minimal
            Update-SessionPath
            if (Get-Command rustup -ErrorAction SilentlyContinue) {
                Log-Ok "rustup installed."
            } else {
                Log-Warn "rustup installed but not on PATH yet – open a new shell."
            }
        } catch {
            Log-Err "Failed to install rustup: $_"
        }
    }
    if (Get-Command rustup -ErrorAction SilentlyContinue) {
        Log-Info "Adding Linux cross-compile targets..."
        rustup target add x86_64-unknown-linux-gnu 2>$null | Out-Null
        rustup target add x86_64-unknown-linux-musl 2>$null | Out-Null
    }
}

function Ensure-Zig {
    if (Get-Command zig -ErrorAction SilentlyContinue) { Log-Ok "zig already installed."; return }
    Log-Info "Installing Zig (for cross-compilation)..."
    if (Install-Pkg "zig" "zig.zig" "zig" -Verify { Get-Command zig -ErrorAction SilentlyContinue }) {
        Log-Ok "zig installed."
    } elseif (-not $Check) {
        Log-Warn "zig install failed – manual: https://ziglang.org/download/"
    }
}

function Ensure-CargoExtras {
    if ($SkipRust) { return }
    if ($Check) { Log-Warn "  (--check: would cargo-install sccache + cargo-zigbuild)"; return }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { return }
    Update-SessionPath
    foreach ($c in @("sccache", "cargo-zigbuild")) {
        if (-not (Get-Command $c -ErrorAction SilentlyContinue)) {
            Log-Info "cargo install --locked $c (may take a minute) ..."
            cargo install --locked $c 2>&1 | Select-Object -Last 3 | ForEach-Object { Log-Info "    $_" }
        } else {
            Log-Ok "$c already installed."
        }
    }
}

function Test-NodeRuns {
    # Robust check: some systems have broken node shims (dead symlinks) that
    # pass Get-Command but fail on execution
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    try {
        $out = & node --version 2>$null
        return ($LASTEXITCODE -eq 0 -and $out)
    } catch { return $false }
}

function Ensure-Node {
    if ($SkipNode) { Log-Info "Skipping Node.js (-SkipNode)"; return }
    if (Test-NodeRuns) {
        Log-Ok "Node.js already installed: $(node --version)"; return
    }
    Log-Info "Installing Node.js LTS..."
    if (Install-Pkg "node" "OpenJS.NodeJS.LTS" "nodejs-lts" -Verify { Test-NodeRuns }) {
        Log-Ok "Node.js installed: $(node --version)"
    } elseif (-not $Check) {
        Log-Warn "Node.js install failed – manual: https://nodejs.org"
    }
}

function Ensure-Docker {
    if ($SkipDocker) { Log-Info "Skipping Docker Desktop (-SkipDocker)"; return }
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Log-Ok "Docker already installed: $(docker --version)"
        return
    }
    if ($DevOnly) {
        Log-Info "Skipping Docker (DevOnly mode)."
        return
    }
    Log-Info "Installing Docker Desktop..."
    if (Install-Pkg "docker" "Docker.DockerDesktop" $null) {
        Log-Ok "Docker Desktop installed – start it once and enable WSL2 integration."
    } elseif (-not $Check) {
        Log-Warn "Docker Desktop install failed – manual: https://www.docker.com/products/docker-desktop/"
    }
}

# ── Final summary ───────────────────────────────────────────────────────
# Get a tool's version string without tripping over broken shims (dead
# symlinks that pass Get-Command but fail on execution)
function Get-ToolVersion {
    param([string]$Tool)
    $cmd = Get-Command $Tool -ErrorAction SilentlyContinue
    if (-not $cmd -or -not $cmd.Source) { return "" }
    try {
        $item = Get-Item $cmd.Source -ErrorAction Stop
        if ($item.LinkType -and $item.Target) {
            $target = $item.Target
            if (-not [System.IO.Path]::IsPathRooted($target)) {
                $target = Join-Path (Split-Path -Parent $item.FullName) $target
            }
            if (-not (Test-Path $target)) { return "" }  # broken symlink
        }
    } catch { return "" }
    $oldEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try { $out = (& $Tool --version 2>$null | Select-Object -First 1) } catch { $out = "" }
    $ErrorActionPreference = $oldEAP
    return $out
}

function Show-Summary {
    Write-Host ""
    Log-Ok "Done. Summary:"
    $tools = @("git", "ssh", "qemu-system-x86_64", "wsl", "rustup", "cargo", "rustc", "node", "npm", "docker", "sccache", "cargo-zigbuild", "zig")
    foreach ($t in $tools) {
        $c = Get-Command $t -ErrorAction SilentlyContinue
        if ($c) {
            $ver = Get-ToolVersion $t
            Write-Host ("  {0,-20}" -f $t) -ForegroundColor Green -NoNewline
            Write-Host " $ver"
        } else {
            Write-Host ("  {0,-20}" -f $t) -ForegroundColor Yellow -NoNewline
            Write-Host " missing"
        }
    }
}

# ── Main ─────────────────────────────────────────────────────────────────
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host " IORA dev environment installer (Windows)" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
if ($Check) { Log-Warn "Running in --check mode – nothing will be installed." }

Ensure-Pm
Ensure-Git
Ensure-OpenSsh
Ensure-Qemu
Ensure-Wsl
Ensure-Rust
Ensure-Zig
Ensure-CargoExtras
Ensure-Node
Ensure-Docker

if (-not (Test-VirtualizationEnabled)) {
    Log-Warn "Hardware virtualization not detected – QEMU will fall back to slow software emulation (TCG)."
    Log-Warn "Enable VT-x/AMD-V in BIOS, or run: Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform"
}

Show-Summary

if ($Check) {
    Log-Info "Re-run without -Check to actually install."
} else {
    Log-Ok "Installation complete. You may need to restart your shell so new PATH entries take effect."
}
