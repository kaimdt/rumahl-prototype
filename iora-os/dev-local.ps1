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
    [switch] $SkipWhpx,
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

# Kill any stale QEMU processes from previous crashed runs
Get-Process qemu-system-x86_64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process qemu-system-aarch64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

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

# ── IORA Dev-Loop Shared Folder (host ↔ VM via 9p) ────────────────────
$IORA_DEV   = Join-Path $REPO_ROOT ".iora-dev"
$IORA_BINS  = Join-Path $IORA_DEV "binaries"
$IORA_SCC   = Join-Path $IORA_DEV "sccache"
New-Item -ItemType Directory -Force -Path $IORA_BINS | Out-Null
New-Item -ItemType Directory -Force -Path $IORA_SCC | Out-Null
Write-Info "Dev shared folder: $IORA_DEV"

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
# VM-Idealwerte: Wieviel braucht die VM zum flüssigen Entwickeln?
$VM_IDEAL_CPU = 16   # 12-16 Threads reichen f�r paralleles Compilieren
$VM_IDEAL_RAM = 16   # 16 GB reichen f�r release-Builds mit LTO

# Dynamische RAM-Berechnung
if ($Ram) {
    $VM_RAM = $Ram
} else {
    $totalRamMB = (Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1MB
    $hostRamGB = [Math]::Round($totalRamMB / 1024)
    # Logik: VM-Ideal = 16GB. Wenn Host genug hat (>= 22GB) -> VM = 16, Host = Rest.
    # Wenn Host knapp ist -> Host beh�lt mindestens 6GB, VM bekommt Rest.
    # Formel: Min(16GB, Max(6GB, Host-RAM - 6GB))
    #  32GB Host: Min(16, 26) = 16 GB VM  (Host: 16 GB)  f�r Host + IDE + Browser
    #  24GB Host: Min(16, 18) = 16 GB VM  (Host:  8 GB)
    #  16GB Host: Min(16, 10) = 10 GB VM  (Host:  6 GB)
    #  12GB Host: Min(16,  6) =  6 GB VM  (Host:  6 GB)
    #   8GB Host: Min(16,  2) =  6 GB VM  (Host:  2 GB)  Minimum
    $vmRamGB = [Math]::Min($VM_IDEAL_RAM, [Math]::Max(6, $hostRamGB - 6))
    $VM_RAM = "${vmRamGB}G"
}

# CPU
if ($CpuCount -eq 0) {
    # Logik: VM-Ideal = 16 Threads. Wenn Host genug hat (>= 18) -> VM = 16, Host = Rest.
    # Wenn Host knapp ist -> Host beh�lt mindestens 2 Threads, VM bekommt Rest.
    # Formel: Min(16, Max(2, Host-Threads - 2))
    #  32 Threads: Min(16, 30) = 16 VM  (Host: 16)  f�r Host-OS + IDE
    #  16 Threads: Min(16, 14) = 14 VM  (Host:  2)  close to ideal
    #  12 Threads: Min(16, 10) = 10 VM  (Host:  2)
    #   8 Threads: Min(16,  6) =  6 VM  (Host:  2)
    #   4 Threads: Min(16,  2) =  2 VM  (Host:  2)  Minimum
    $VM_CPUS = [Math]::Min($VM_IDEAL_CPU, [Math]::Max(2, $HOST_CPUS - 2))
} else {
    $VM_CPUS = $CpuCount
}

# Cargo parallel jobs: RAM/2.5 ist sicher f�r release-profile (~1.5-2GB/prozess)
# und locker f�r release-fast (~0.5-0.8GB/prozess). Mindestens 6GB f�r OS bleiben.
$vmRamNum = [int]($VM_RAM -replace 'G', '')
$CARGO_JOBS = [Math]::Max(1, [Math]::Min($VM_CPUS, [Math]::Floor($vmRamNum / 2.5)))

$VM_MACHINE = if ($HOST_ARCH -eq "ARM64") { "virt" } else { "q35" }

# Find UEFI firmware (Debian cloud image requires UEFI)
$FW = $null
$FW_CACHED = $null
if ($HOST_ARCH -eq "ARM64") {
    $fwPaths = @(
        (Join-Path $QEMU_DIR "..\share\qemu\edk2-aarch64-code.fd"),
        (Join-Path $QEMU_DIR "..\share\edk2-aarch64-code.fd"),
        (Join-Path $QEMU_DIR "edk2-aarch64-code.fd")
    )
    $fwIsFlash = $false
} else {
    $fwPaths = @(
        (Join-Path $QEMU_DIR "share\edk2-x86_64-code.fd"),
        (Join-Path $QEMU_DIR "edk2-x86_64-code.fd"),
        (Join-Path $QEMU_DIR "OVMF_CODE.fd")
    )
    $fwIsFlash = $true  # x86_64 OVMF needs if=pflash, not -bios
}
foreach ($f in $fwPaths) {
    if (Test-Path $f) { $FW = $f; break }
}
if (-not $FW) {
    Write-ErrorMsg "UEFI firmware not found. QEMU directory: $QEMU_DIR"
    Write-Info "Searched: $($fwPaths -join ', ')"
    Write-Info ""
    Write-Info "Option 1: winget install QEMU.QEMU  (reinstall)"
    Write-Info "Option 2: Download from https://github.com/tianocore/edk2/releases"
    Write-Info "         Place OVMF_CODE.fd next to qemu-system-x86_64.exe"
    exit 1
}
# Copy OVMF to cache (Program Files may be read-locked by Windows Defender)
if ($fwIsFlash) {
    $FW_CACHED = Join-Path $CACHE "OVMF_CODE.fd"
    Copy-Item $FW $FW_CACHED -Force -ErrorAction SilentlyContinue
    $FW = $FW_CACHED
}
Write-Success "UEFI firmware: $FW (flash=$fwIsFlash)"

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
    Write-Info "Killing stale QEMU processes..."
    Get-Process qemu-system-x86_64 -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-Process qemu-system-aarch64 -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Info "Cleaning cache..."
    Get-ChildItem -Path $CACHE -File | Where-Object { $_.Name -notlike "debian-12-cloud-*.qcow2" } | Remove-Item -Force -ErrorAction SilentlyContinue
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
    # Fix Windows permissions (WSL creates world-readable keys, SSH rejects them)
    icacls $SSH_KEY /inheritance:r /grant:r "${env:USERNAME}:R" 2>$null | Out-Null
    icacls "$SSH_KEY.pub" /inheritance:r /grant:r "${env:USERNAME}:R" 2>$null | Out-Null
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
  list:
    - root:iora
    - iora:iora
  expire: false

datasource_list: [ NoCloud ]

packages:
  - rsync

runcmd:
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
# Clean up old SSH host keys for our port
$prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
ssh-keygen -R "[127.0.0.1]:$SshPort" 2>$null | Out-Null
ssh-keygen -R "[localhost]:$SshPort" 2>$null | Out-Null
$ErrorActionPreference = $prevEA

Write-Info "Starting QEMU..."

$fwDrive = if ($fwIsFlash) { @("-drive", "if=pflash,format=raw,readonly=on,file=$FW") } else { @("-bios", $FW) }

$qemuArgs = @(
    "-m", $VM_RAM,
    "-smp", $VM_CPUS
) + $fwDrive + @(
    "-drive", "file=$VM_DISK,format=qcow2,if=virtio",
    "-cdrom", "$SEED_ISO",
    "-netdev", "user,id=n0,hostfwd=tcp::80-:80,hostfwd=tcp::443-:443,hostfwd=tcp::3001-:3001,hostfwd=tcp::5432-:5432,hostfwd=tcp::8080-:8080,hostfwd=tcp::8090-:8090,hostfwd=tcp::8092-:8092,hostfwd=tcp::8095-:8095,hostfwd=tcp::8097-:8097,hostfwd=tcp::8098-:8098,hostfwd=tcp::8101-:8101,hostfwd=tcp::8126-:8126,hostfwd=tcp::${SshPort}-:22",
    "-device", "e1000,netdev=n0",
    "-name", "IORA-Dev",
    "-machine", "${VM_MACHINE},accel=whpx",
    "-device", "virtio-gpu",
    "-serial", "none",
    "-display", "gtk,show-cursor=on"
)

# ARM64-specific adjustments
if ($HOST_ARCH -eq "ARM64") {
    $qemuArgs += @("-boot", "order=d,menu=off")
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

# Try WHPX first (skip if -SkipWhpx or overlay is freshly created)
$useWhpx = (-not $SkipWhpx)
if ($useWhpx) {
    $qemuAccel = "whpx"
    $qemuArgs = $qemuArgs -replace 'accel=whpx', 'accel=whpx'
    $qemuProc = Start-QemuVM -QemuArgs $qemuArgs -AccelType "WHPX"
    $whpxAlive = Test-QemuAlive -Proc $qemuProc -WaitSec 8
} else {
    $whpxAlive = $false
    $qemuAccel = "tcg"
    Write-Info "Skipping WHPX (--SkipWhpx active)"
}

if (-not $whpxAlive) {
    if ($useWhpx) {
        Write-Warn "QEMU/WHPX crashed."
        if (-not $qemuProc.HasExited) { $qemuProc.Kill(); Start-Sleep -Seconds 2 }
        # WHPX may have corrupted the overlay - recreate it
        Remove-Item $VM_DISK -Force -ErrorAction SilentlyContinue
        & $QEMU_IMG create -f qcow2 -b $IMG_CACHE -F qcow2 $VM_DISK 20G | Out-Null
        Write-Info "Overlay recreated after WHPX crash."
    }
    
    $qemuAccel = "tcg"
    # TCG: use dynamic RAM/CPUs (same-arch TCG is efficient enough)
    $tcgRam = [Math]::Max(4, [Math]::Min([int]($VM_RAM -replace 'G', ''), 8))
    $tcgCpus = [Math]::Max(2, [Math]::Min($VM_CPUS, 8))
    # Build TCG args from scratch
    $qemuArgs = @(
        "-m", "${tcgRam}G",
        "-smp", "$tcgCpus",
        "-machine", "q35,accel=tcg",
        "-drive", "if=pflash,format=raw,readonly=on,file=$FW",
        "-drive", "file=$VM_DISK,format=qcow2,if=virtio",
        "-drive", "file=$SEED_ISO,format=raw,media=cdrom",
        "-netdev", "user,id=n0,hostfwd=tcp::80-:80,hostfwd=tcp::443-:443,hostfwd=tcp::3001-:3001,hostfwd=tcp::5432-:5432,hostfwd=tcp::8080-:8080,hostfwd=tcp::8090-:8090,hostfwd=tcp::8092-:8092,hostfwd=tcp::8095-:8095,hostfwd=tcp::8097-:8097,hostfwd=tcp::8098-:8098,hostfwd=tcp::8101-:8101,hostfwd=tcp::8126-:8126,hostfwd=tcp::${SshPort}-:22",
        "-device", "e1000,netdev=n0",
        "-nographic"
    )
    Write-Info "TCG: ${tcgRam}GB RAM (capped), $tcgCpus CPUs, headless"
    $qemuProc = Start-QemuVM -QemuArgs $qemuArgs -AccelType "TCG"
    
    if (-not (Test-QemuAlive -Proc $qemuProc -WaitSec 20)) {
        Write-ErrorMsg "QEMU/TCG also crashed. Check QEMU installation."
        exit 1
    }
}

# ── Step 5: Wait for cloud-init to finish ───────────────────────────────────
Write-Info "Waiting for cloud-init to finish (first boot may take 2-5 min)..."

$maxWait = if ($qemuAccel -eq "tcg") { 600 } else { 600 }

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
    $result = & $SSH_BIN -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o AddressFamily=inet -i $SSH_KEY -p $SshPort root@127.0.0.1 "test -f /var/lib/cloud/instance/boot-finished && echo READY" 2>$null
    if ($result -match "READY") {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 5
    $waited += 5
    Write-Host -NoNewline "."
    if ($waited % 60 -eq 0 -and $waited -gt 0) {
        Write-Host -NoNewline "[${waited}s]"
    }
}
$ErrorActionPreference = $prevEA
Write-Host ""

if (-not $ready) {
$timeoutMsg = if ($qemuAccel -eq "tcg") { "10 minutes" } else { "5 minutes" }
    Write-ErrorMsg "Cloud-init did not finish within $timeoutMsg."
    Write-Info "Check the QEMU console for errors."
    Write-Info "Manually: ssh -i $SSH_KEY -p $SshPort root@localhost (pw: iora)"
    Write-Info "Then re-run this script."
    exit 1
}

Write-Success "SSH ready! (cloud-init configured everything)"

# ── Step 6: Setup IORA via SSH ──────────────────────────────────────────────
function Invoke-SSH {
    param([string] $Command)
    $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $result = & $SSH_BIN -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=5 -o AddressFamily=inet -i $SSH_KEY -p $SshPort root@127.0.0.1 $Command 2>&1
    $ErrorActionPreference = $prev
    return $result
}

Write-Info "Uploading project via tar+scp (WSL cannot reach Windows localhost)..."
# Create tar archive, scp to VM, extract (avoids WSL2 network isolation)
$projectTar = Join-Path $CACHE "iora-project.tar.gz"
$prevEA = $ErrorActionPreference; $ErrorActionPreference = "Continue"
Push-Location $REPO_ROOT
tar -czf $projectTar --exclude='.git' --exclude='target' --exclude='node_modules' --exclude='.cache' --exclude='buildroot-*' --exclude='releases' --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' --exclude='*.tar.gz' . 2>$null
Pop-Location
$ErrorActionPreference = $prevEA

if (-not (Test-Path $projectTar)) {
    Write-ErrorMsg "Failed to create project archive."
    exit 1
}
Write-Info "  Uploading $(($((Get-Item $projectTar).Length) / 1MB)) MB archive..."
Invoke-SSH "mkdir -p /home/iora/iora" 2>$null | Out-Null
$prevEA2 = $ErrorActionPreference; $ErrorActionPreference = "Continue"
& $SCP_BIN -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o BatchMode=yes -o AddressFamily=inet -i $SSH_KEY -P $SshPort $projectTar "root@127.0.0.1:/home/iora/iora/" *>$null
$ErrorActionPreference = $prevEA2
Invoke-SSH "cd /home/iora/iora && tar -xzf iora-project.tar.gz && rm iora-project.tar.gz" 2>$null | Out-Null
Remove-Item $projectTar -Force -ErrorAction SilentlyContinue
Write-Success "Project uploaded"

Write-Info "Setting permissions..."
Invoke-SSH "chown -R iora:iora /home/iora/iora || sudo chown -R iora:iora /home/iora/iora" 2>$null | Out-Null

Write-Info "Installing system packages (curl, git, rust, docker, postgresql, nginx, mold linker)..."
Invoke-SSH "export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && apt-get install -y -qq curl git build-essential pkg-config libssl-dev nodejs npm docker.io postgresql postgresql-client rsync python3 python3-pip htop vim mold nginx openssl 2>&1" 2>$null | Select-Object -Last 5
Invoke-SSH "systemctl enable docker --now && systemctl enable postgresql --now 2>&1" 2>$null | Select-Object -Last 3
Invoke-SSH "su - postgres -c 'psql -c \"CREATE USER iora WITH PASSWORD '\''iora'\'' CREATEDB\"' 2>/dev/null || true" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'createuser -s root 2>/dev/null || true'" 2>$null | Out-Null
Invoke-SSH "su - iora -c 'curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable' 2>&1" 2>$null | Select-Object -Last 5
Write-Success "Packages installed"

# ── Cargo config: mold linker (5-10x faster linking) + sparse registry ──
Write-Info "Configuring Cargo for fast builds (mold linker, sparse registry)..."
$cargoConfig = @'
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "link-arg=-fuse-ld=mold"]

[registries.crates-io]
protocol = "sparse"

[net]
retry = 2
git-fetch-with-cli = true
'@
$cargoConfigPath = Join-Path $CACHE "cargo-config.toml"
$cargoConfig | Set-Content -Path $cargoConfigPath -NoNewline
$prevEAX = $ErrorActionPreference; $ErrorActionPreference = "Continue"
& $SCP_BIN -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o BatchMode=yes -o AddressFamily=inet -i $SSH_KEY -P $SshPort $cargoConfigPath "root@127.0.0.1:/tmp/cargo-config.toml" *>$null
$ErrorActionPreference = $prevEAX
Invoke-SSH "su - iora -c 'mkdir -p ~/.cargo && cp /tmp/cargo-config.toml ~/.cargo/config.toml'" 2>$null | Out-Null
Remove-Item $cargoConfigPath -Force -ErrorAction SilentlyContinue
Write-Success "Cargo config: mold linker + sparse registry"

Write-Info "Setting up IORA OS compatibility..."
Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-compat.sh 2>&1" 2>$null | Select-Object -Last 5
Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-services.sh 2>&1" 2>$null | Select-Object -Last 5

Write-Info "Applying additional IORA OS improvements..."
Invoke-SSH "bash /home/iora/iora/iora-os/iora-dev-improvements.sh 2>&1" 2>$null | Select-Object -Last 5

# ── Verify new services ─────────────────────────────────────────────────────
Write-Info "Verifying IORA OS services..."
$servicesCheck = Invoke-SSH "systemctl list-units --type=service --all | grep -c iora || echo 0"
Write-Info "IORA services registered: $($servicesCheck -replace '\s','')"

# Check nginx
$nginxCheck = Invoke-SSH "nginx -t 2>&1 && echo NGINX_OK || echo NGINX_FAIL"
if ($nginxCheck -match "NGINX_OK") {
    Write-Success "nginx reverse proxy: configured"
} else {
    Write-Warn "nginx configuration issue - check in VM"
}

# Check SSL
$sslCheck = Invoke-SSH "test -f /etc/iora/ssl/server.crt && echo SSL_OK || echo SSL_FAIL"
if ($sslCheck -match "SSL_OK") {
    Write-Success "SSL certificates: generated"
} else {
    Write-Warn "SSL certificates not found"
}

# Check hot-reload
$hotReloadCheck = Invoke-SSH "systemctl is-active iora-hot-reload.path 2>/dev/null || echo inactive"
if ($hotReloadCheck -match "active") {
    Write-Success "Hot-reload: active"
} else {
    Write-Info "Hot-reload: ready (will activate on first deploy)"
}

# Check dev mode (EXAKT wie IORA OS Dev)
$devModeCheck = Invoke-SSH "test -f /etc/iora/os-dev-mode && echo DEV_MODE_OK || echo DEV_MODE_FAIL"
if ($devModeCheck -match "DEV_MODE_OK") {
    Write-Success "Dev mode: /etc/iora/os-dev-mode installed"
}

# Check health monitoring
$healthCheck = Invoke-SSH "test -f /usr/lib/iora/iora-health-check && echo HEALTH_OK || echo HEALTH_FAIL"
if ($healthCheck -match "HEALTH_OK") {
    Write-Success "Health monitoring: configured"
}

# Check setup wizard
$wizardCheck = Invoke-SSH "test -f /usr/lib/iora/iora-setup-wizard && echo WIZARD_OK || echo WIZARD_FAIL"
if ($wizardCheck -match "WIZARD_OK") {
    Write-Success "Setup wizard: configured"
}

# Check logging
$logCheck = Invoke-SSH "test -d /var/log/iora && echo LOG_OK || echo LOG_FAIL"
if ($logCheck -match "LOG_OK") {
    Write-Success "Centralized logging: configured"
}

# Check firewall
$firewallCheck = Invoke-SSH "test -f /usr/lib/iora/iora-firewall && echo FIREWALL_OK || echo FIREWALL_FAIL"
if ($firewallCheck -match "FIREWALL_OK") {
    Write-Success "Firewall: configured"
}

# Enable health check timer
Invoke-SSH "systemctl enable iora-health-check.timer 2>/dev/null || true" 2>$null | Out-Null
Invoke-SSH "systemctl start iora-health-check.timer 2>/dev/null || true" 2>$null | Out-Null

# Re-run DB init (may have failed at boot with old config)
Write-Info "Initializing databases..."
Invoke-SSH "systemctl reset-failed iora-db-init 2>/dev/null || true" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'createuser -s root 2>/dev/null || true'" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'psql -c \"CREATE DATABASE iora_home OWNER iora\" 2>/dev/null || true'" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'psql -c \"CREATE DATABASE iora_core OWNER iora\" 2>/dev/null || true'" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'psql -c \"CREATE DATABASE iora_security OWNER iora\" 2>/dev/null || true'" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'psql -c \"CREATE DATABASE iora_secrets OWNER iora\" 2>/dev/null || true'" 2>$null | Out-Null
Invoke-SSH "su - postgres -c 'psql -c \"CREATE DATABASE iora_appstore OWNER iora\" 2>/dev/null || true'" 2>$null | Out-Null
Write-Success "Databases initialized"

Write-Info "Skipping in-VM Rust build – host cross-compile + SCP deploy"
Write-Info "The dev-watch window handles compilation and auto-deploys via SCP."

# Ensure iora-home uses PostgreSQL (binary may lack sqlite feature)
Invoke-SSH @'
su - postgres -c "psql -c 'CREATE DATABASE iora_home OWNER root'" 2>/dev/null || true
'@ 2>$null | Out-Null
Invoke-SSH "mkdir -p /etc/systemd/system/iora-home.service.d /opt/iora/build/iora-home/data" 2>$null | Out-Null
$dbConf = @'
[Service]
Environment=DATABASE_URL=postgres://root:iora@localhost/iora_home
WorkingDirectory=/opt/iora/build/iora-home
'@
$dbConfPath = Join-Path $CACHE "db.conf"
$dbConf | Set-Content -Path $dbConfPath -NoNewline
$prevEA4 = $ErrorActionPreference; $ErrorActionPreference = "Continue"
& $SCP_BIN -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o BatchMode=yes -o AddressFamily=inet -i $SSH_KEY -P $SshPort $dbConfPath "root@127.0.0.1:/etc/systemd/system/iora-home.service.d/db.conf" *>$null
$ErrorActionPreference = $prevEA4
Remove-Item $dbConfPath -Force -ErrorAction SilentlyContinue
Invoke-SSH "systemctl daemon-reload" 2>$null | Out-Null
Invoke-SSH "systemctl restart iora-home" 2>$null | Out-Null

# ── Frontend: Build + Deploy ─────────────────────────────────────────────
$frontendDir = Join-Path $REPO_ROOT "frontend"
if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
    Write-Warn "Frontend package.json not found - skipping frontend build"
} elseif (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Warn "npm not found - skipping frontend build"
} else {
    # Check Node.js availability
    $nodeOk = $true
    try {
        $null = node --version 2>&1
        Write-Info "Node.js: $(node --version)"
    } catch {
        Write-Warn "Node.js not found - skipping frontend build"
        $nodeOk = $false
    }
    if ($nodeOk) {
        Write-Info "Building frontend..."
        Push-Location $frontendDir
        try {
            $installResult = npm install 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "npm install failed:"
                $installResult | ForEach-Object { Write-Warn "  $_" }
            } else {
                Write-Success "npm install ok"
                $buildResult = npm run build 2>&1
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "npm run build failed:"
                    $buildResult | ForEach-Object { Write-Warn "  $_" }
                } elseif (Test-Path (Join-Path $frontendDir "dist")) {
                    Write-Info "Deploying frontend to VM..."
                    Invoke-SSH "mkdir -p /opt/iora/build/dist" 2>$null | Out-Null
                    # Note: Use "$frontendDir\dist" (not "\*") - PowerShell doesn't expand globs for SCP
                    & $SCP_BIN -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o IdentitiesOnly=yes -o AddressFamily=inet -r -i $SSH_KEY -P $SshPort "$frontendDir\dist" "root@127.0.0.1:/opt/iora/build/dist/" 2>$null
                    Write-Success "Frontend deployed"
                }
            }
        } catch {
            Write-Warn "Frontend build error: $_"
        } finally {
            Pop-Location
        }
    }
}

# ── Launch Dev-Loop in second window ────────────────────────────────────────
$watchScript = Join-Path $SCRIPT_DIR "dev-watch.ps1"
if (Test-Path $watchScript) {
    Write-Info "Launching dev-watch.ps1 in new terminal..."
    $targetArg = if ($HOST_ARCH -eq "ARM64") { "aarch64-unknown-linux-musl" } else { "x86_64-unknown-linux-musl" }
    Start-Process powershell -ArgumentList "-NoExit", "-File", "`"$watchScript`"", "-Target", $targetArg
} else {
    Write-Warn "dev-watch.ps1 not found at $watchScript"
    Write-Warn "Place it in the repo root and re-run."
}

# ── Done ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Success "IORA Dev VM ready!"
Write-Host ""

# TUI Banner
$banner = @"
  +====================================================================+
  |                    IORA Dev VM - All Services                       |
  +====================================================================+
  |                                                                    |
  |  WEB INTERFACES:                                                   |
  |    Dashboard:      https://localhost                               |
  |    Dashboard:      http://localhost:8126   (direct)                 |
  |    Dev Bridge:     http://localhost:8101/dev/health                 |
  |    Swagger API:    http://localhost:8126/api/docs                   |
  |                                                                    |
  |  ACCESS:                                                           |
  |    SSH:            ssh -i $SSH_KEY -p $SshPort root@127.0.0.1       |
  |    Dev-Loop:       Run dev-watch.ps1 in separate window            |
  |                                                                    |
  |  SERVICES (EXAKT wie IORA OS Dev):                                 |
  |    Binaries:       /usr/bin/iora-* (EXAKT wie IORA OS)             |
  |    nginx:          Reverse proxy with SSL (port 80/443)            |
  |    20 Services:    All IORA OS services registered                 |
  |    Health Monitor: Every minute                                    |
  |    Setup Wizard:   Auto-setup on first boot                        |
  |    Firewall:       iptables rules like IORA OS                     |
  |    Dev Mode:       /etc/iora/os-dev-mode                           |
  |                                                                    |
  |  QUICK START:                                                      |
  |    1. Open dev-watch.ps1 in new window                             |
  |    2. Press [B] to build and deploy all services                   |
  |    3. Open https://localhost in browser                            |
  |    4. Login: admin / admin (PIN: 0000)                             |
  |                                                                    |
  +====================================================================+
"@

Write-Host $banner -ForegroundColor Green
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
