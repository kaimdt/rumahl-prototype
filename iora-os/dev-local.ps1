# ============================================================================
# dev-local.ps1 – IORA OS Dev Environment for Windows (Hyper-V)
# ============================================================================
# Startet IORA OS in einer lokalen Hyper-V-VM mit Hot Reload.
#
# Voraussetzungen:
#   - Windows 10/11 Pro oder Enterprise (Hyper-V)
#   - Hyper-V aktiviert (Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All)
#   - Administrator-Rechte (für Hyper-V VM-Erstellung)
#   - Rust + cargo (via rustup)
#   - Node.js + npm
#
# Verwendung (PowerShell als Administrator):
#   .\dev-local.ps1
#   .\dev-local.ps1 -BuildFirst
#   .\dev-local.ps1 -Ram 8GB -CpuCount 8 -DiskPath "C:\VMs\iora-os.img"
#   .\dev-local.ps1 -NoFrontend -NoBackend  # Nur VM starten
# ============================================================================

param(
    [switch] $BuildFirst,
    [switch] $NoFrontend,
    [switch] $NoBackend,
    [switch] $Headless,
    [switch] $KeepVM,
    [string] $Ram = "4GB",
    [int]    $CpuCount = 0,
    [string] $DiskPath = "",
    [int]    $SshPort = 2222,
    [switch] $Help
)

# ── Constants ───────────────────────────────────────────────────────────────
$VM_NAME       = "IORA-OS-Dev"
$VM_SWITCH     = "IORA-Dev-NAT"
$DEV_BRIDGE_PORT = 8101
$IORA_HOME_PORT  = 8126
$SCRIPT_DIR    = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT     = Split-Path -Parent $SCRIPT_DIR

# ── Help ────────────────────────────────────────────────────────────────────
if ($Help) {
    @"
IORA OS – Local Dev Environment for Windows (Hyper-V)

Usage: .\dev-local.ps1 [OPTIONS]

OPTIONS:
    -BuildFirst     Build the dev image before starting the VM (requires WSL/Linux)
    -NoFrontend     Skip Vite dev server (backend-only hot reload)
    -NoBackend      Skip Rust watcher (frontend-only hot reload)
    -Headless       No VM window (VM runs in background)
    -KeepVM         Don't delete the VM after exiting
    -Ram SIZE       VM RAM (default: 4GB)
    -CpuCount N     VM CPUs (default: host-CPUs/2)
    -DiskPath PATH  Path to IORA OS image (.img or .vhdx)
    -SshPort PORT   SSH port forwarding (default: 2222)
    -Help           This help

REQUIREMENTS:
    - Windows 10/11 Pro or Enterprise
    - Hyper-V enabled (run as Admin):
      Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
    - Administrator privileges

EXAMPLES:
    .\dev-local.ps1
    .\dev-local.ps1 -Ram 8GB -CpuCount 8
    .\dev-local.ps1 -DiskPath "C:\VMs\iora-os.img"
    .\dev-local.ps1 -Headless -KeepVM

ALTERNATIVE (recommended for most users):
    Use WSL2 + dev-local.sh for a simpler cross-platform experience.
    Install WSL2: wsl --install
    Then inside WSL2: ./iora-os/dev-local.sh
"@
    exit 0
}

# ── Colors ──────────────────────────────────────────────────────────────────
function Write-Info    { Write-Host "[INFO]  $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[OK]    $args" -ForegroundColor Green }
function Write-Warn    { Write-Host "[WARN]  $args" -ForegroundColor Yellow }
function Write-ErrorMsg { Write-Host "[ERROR] $args" -ForegroundColor Red }

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║     IORA OS – Local Dev Environment             ║" -ForegroundColor Cyan
Write-Host "  ║     Platform: Windows / Hyper-V                 ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Admin check ─────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-ErrorMsg "Administrator privileges required for Hyper-V."
    Write-Info "Restart PowerShell as Administrator and re-run."
    exit 1
}

# ── Prerequisites ───────────────────────────────────────────────────────────
Write-Info "Checking prerequisites..."

# Hyper-V
$hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction SilentlyContinue
if ($hyperv.State -ne "Enabled") {
    Write-ErrorMsg "Hyper-V is not enabled."
    Write-Info "Run as Administrator: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All"
    Write-Info "Then reboot and re-run this script."
    exit 1
}
Write-Success "Hyper-V is enabled"

# Hyper-V PowerShell module
if (-not (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
    Write-Warn "Hyper-V PowerShell module not loaded. Enabling..."
    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell -ErrorAction SilentlyContinue
}

# CPU count
if ($CpuCount -eq 0) {
    $CpuCount = [Environment]::ProcessorCount
    $CpuCount = [Math]::Max(2, [Math]::Floor($CpuCount / 2))
}
Write-Info "VM CPUs: $CpuCount"
Write-Info "VM RAM:  $Ram"

# ── Find or prepare disk image ──────────────────────────────────────────────
function Find-DiskImage {
    if ($DiskPath -and (Test-Path $DiskPath)) {
        Write-Success "Using disk image: $DiskPath"
        return $DiskPath
    }

    # Search for existing images
    $searchDirs = @(
        (Join-Path $SCRIPT_DIR "releases"),
        (Join-Path $SCRIPT_DIR "buildroot-2024.02\output\images")
    )
    $found = @()
    foreach ($dir in $searchDirs) {
        if (Test-Path $dir) {
            $found += Get-ChildItem -Path $dir -Filter "iora-os*.img" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
        }
    }

    if ($found.Count -gt 0) {
        Write-Info "Found existing image(s):"
        for ($i = 0; $i -lt $found.Count; $i++) {
            $size = (Get-Item $found[$i]).Length / 1GB
            Write-Host "  [$($i+1)] $($found[$i]) ($([Math]::Round($size, 1)) GB)"
        }
        $choice = Read-Host "Use image [1] or type 'b' to build"
        if ($choice -eq 'b') {
            $script:BuildFirst = $true
        } elseif ([int]$choice -ge 1 -and [int]$choice -le $found.Count) {
            $script:DiskPath = $found[[int]$choice - 1]
            Write-Success "Using: $($script:DiskPath)"
            return $script:DiskPath
        }
    }

    # Need to build
    if ($BuildFirst) {
        Write-ErrorMsg "Buildroot build requires Linux or WSL2."
        Write-Info "Option 1: Build on Linux/WSL2 and copy the .img file to Windows."
        Write-Info "Option 2: Use WSL2: wsl --install; then inside WSL: ./iora-os/dev-local.sh --build-first"
        Write-Info "Option 3: Download a pre-built IORA OS Dev image."
        Write-Info ""
        Write-Info "Once you have the image, run:"
        Write-Info "  .\dev-local.ps1 -DiskPath C:\path\to\iora-os.img"
        exit 1
    }

    Write-ErrorMsg "No IORA OS image found."
    Write-Info "Build one first (on Linux/WSL2) or specify: -DiskPath PATH"
    exit 1
}

$DiskPath = Find-DiskImage

# ── Convert to VHDX if needed ───────────────────────────────────────────────
function Convert-ToVhdx {
    param([string] $SourcePath)
    
    $ext = [System.IO.Path]::GetExtension($SourcePath).ToLower()
    if ($ext -eq ".vhdx") {
        return $SourcePath
    }
    
    $vhdxPath = [System.IO.Path]::ChangeExtension($SourcePath, ".vhdx")
    if (Test-Path $vhdxPath) {
        Write-Info "VHDX already exists: $vhdxPath"
        return $vhdxPath
    }
    
    Write-Info "Converting .img to .vhdx (one-time)..."
    Write-Info "  Source: $SourcePath"
    Write-Info "  Target: $vhdxPath"
    
    # Use Convert-VHD or qemu-img
    $qemuImg = Get-Command qemu-img -ErrorAction SilentlyContinue
    if ($qemuImg) {
        & qemu-img convert -f raw -O vhdx "$SourcePath" "$vhdxPath"
    } else {
        # Fallback: Hyper-V's Convert-VHD (requires .vhd first)
        Write-Warn "qemu-img not found. Install QEMU for Windows or convert manually."
        Write-Warn "  qemu-img convert -f raw -O vhdx iora-os.img iora-os.vhdx"
        return $SourcePath  # Try raw .img directly
    }
    
    if (Test-Path $vhdxPath) {
        Write-Success "VHDX created: $vhdxPath"
        return $vhdxPath
    }
    return $SourcePath
}

$DiskPath = Convert-ToVhdx -SourcePath $DiskPath

# ── Create/configure Hyper-V VM ─────────────────────────────────────────────
function Setup-HyperVVM {
    # Remove existing VM if present
    $existing = Get-VM -Name $VM_NAME -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Warn "VM '$VM_NAME' already exists. Removing..."
        Stop-VM -Name $VM_NAME -Force -ErrorAction SilentlyContinue
        Remove-VM -Name $VM_NAME -Force -ErrorAction SilentlyContinue
    }

    # Remove existing VHDX copy if present
    $vmDir = Join-Path $env:USERPROFILE "IORA-VMs"
    New-Item -ItemType Directory -Force -Path $vmDir | Out-Null
    $vmDisk = Join-Path $vmDir "$VM_NAME.vhdx"
    
    Write-Info "Copying disk to VM directory..."
    Copy-Item $DiskPath $vmDisk -Force

    # Create NAT switch if needed
    $natSwitch = Get-VMSwitch -Name $VM_SWITCH -ErrorAction SilentlyContinue
    if (-not $natSwitch) {
        Write-Info "Creating Hyper-V NAT switch '$VM_SWITCH'..."
        New-VMSwitch -SwitchName $VM_SWITCH -SwitchType Internal | Out-Null
        
        # Configure NAT
        $natAdapter = Get-NetAdapter | Where-Object { $_.Name -like "*$VM_SWITCH*" } | Select-Object -First 1
        if ($natAdapter) {
            $natIp = "192.168.200.1"
            New-NetIPAddress -IPAddress $natIp -PrefixLength 24 -InterfaceIndex $natAdapter.InterfaceIndex -ErrorAction SilentlyContinue | Out-Null
            New-NetNat -Name "${VM_SWITCH}-NAT" -InternalIPInterfaceAddressPrefix "192.168.200.0/24" -ErrorAction SilentlyContinue | Out-Null
            Write-Success "NAT switch created (192.168.200.0/24)"
        }
    }

    # Create VM
    Write-Info "Creating Hyper-V VM: $VM_NAME"
    $vm = New-VM -Name $VM_NAME `
        -MemoryStartupBytes (Invoke-Expression $Ram) `
        -Generation 2 `
        -VHDPath $vmDisk `
        -SwitchName $VM_SWITCH `
        -ErrorAction Stop

    # Configure VM
    Set-VM -Name $VM_NAME -ProcessorCount $CpuCount -StaticMemory -CheckpointType Disabled
    Set-VMProcessor -VMName $VM_NAME -ExposeVirtualizationExtensions $true
    
    # Disable Secure Boot (required for custom Linux kernel)
    Set-VMFirmware -VMName $VM_NAME -EnableSecureBoot Off

    # Enable nested virtualization for Docker inside the VM
    Set-VMProcessor -VMName $VM_NAME -ExposeVirtualizationExtensions $true

    Write-Success "VM created: $VM_NAME"
    Write-Info "  RAM:      $Ram"
    Write-Info "  CPUs:     $CpuCount"
    Write-Info "  Disk:     $vmDisk"
    Write-Info "  Switch:   $VM_SWITCH"
}

Setup-HyperVVM

# ── Port forwarding (Windows Firewall + netsh) ──────────────────────────────
function Setup-PortForwarding {
    Write-Info "Setting up port forwarding..."

    # Get VM IP (will be assigned after boot, but we configure forwarding now)
    # For Hyper-V Internal switch, the VM typically gets DHCP from the NAT
    # We'll set up port forwarding via netsh once we know the VM IP
    
    # For now, just ensure the Windows Firewall allows inbound on these ports
    $ports = @($IORA_HOME_PORT, $DEV_BRIDGE_PORT, 8090, 8091, 8092, 8093, 8094, 8095, 8096, 8097, 8098, $SshPort)
    foreach ($port in $ports) {
        $ruleName = "IORA-Dev-Port-$port"
        $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        if (-not $existingRule) {
            New-NetFirewallRule -DisplayName $ruleName `
                -Direction Inbound -Protocol TCP -LocalPort $port `
                -Action Allow -Profile Any | Out-Null
        }
    }
    
    Write-Success "Firewall rules configured"
}

Setup-PortForwarding

# ── Start VM ────────────────────────────────────────────────────────────────
Write-Info "Starting VM..."
Start-VM -Name $VM_NAME

if (-not $Headless) {
    # Open VMConnect (Hyper-V's built-in viewer)
    Start-Process "vmconnect.exe" -ArgumentList "localhost", $VM_NAME -WindowStyle Normal
}

Write-Info "Waiting for VM to boot (this may take 30-90 seconds)..."
Write-Info "You can watch the boot in the Hyper-V console window."

# ── Wait for VM to be reachable ─────────────────────────────────────────────
$maxWait = 180
$waited = 0
$reachable = $false

# Get VM IP address
Write-Info "Detecting VM IP..."
$vmIp = ""
for ($i = 0; $i -lt 30; $i++) {
    $vmInfo = Get-VMNetworkAdapter -VMName $VM_NAME | Select-Object -ExpandProperty IPAddresses
    foreach ($ip in $vmInfo) {
        if ($ip -like "192.168.200.*" -or $ip -like "172.*" -or $ip -like "10.*") {
            $vmIp = $ip
            break
        }
    }
    if ($vmIp) { break }
    Start-Sleep -Seconds 2
}

if ($vmIp) {
    Write-Success "VM IP: $vmIp"
    
    # Set up port forwarding via netsh
    Write-Info "Configuring port forwarding to VM..."
    $natAdapter = Get-NetAdapter | Where-Object { $_.Name -like "*$VM_SWITCH*" } | Select-Object -First 1
    $hostIp = "0.0.0.0"
    
    # Use netsh for port forwarding
    $ports = @{
        $IORA_HOME_PORT = "8126"
        $DEV_BRIDGE_PORT = "8101"
        8090 = "8090"
        8091 = "8091"
        8092 = "8092"
        8093 = "8093"
        8094 = "8094"
        8095 = "8095"
        8096 = "8096"
        8097 = "8097"
        8098 = "8098"
        $SshPort = "22"
    }
    
    foreach ($hostPort in $ports.Keys) {
        $vmPort = $ports[$hostPort]
        $ruleName = "IORA-Dev-Fwd-${hostPort}"
        # Remove existing
        netsh interface portproxy delete v4tov4 listenport=$hostPort listenaddress=$hostIp 2>$null | Out-Null
        # Add new
        netsh interface portproxy add v4tov4 listenport=$hostPort listenaddress=$hostIp connectport=$vmPort connectaddress=$vmIp 2>$null
    }
    Write-Success "Port forwarding configured"
    
    # Wait for service
    Write-Info "Waiting for IORA OS services..."
    while ($waited -lt $maxWait) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:${DEV_BRIDGE_PORT}/dev/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $reachable = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 2
        $waited += 2
        if ($waited % 10 -eq 0) { Write-Host -NoNewline "." }
    }
    Write-Host ""
} else {
    Write-Warn "Could not detect VM IP. Using localhost port forwarding (assumes QEMU user-mode networking)."
    # Fallback: if using QEMU instead of Hyper-V, ports are forwarded to localhost
    while ($waited -lt $maxWait) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:${DEV_BRIDGE_PORT}/dev/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                $reachable = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 2
        $waited += 2
    }
}

if ($reachable) {
    Write-Success "IORA OS is running!"
} else {
    Write-Warn "IORA OS not reachable within ${maxWait}s."
    Write-Warn "Check the Hyper-V console window for boot progress."
}

# ── Status dashboard ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║  IORA OS Dev Environment – Status                       ║" -ForegroundColor Cyan
Write-Host "  ╠══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "  ║  VM:    Hyper-V $VM_NAME (IP: $vmIp)" -ForegroundColor White
Write-Host "  ╠══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "  ║  Dashboard:  http://localhost:${IORA_HOME_PORT}" -ForegroundColor Cyan
Write-Host "  ║  Dev Bridge:  http://localhost:${DEV_BRIDGE_PORT}/dev/health" -ForegroundColor Cyan
Write-Host "  ║  SSH:        ssh -p ${SshPort} root@localhost  (pass: iora)" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Start Rust watcher (optional) ───────────────────────────────────────────
if (-not $NoBackend) {
    $deployBin = Join-Path $SCRIPT_DIR "tools\iora-dev-deploy\target\release\iora-dev-deploy.exe"
    if (Test-Path $deployBin) {
        Write-Info "Starting Rust backend watcher..."
        Start-Process -FilePath $deployBin -ArgumentList "connect", "localhost:${DEV_BRIDGE_PORT}", "--token", "dev" -WindowStyle Hidden
        Start-Process -FilePath $deployBin -ArgumentList "watch", "--auto", "--debounce-ms", "2000" -WindowStyle Hidden
        Write-Success "Rust watcher started (check Task Manager for iora-dev-deploy.exe)"
    } else {
        Write-Warn "iora-dev-deploy.exe not found. Build it first: cargo build -p iora-dev-deploy --release"
    }
}

# ── Start Vite dev server (optional) ────────────────────────────────────────
if (-not $NoFrontend) {
    $frontendDir = Join-Path $REPO_ROOT "frontend"
    if (Test-Path $frontendDir) {
        Write-Info "Starting Vite dev server..."
        Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory $frontendDir -WindowStyle Normal
        Write-Success "Frontend HMR: http://localhost:5173"
    } else {
        Write-Warn "Frontend directory not found: $frontendDir"
    }
}

# ── Keep running ────────────────────────────────────────────────────────────
Write-Host ""
Write-Info "Dev environment running. Press Ctrl+C to stop."
Write-Info "Or close this window (VM will keep running if -KeepVM was used)."

try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    if (-not $KeepVM) {
        Write-Info "Cleaning up..."
        Stop-VM -Name $VM_NAME -Force -ErrorAction SilentlyContinue
        Remove-VM -Name $VM_NAME -Force -ErrorAction SilentlyContinue
        Write-Success "VM removed."
    } else {
        Write-Info "VM '$VM_NAME' kept running (--KeepVM)."
        Write-Info "To stop: Stop-VM -Name $VM_NAME -Force"
        Write-Info "To remove: Remove-VM -Name $VM_NAME -Force"
    }
    
    # Clean up port forwarding
    Write-Info "Removing port forwarding..."
    netsh interface portproxy reset 2>$null | Out-Null
    
    Write-Success "Cleanup complete."
}
