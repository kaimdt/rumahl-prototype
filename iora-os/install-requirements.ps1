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
    if (Confirm-Yes "Install Scoop now? (no admin required)") {
        if ($Check) { Log-Warn "  (--check: would install Scoop)"; return }
        try {
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
            Invoke-RestMethod -Uri get.scoop.sh -UseBasicParsing | Invoke-Expression
            $env:PATH = "$env:USERPROFILE\scoop\shims;$env:PATH"
            if (Get-Command scoop -ErrorAction SilentlyContinue) {
                $script:Pm = "scoop"
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
    param([string]$Name, [string]$WingetId, [string]$ScoopName)
    if ($Check) {
        Log-Warn "  (--check: $Name)"
        return
    }
    switch ($Pm) {
        "winget" {
            if ($WingetId) {
                Log-Info "winget install $WingetId"
                winget install --silent --accept-package-agreements --accept-source-agreements --id $WingetId 2>&1 | Out-Null
            } else {
                Log-Warn "No winget id for $Name – please install manually"
            }
        }
        "scoop" {
            if ($ScoopName) {
                Log-Info "scoop install $ScoopName"
                scoop install $ScoopName 2>&1 | Out-Null
            } else {
                Log-Warn "No scoop name for $Name – please install manually"
            }
        }
    }
}

# ── Individual installers ───────────────────────────────────────────────
function Ensure-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) { Log-Ok "git already installed: $(git --version)"; return }
    Log-Info "Installing Git..."
    Install-Pkg "git" "Git.Git" "git"
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
}

function Ensure-Qemu {
    if (Get-Command qemu-system-x86_64 -ErrorAction SilentlyContinue) {
        Log-Ok "QEMU already installed."; return
    }
    Log-Info "Installing QEMU..."
    Install-Pkg "qemu" "qemu" "qemu"
    # Common path that's not always on PATH after install
    foreach ($p in @("$env:ProgramFiles\qemu", "$env:ProgramFiles(x86)\qemu")) {
        if ((Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
            Log-Info "Adding $p to PATH (current session)."
            $env:PATH = "$p;$env:PATH"
        }
    }
}

function Ensure-Wsl {
    if (Get-Command wsl -ErrorAction SilentlyContinue) {
        $vers = wsl --version 2>$null
        if ($vers) { Log-Ok "WSL2 already installed."; return }
    }
    Log-Warn "WSL2 not detected. dev-local.ps1 requires WSL2 for tar/ISO creation."
    if ($Check) { Log-Warn "  (--check: would install WSL2)"; return }
    if (-not (Test-Admin)) {
        Log-Warn "Admin rights required: run 'wsl --install' in an elevated PowerShell."
        return
    }
    Log-Info "Installing WSL2 + default Debian distribution..."
    wsl --install -d Debian --no-launch 2>&1 | Out-Null
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
            $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
            Log-Ok "rustup installed."
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
    Install-Pkg "zig" "zig.zig" "zig"
}

function Ensure-CargoExtras {
    if ($SkipRust) { return }
    if ($Check) { Log-Warn "  (--check: would cargo-install sccache + cargo-zigbuild)"; return }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { return }
    foreach ($c in @("sccache", "cargo-zigbuild")) {
        if (-not (Get-Command $c -ErrorAction SilentlyContinue)) {
            Log-Info "cargo install --locked $c (may take a minute) ..."
            cargo install --locked $c 2>&1 | Select-Object -Last 3 | ForEach-Object { Log-Info "    $_" }
        } else {
            Log-Ok "$c already installed."
        }
    }
}

function Ensure-Node {
    if ($SkipNode) { Log-Info "Skipping Node.js (-SkipNode)"; return }
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Log-Ok "Node.js already installed: $(node --version)"; return
    }
    Log-Info "Installing Node.js LTS..."
    Install-Pkg "node" "OpenJS.NodeJS.LTS" "nodejs-lts"
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
    Install-Pkg "docker" "Docker.DockerDesktop" $null
}

# ── Final summary ───────────────────────────────────────────────────────
function Show-Summary {
    Write-Host ""
    Log-Ok "Done. Summary:"
    $tools = @("git", "ssh", "qemu-system-x86_64", "wsl", "rustup", "cargo", "rustc", "node", "npm", "docker", "sccache", "cargo-zigbuild", "zig")
    foreach ($t in $tools) {
        $c = Get-Command $t -ErrorAction SilentlyContinue
        if ($c) {
            $ver = try { (& $t --version 2>$null | Select-Object -First 1) } catch { "" }
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

Show-Summary

if ($Check) {
    Log-Info "Re-run without -Check to actually install."
} else {
    Log-Ok "Installation complete. You may need to restart your shell so new PATH entries take effect."
}
