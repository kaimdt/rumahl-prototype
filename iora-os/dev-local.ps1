# ============================================================================
# dev-local.ps1 – IORA OS Local Dev VM (Windows)
# ============================================================================
# Startet Debian 12 x86_64/ARM64 Cloud-VM via QEMU.
# Verwendet cloud-init seed ISO für automatische Konfiguration (SSH, User, Pakete).
# Dann: SSH → rsync Projekt → bauen → starten.
#
# Voraussetzungen:
#   - QEMU (winget install QEMU.QEMU  oder  choco install qemu)
#   - WSL2 (wsl --install) für rsync & ISO-Generierung
#   - OpenSSH-Client (Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0)
#
# Verwendung (PowerShell als Admin NICHT nötig):
#   .\dev-local.ps1
#   .\dev-local.ps1 -Clean
#   .\dev-local.ps1 -CleanAll
#   .\dev-local.ps1 -Ram 8GB -CpuCount 4
# ============================================================================

param(
    [switch] $Clean,
    [switch] $CleanAll,
    [ValidatePattern('^\d+GB$')]
    [string] $Ram = "",
    [ValidateRange(1, 64)]
    [int]    $CpuCount = 0,
    [ValidateRange(1024, 65535)]
    [int]    $SshPort = 2222,
    [string] $QemuPath = "",
    [switch] $Help
)

$ErrorActionPreference = "Stop"

# ── Friendly error for Linux-style double-dash arguments ──────────────────
$doubleDashArgs = $MyInvocation.Line -split '\s+' | Where-Object { $_ -match '^--' }
if ($doubleDashArgs) {
    Write-Host "[X] PowerShell uses single-dash arguments: -Clean not --clean" -ForegroundColor Red
    Write-Host "    Try: .\dev-local.ps1 -Clean" -ForegroundColor Yellow
    exit 1
}

# ── Help ────────────────────────────────────────────────────────────────────
if ($Help) {
    @"
IORA OS – Local Dev VM for Windows (QEMU)

Usage: .\dev-local.ps1 [OPTIONS]

OPTIONS:
    -Clean          Remove VM cache (disk overlay, seed ISO, SSH key)
    -CleanAll       Also remove downloaded Debian cloud image
    -Ram SIZE       VM RAM (e.g. 8GB). Default: auto (60% of host RAM, 4-12GB)
    -CpuCount N     VM CPUs. Default: host-CPUs / 2
    -SshPort PORT   SSH port on localhost (default: 2222)
    -QemuPath PATH  Custom QEMU installation path
    -Help           This help

REQUIREMENTS:
    - QEMU:        winget install QEMU.QEMU  (or choco install qemu)
    - WSL2:        wsl --install  (for rsync + ISO creation)
    - OpenSSH:     Already included in Windows 10/11

EXAMPLES:
    .\dev-local.ps1
    .\dev-local.ps1 -Ram 8GB -CpuCount 8
    .\dev-local.ps1 -CleanAll
"@
    exit 0
}

# ── Colors ──────────────────────────────────────────────────────────────────
function Write-Info    { Write-Host "[*] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[+] $args" -ForegroundColor Green }
function Write-Warn    { Write-Host "[!] $args" -ForegroundColor Yellow }
function Write-ErrorMsg { Write-Host "[X] $args" -ForegroundColor Red }

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  IORA OS - Local Dev VM (Windows / QEMU)" -ForegroundColor Cyan
Write-Host ""

# ── Paths ───────────────────────────────────────────────────────────────────
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REPO_ROOT  = Split-Path -Parent $SCRIPT_DIR
$CACHE      = Join-Path $SCRIPT_DIR ".cache"
New-Item -ItemType Directory -Force -Path $CACHE | Out-Null

# ── Platform detection ──────────────────────────────────────────────────────
$HOST_ARCH = (Get-WmiObject Win32_Processor).Architecture
if ($HOST_ARCH -eq 12) { $HOST_ARCH = "ARM64" } else { $HOST_ARCH = "x86_64" }
$HOST_CPUS = [Environment]::ProcessorCount

# ── QEMU detection ──────────────────────────────────────────────────────────
function Find-Qemu {
    if ($QemuPath -and (Test-Path $QemuPath)) { return $QemuPath }

    $qemuBin = if ($HOST_ARCH -eq "ARM64") { "qemu-system-aarch64.exe" } else { "qemu-system-x86_64.exe" }

    $paths = @(
        (Get-Command $qemuBin -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        (Join-Path $env:ProgramFiles "qemu\$qemuBin"),
        (Join-Path ${env:ProgramFiles(x86)} "qemu\$qemuBin"),
        (Join-Path $env:LOCALAPPDATA "Programs\qemu\$qemuBin"),
        "C:\Program Files\qemu\$qemuBin"
    )
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) {
            Write-Success "QEMU found: $p"
            return $p
        }
    }
    Write-ErrorMsg "QEMU not found."
    Write-Info "Install: winget install QEMU.QEMU"
    Write-Info "Or: choco install qemu"
    exit 1
}

$QEMU_BIN = Find-Qemu
$QEMU_DIR = Split-Path -Parent $QEMU_BIN
$QEMU_IMG = Join-Path $QEMU_DIR "qemu-img.exe"

# ── WSL detection ───────────────────────────────────────────────────────────
$WSL_AVAILABLE = $false
try {
    $wslCheck = wsl --status 2>&1
    if ($LASTEXITCODE -eq 0) { $WSL_AVAILABLE = $true }
} catch { }
if (-not $WSL_AVAILABLE) {
    Write-ErrorMsg "WSL2 is required for ISO generation and rsync."
    Write-Info "Install: wsl --install"
    Write-Info "Then reboot and re-run this script."
    exit 1
}
Write-Success "WSL2 available"

# ── SSH detection ───────────────────────────────────────────────────────────
$SSH_BIN = Get-Command ssh.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $SSH_BIN) {
    Write-ErrorMsg "OpenSSH Client not found."
    Write-Info "Install: Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"
    exit 1
}
$SCP_BIN = Get-Command scp.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source

# ── Config ───────────────────────────────────────────────────────────────────
# Dynamische RAM-Berechnung
if ($Ram) {
    $VM_RAM = $Ram
} else {
    $totalRamMB = (Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1MB
    $hostRamGB = [Math]::Round($totalRamMB / 1024)
    if ($hostRamGB -lt 16) {
        $pct = 0.70  # 70% for small hosts
    } else {
        $pct = 0.60  # 60% for 16GB+ hosts
    }
    $vmRamGB = [Math]::Max(6, [Math]::Min(12, [Math]::Floor($hostRamGB * $pct)))
    $VM_RAM = "${vmRamGB}G"
}

# CPU
if ($CpuCount -eq 0) {
    $VM_CPUS = [Math]::Max(2, [Math]::Floor($HOST_CPUS / 2))
} else {
    $VM_CPUS = $CpuCount
}

# Cargo build jobs: 1 Job pro ~2.5GB VM-RAM
$vmRamNum = [int]($VM_RAM -replace 'G', '')
$CARGO_JOBS = [Math]::Max(1, [Math]::Min($VM_CPUS, [Math]::Floor($vmRamNum * 10 / 25)))

$VM_MACHINE = if ($HOST_ARCH -eq "ARM64") { "virt" } else { "q35" }

Write-Info "Host: ${hostRamGB}GB RAM, ${HOST_CPUS} CPUs"
Write-Info "VM: ${VM_RAM}, ${VM_CPUS} CPUs, cargo -j${CARGO_JOBS}"

# ── Arch-specific cloud image ────────────────────────────────────────────────
if ($HOST_ARCH -eq "ARM64") {
    $IMG_URL = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-arm64.qcow2"
    $IMG_CACHE = Join-Path $CACHE "debian-12-cloud-arm64.qcow2"
} else {
    $IMG_URL = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
    $IMG_CACHE = Join-Path $CACHE "debian-12-cloud-amd64.qcow2"
}
$VM_DISK  = Join-Path $CACHE "iora-dev-vm.qcow2"
$SSH_KEY  = Join-Path $CACHE "iora-dev-key"
$SEED_ISO = Join-Path $CACHE "iora-dev-seed.iso"

# ── Cleanup ──────────────────────────────────────────────────────────────────
if ($Clean -or $CleanAll) {
    Write-Info "Cleaning cache..."
    Get-ChildItem -Path $CACHE -File | Where-Object { $_.Name -notlike "debian-12-cloud-*.qcow2" } | Remove-Item -Force
    if ($CleanAll) {
        Remove-Item -Path $IMG_CACHE -Force -ErrorAction SilentlyContinue
    }
    Write-Success "Done. Run again without -Clean to start."
    exit 0
}

# ── Step 1: Download cloud image ────────────────────────────────────────────
if (-not (Test-Path $IMG_CACHE)) {
    Write-Info "Downloading Debian cloud image (one-time, ~400MB)..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $IMG_URL -OutFile "$IMG_CACHE.tmp" -TimeoutSec 600
    $sz = (Get-Item "$IMG_CACHE.tmp").Length
    if ($sz -gt 1048576) {
        Move-Item "$IMG_CACHE.tmp" $IMG_CACHE -Force
        Write-Success "Downloaded ($([Math]::Round($sz/1048576)) MB)"
    } else {
        Remove-Item "$IMG_CACHE.tmp" -Force
        Write-ErrorMsg "Download failed."
        exit 1
    }
    $ProgressPreference = 'Continue'
}

# ── Step 2: Create VM disk ──────────────────────────────────────────────────
if (-not (Test-Path $VM_DISK)) {
    Write-Info "Creating VM disk..."
    & $QEMU_IMG create -f qcow2 -b $IMG_CACHE -F qcow2 $VM_DISK 20G | Out-Null
}

# ── Step 3: Generate SSH key & cloud-init seed ISO ──────────────────────────
if (-not (Test-Path $SSH_KEY)) {
    Write-Info "Generating SSH key for VM access..."
    # Convert Windows path to WSL path (forward slashes)
    $sshKeyWin = $SSH_KEY.Replace('\', '/')
    $sshKeyWsl = wsl wslpath -a "$sshKeyWin"
    # Use bash -c to properly handle empty passphrase
    wsl bash -c "ssh-keygen -t ed25519 -f '$sshKeyWsl' -N '' -C 'iora-dev-vm'" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorMsg "Failed to generate SSH key. Check WSL."
        exit 1
    }
    Write-Success "SSH key created: $SSH_KEY"
}

$pubkey = Get-Content "$SSH_KEY.pub" -Raw
$pubkey = $pubkey.Trim()

function Generate-SeedIso {
    Write-Info "Generating cloud-init seed ISO..."
    $seedDir = Join-Path $CACHE "seed"
    Remove-Item -Recurse -Force $seedDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $seedDir | Out-Null

    $userData = @"
#cloud-config
ssh_pwauth: true
disable_root: false

hostname: iora-dev

users:
  - name: root
    ssh_authorized_keys:
      - $pubkey
  - name: iora
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    groups: sudo, docker
    ssh_authorized_keys:
      - $pubkey

chpasswd:
  list: |
    root:iora
    iora:iora
  expire: false

datasource_list: [ NoCloud ]

packages:
  - curl
  - git
  - build-essential
  - pkg-config
  - libssl-dev
  - nodejs
  - npm
  - docker.io
  - postgresql
  - postgresql-client
  - rsync
  - python3
  - python3-pip
  - htop
  - vim

runcmd:
  - usermod -aG docker iora
  - systemctl enable docker --now
  - systemctl enable postgresql --now
  - su - postgres -c "psql -c \"CREATE USER iora WITH PASSWORD 'iora' CREATEDB\"" 2>/dev/null || true
  - su - iora -c "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable"
  - mkdir -p /etc/iora && touch /etc/iora/ssh-ready

final_message: "IORA Dev VM ready. SSH: ssh -p $SshPort root@localhost (pw: iora)"
"@

    $userData | Set-Content -Path (Join-Path $seedDir "user-data") -NoNewline
    $metaData = @"
instance-id: iora-dev-vm
local-hostname: iora-dev
"@
    $metaData | Set-Content -Path (Join-Path $seedDir "meta-data") -NoNewline

    # Use WSL to create the ISO (genisoimage or mkisofs)
    $seedDirWsl = wsl wslpath -a "$($seedDir.Replace('\', '/'))"
    $seedIsoWsl = wsl wslpath -a "$($SEED_ISO.Replace('\', '/'))"

    $isoCreated = $false
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    if (wsl bash -c 'command -v genisoimage' 2>$null) {
        wsl genisoimage -output "$seedIsoWsl" -volid cidata -joliet -rock "$seedDirWsl" 2>&1 | Out-Null
        $isoCreated = ($LASTEXITCODE -eq 0)
    }
    if (-not $isoCreated) {
        if (wsl bash -c 'command -v mkisofs' 2>$null) {
            wsl mkisofs -output "$seedIsoWsl" -volid cidata -joliet -rock "$seedDirWsl" 2>&1 | Out-Null
            $isoCreated = ($LASTEXITCODE -eq 0)
        }
    }
    if (-not $isoCreated) {
        wsl sudo apt-get update -qq 2>&1 | Out-Null
        wsl sudo apt-get install -y -qq genisoimage 2>&1 | Out-Null
        wsl genisoimage -output "$seedIsoWsl" -volid cidata -joliet -rock "$seedDirWsl" 2>&1 | Out-Null
        $isoCreated = ($LASTEXITCODE -eq 0)
    }
    $ErrorActionPreference = $prevErrorAction

    Remove-Item -Recurse -Force $seedDir -ErrorAction SilentlyContinue

    if ($isoCreated) {
        Write-Success "Seed ISO created: $SEED_ISO"
    } else {
        Write-ErrorMsg "Failed to create seed ISO. Install genisoimage in WSL."
        exit 1
    }
}

if (-not (Test-Path $SEED_ISO)) {
    Generate-SeedIso
}

# ── Step 4: Start QEMU ──────────────────────────────────────────────────────
Write-Info "Starting QEMU..."

$qemuArgs = @(
    "-m", $VM_RAM,
    "-smp", $VM_CPUS,
    "-drive", "file=$VM_DISK,format=qcow2,if=virtio",
    "-drive", "file=$SEED_ISO,format=raw,if=virtio,readonly=on",
    "-netdev", "user,id=n0,hostfwd=tcp::8126-:8126,hostfwd=tcp::8101-:8101,hostfwd=tcp::${SshPort}-:22",
    "-device", "virtio-net-pci,netdev=n0",
    "-name", "IORA-Dev",
    "-cpu", "max",
    "-machine", "${VM_MACHINE},accel=whpx",
    "-device", "virtio-gpu",
    "-serial", "none",
    "-display", "gtk,show-cursor=on"
)

# ARM64-specific adjustments
if ($HOST_ARCH -eq "ARM64") {
    # Find UEFI firmware
    $fwSearch = @(
        (Join-Path $QEMU_DIR "..\share\qemu\edk2-aarch64-code.fd"),
        (Join-Path $QEMU_DIR "edk2-aarch64-code.fd")
    )
    $fw = $null
    foreach ($f in $fwSearch) {
        if (Test-Path $f) { $fw = $f; break }
    }
    if ($fw) { $qemuArgs = @("-bios", $fw) + $qemuArgs }
    $qemuArgs += @("-boot", "order=d,menu=off")
    # Replace virtio-net-pci with virtio-net-device
    for ($i = 0; $i -lt $qemuArgs.Count; $i++) {
        if ($qemuArgs[$i] -eq "virtio-net-pci,netdev=n0") {
            $qemuArgs[$i] = "virtio-net-device,netdev=n0"
        }
    }
}

function Start-QemuVM {
    param([string[]] $QemuArgs, [string] $AccelType)
    Write-Info "QEMU ($AccelType): $QEMU_BIN"
    $nullFile = Join-Path $CACHE "qemu-stderr.log"
    $proc = Start-Process -FilePath $QEMU_BIN -ArgumentList $QemuArgs -PassThru -NoNewWindow -RedirectStandardError $nullFile
    Write-Success "QEMU PID: $($proc.Id)"
    return $proc
}

function Test-QemuAlive {
    param($Proc, [int] $WaitSec = 15)
    for ($i = 0; $i -lt $WaitSec; $i++) {
        Start-Sleep -Seconds 1
        if ($Proc.HasExited) { return $false }
    }
    return $true
}

# Try WHPX first
$qemuArgs = $qemuArgs -replace 'accel=whpx', 'accel=whpx'
$qemuProc = Start-QemuVM -QemuArgs $qemuArgs -AccelType "WHPX"

if (-not (Test-QemuAlive -Proc $qemuProc -WaitSec 15)) {
    Write-Warn "QEMU/WHPX crashed (exit: $($qemuProc.ExitCode)). Retrying with TCG..."
    $qemuArgs = $qemuArgs -replace 'accel=whpx', 'accel=tcg'
    $qemuProc = Start-QemuVM -QemuArgs $qemuArgs -AccelType "TCG"
    
    if (-not (Test-QemuAlive -Proc $qemuProc -WaitSec 10)) {
        Write-ErrorMsg "QEMU/TCG also crashed. Check QEMU installation."
        exit 1
    }
}

# ── Step 5: Wait for cloud-init to finish ───────────────────────────────────
Write-Info "Waiting for cloud-init to finish (first boot may take 2-5 min)..."

$maxWait = 300
$waited = 0
$ready = $false
$prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"

# Wait for SSH + cloud-init to finish
while ($waited -lt $maxWait) {
    # Check if QEMU is still running
    if ($qemuProc.HasExited) {
        $ErrorActionPreference = $prevEA
        Write-ErrorMsg "QEMU exited unexpectedly (exit code: $($qemuProc.ExitCode))."
        Write-Info "Check the QEMU console window for boot errors."
        Write-Info "If WHPX keeps crashing, disable Hyper-V: bcdedit /set hypervisorlaunchtype off && reboot"
        exit 1
    }
    $result = & $SSH_BIN -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3 -i $SSH_KEY -p $SshPort root@localhost "test -f /var/lib/cloud/instance/boot-finished && echo READY" 2>$null
    if ($result -match "READY") {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 5
    $waited += 5
    Write-Host -NoNewline "."
}
$ErrorActionPreference = $prevEA
Write-Host ""

if (-not $ready) {
    Write-ErrorMsg "Cloud-init did not finish within 5 minutes."
    Write-Info "Check the QEMU console for errors."
    Write-Info "Manually: ssh -i $SSH_KEY -p $SshPort root@localhost (pw: iora)"
    Write-Info "Then re-run this script."
    exit 1
}

Write-Success "SSH ready! (cloud-init configured everything)"

# ── Step 6: Setup IORA via SSH ──────────────────────────────────────────────
function Invoke-SSH {
    param([string] $Command)
    & $SSH_BIN -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -i $SSH_KEY -p $SshPort root@localhost $Command 2>&1
}

Write-Info "Uploading project via rsync..."
$repoWsl = wsl wslpath -a "$($REPO_ROOT.Replace('\', '/'))"
$keyWsl = wsl wslpath -a "$($SSH_KEY.Replace('\', '/'))"
$prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
wsl rsync -az --delete `
    --exclude='.git' --exclude='target' --exclude='node_modules' `
    --exclude='.cache' --exclude='buildroot-*' --exclude='releases' `
    --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' `
    -e "ssh -o StrictHostKeyChecking=accept-new -i $keyWsl -p $SshPort" `
    "$repoWsl/" "root@localhost:/home/iora/iora/" 2>&1 | Select-Object -Last 3
$ErrorActionPreference = $prevEA
Write-Success "Project uploaded"

Write-Info "Setting permissions..."
Invoke-SSH "chown -R iora:iora /home/iora/iora || sudo chown -R iora:iora /home/iora/iora" 2>$null | Out-Null

Write-Info "Installing build deps in VM..."
Invoke-SSH "apt-get update -qq && apt-get install -y -qq curl git build-essential pkg-config libssl-dev nodejs npm docker.io rsync python3 2>&1" 2>$null | Select-Object -Last 3
Invoke-SSH "su - iora -c 'curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y' 2>&1" 2>$null | Select-Object -Last 3

Write-Info "Setting up IORA OS compatibility..."
Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-compat.sh 2>&1" 2>$null | Select-Object -Last 5
Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-services.sh 2>&1" 2>$null | Select-Object -Last 5

Write-Info "Building IORA workspace (10-30 min first time)..."
$vmRamNum = [int]($VM_RAM -replace 'G', '')
if ($vmRamNum -lt 8) {
    Write-Info "RAM <8GB: building only core services (iora-core, iora-home, iora-dev-bridge, iora-cli)"
    $buildTargets = "-p iora-core -p iora-home -p iora-dev-bridge -p iora-cli"
} else {
    $buildTargets = "--workspace"
}
$buildCmd = "su - iora -c `". ~/.cargo/env && cd /home/iora/iora/iora-os/backend && CARGO_BUILD_JOBS=$CARGO_JOBS cargo build --release $buildTargets`""
try {
    $buildOutput = Invoke-SSH $buildCmd
    $buildOutput | Select-Object -Last 20
} catch {
    Write-Warn "Build had warnings (check output above)"
}

Write-Info "Deploying binaries..."
$deployScript = @'
for s in iora-core iora-home iora-control iora-assist iora-secrets \
         iora-watchdog iora-security iora-gateway iora-supervisor \
         iora-api iora-appstore iora-backup iora-connector iora-dev-bridge \
         iora-files iora-network-monitor iora-nginx iora-resource-manager iora-updater; do
  src="/home/iora/iora/iora-os/backend/target/release/$s"
  [ -f "$src" ] && { mkdir -p "/opt/iora/build/$s/bin"; cp "$src" "/opt/iora/build/$s/bin/$s"; chmod 755 "/opt/iora/build/$s/bin/$s"; echo "  $s"; }
done
# Install ora CLI
ORA_BIN="/home/iora/iora/iora-os/backend/target/release/ora"
if [ -f "$ORA_BIN" ]; then
  cp "$ORA_BIN" /usr/local/bin/ora && chmod 755 /usr/local/bin/ora && echo "  ora CLI"
fi
systemctl daemon-reload
systemctl start iora-core iora-home iora-dev-bridge 2>/dev/null || true
'@
# Write deploy script to temp file and execute via SSH
$deployPath = Join-Path $CACHE "deploy.sh"
$deployScript | Set-Content -Path $deployPath -NoNewline
& $SCP_BIN -o StrictHostKeyChecking=accept-new -i $SSH_KEY -P $SshPort $deployPath "root@localhost:/tmp/deploy.sh" 2>$null
Invoke-SSH "bash /tmp/deploy.sh" 2>&1
Remove-Item $deployPath -Force -ErrorAction SilentlyContinue

# ── Done ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Success "IORA Dev VM ready!"
Write-Host ""
Write-Host "  Dashboard:  http://localhost:8126" -ForegroundColor Cyan
Write-Host "  Dev Bridge:  http://localhost:8101/dev/health" -ForegroundColor Cyan
Write-Host "  SSH:        ssh -i $SSH_KEY -p $SshPort root@localhost" -ForegroundColor Cyan
Write-Host ""
Write-Info "Press Ctrl+C to stop. Closing window also kills QEMU."
Write-Info "To keep VM running: close QEMU window first, then Ctrl+C here."

try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    Write-Info "Stopping QEMU..."
    Stop-Process -Id $qemuProc.Id -Force -ErrorAction SilentlyContinue
    Write-Success "Done."
}
