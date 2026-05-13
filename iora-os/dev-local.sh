#!/usr/bin/env bash
# ============================================================================
# dev-local.sh – IORA OS Local Dev VM (macOS/Linux/WSL2)
# ============================================================================
# Startet Debian 12 aarch64/x86_64 Cloud-VM via QEMU.
# Verwendet cloud-init seed ISO für automatische Konfiguration (SSH, User, Pakete).
# Dann: SSH → rsync Projekt → bauen → starten.
# ============================================================================
set -euo pipefail
# Allow pipelines to fail without killing script (grep may return empty)
set +o pipefail

# Kill any stale QEMU from previous crashed runs
pkill -9 -f qemu-system 2>/dev/null || true
sleep 1

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE="$SCRIPT_DIR/.cache"
mkdir -p "$CACHE"

# ── Platform ───────────────────────────────────────────────────────────────
HOST_ARCH=$(uname -m)
IS_MACOS=false; IS_LINUX=false
case "$(uname -s)" in Darwin) IS_MACOS=true ;; Linux) IS_LINUX=true ;; esac

if $IS_MACOS; then HOST_CPUS=$(sysctl -n hw.logicalcpu 2>/dev/null || echo 4)
else HOST_CPUS=$(nproc 2>/dev/null || echo 4); fi

# ── Colors & Logging ──────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; N='\033[0m'
log() { echo -e "${C}[*]${N} $*"; }
ok()  { echo -e "${G}[+]${N} $*"; }
warn(){ echo -e "${Y}[!]${N} $*"; }
err() { echo -e "${R}[X]${N} $*"; }

# ── Config ─────────────────────────────────────────────────────────────────
# Dynamische RAM- & Build-Job-Berechnung
if $IS_MACOS; then
    HOST_RAM_MB=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f", $1/1048576}' || echo 8192)
elif [ -r /proc/meminfo ]; then
    HOST_RAM_MB=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo 8192)
else
    HOST_RAM_MB=8192
fi
HOST_RAM_GB=$(( (HOST_RAM_MB + 512) / 1024 ))

# VM bekommt ~60% des Host-RAMs (bzw. 70% bei <16GB), gecapped auf 12G
if [ -n "${IORA_DEV_RAM:-}" ]; then
    VM_RAM="$IORA_DEV_RAM"
else
    if [ "$HOST_RAM_GB" -lt 16 ]; then
        VM_RAM_GB=$(( HOST_RAM_GB * 70 / 100 ))  # 70% for small hosts
    else
        VM_RAM_GB=$(( HOST_RAM_GB * 60 / 100 ))  # 60% for 16GB+ hosts
    fi
    [ "$VM_RAM_GB" -lt 6 ] && VM_RAM_GB=6
    [ "$VM_RAM_GB" -gt 12 ] && VM_RAM_GB=12
    VM_RAM="${VM_RAM_GB}G"
fi

VM_CPUS="${IORA_DEV_CPUS:-$(( HOST_CPUS / 2 ))}"
[ "$VM_CPUS" -lt 2 ] && VM_CPUS=2

# Cargo Build-Jobs: 1 Job pro ~2.5GB VM-RAM (release braucht ~2.5-4GB pro Link)
# Minimum 1, Maximum = VM_CPUS
if [ -n "${IORA_DEV_CARGO_JOBS:-}" ]; then
    CARGO_JOBS="$IORA_DEV_CARGO_JOBS"
else
    VM_RAM_GB=${VM_RAM%G}
    CARGO_JOBS=$(( VM_RAM_GB * 10 / 25 ))  # 10/25 = 0.4 jobs per GB = 2.5GB/job
    [ "$CARGO_JOBS" -lt 1 ] && CARGO_JOBS=1
    [ "$CARGO_JOBS" -gt "$VM_CPUS" ] && CARGO_JOBS=$VM_CPUS
fi

log "Host: ${HOST_RAM_GB}GB RAM, ${HOST_CPUS} CPUs"
log "VM: ${VM_RAM}, ${VM_CPUS} CPUs, cargo -j${CARGO_JOBS}"
VM_SSH=2222
VM_HOME=8126
VM_BRIDGE=8101

# ── Arch-specific cloud image ──────────────────────────────────────────────
if [ "$HOST_ARCH" = "arm64" ]; then
    IMG_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-arm64.qcow2"
    IMG_CACHE="$CACHE/debian-12-cloud-arm64.qcow2"
    QEMU_BIN="qemu-system-aarch64"
    QEMU_MACHINE="virt"
else
    IMG_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
    IMG_CACHE="$CACHE/debian-12-cloud-amd64.qcow2"
    QEMU_BIN="qemu-system-x86_64"
    QEMU_MACHINE="q35"
fi
VM_DISK="$CACHE/iora-dev-vm.qcow2"

# ── Cleanup stale SSH host keys ───────────────────────────────────────────
if [ -f "$HOME/.ssh/known_hosts" ]; then
    ssh-keygen -R "[127.0.0.1]:$VM_SSH" 2>/dev/null || true
    ssh-keygen -R "[localhost]:$VM_SSH" 2>/dev/null || true
fi

# ── Cleanup ────────────────────────────────────────────────────────────────
cleanup() {
    [ -n "${QEMU_PID:-}" ] && kill "$QEMU_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ── Args ───────────────────────────────────────────────────────────────────
CLEAN=false
for a in "$@"; do case "$a" in --clean) CLEAN=true ;; --clean-all) CLEAN=true; rm -f "$IMG_CACHE" "$SEED_ISO" "$SSH_KEY" "$SSH_KEY.pub" ;; -h|--help) echo "Usage: $0 [--clean] [--clean-all]"; exit 0 ;; esac; done

if $CLEAN; then
    log "Cleaning cache..."
    find "$CACHE" -type f ! -name 'debian-12-cloud-*.qcow2' -delete 2>/dev/null || true
    ok "Done. Run again without --clean to start."
    exit 0
fi

# ── Cloud-init seed ISO ──────────────────────────────────────────────────
SEED_ISO="$CACHE/iora-dev-seed.iso"
SSH_KEY="$CACHE/iora-dev-key"

generate_seed_iso() {
    local seed_dir="$CACHE/seed"
    rm -rf "$seed_dir"
    mkdir -p "$seed_dir"

    # Generate SSH key pair for passwordless VM access (one-time)
    if [ ! -f "$SSH_KEY" ]; then
        log "Generating SSH key for VM access..."
        ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "iora-dev-vm" 2>/dev/null
        ok "SSH key created: $SSH_KEY"
    fi
    local PUBKEY
    PUBKEY=$(cat "$SSH_KEY.pub" 2>/dev/null)

    # user-data: cloud-init configuration
    cat > "$seed_dir/user-data" <<CLOUDEOF
#cloud-config
ssh_pwauth: true
disable_root: false

hostname: iora-dev

users:
  - name: root
    ssh_authorized_keys:
      - $PUBKEY
  - name: iora
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    groups: sudo, docker
    ssh_authorized_keys:
      - $PUBKEY

chpasswd:
  list: |
    root:iora
    iora:iora
  expire: false

# Only use the local seed ISO – don't reach out to any metadata service
datasource_list: [ NoCloud ]

packages: []

runcmd:
  - mkdir -p /etc/iora && touch /etc/iora/ssh-ready

final_message: "IORA Dev VM ready. SSH: ssh -p 2222 root@localhost (pw: iora)"
CLOUDEOF

    # meta-data: instance info (minimal)
    cat > "$seed_dir/meta-data" <<'METAEOF'
instance-id: iora-dev-vm
local-hostname: iora-dev
METAEOF

    log "Generating cloud-init seed ISO..."
    if command -v mkisofs >/dev/null 2>&1; then
        mkisofs -output "$SEED_ISO" -volid cidata -joliet -rock "$seed_dir" 2>/dev/null
    elif command -v genisoimage >/dev/null 2>&1; then
        genisoimage -output "$SEED_ISO" -volid cidata -joliet -rock "$seed_dir" 2>/dev/null
    elif $IS_MACOS && command -v hdiutil >/dev/null 2>&1; then
        # macOS: use hdiutil to create the ISO
        hdiutil makehybrid -o "$SEED_ISO" -hfs -joliet -iso -default-volume-name cidata "$seed_dir" 2>/dev/null
    else
        err "No ISO creation tool found (mkisofs, genisoimage, or hdiutil). Install one."
        err "  macOS: brew install cdrtools"
        err "  Linux: apt-get install genisoimage"
        exit 1
    fi
    rm -rf "$seed_dir"
    ok "Seed ISO created: $SEED_ISO"
}

# ── Step 1: Download cloud image ──────────────────────────────────────────
if [ ! -f "$IMG_CACHE" ]; then
    log "Downloading Debian cloud image (one-time, ~400MB)..."
    IMG_NAME="${IMG_URL##*/}"
    MIRRORS=(
        "$IMG_URL"
        "https://gemmei.ftp.acc.umu.se/images/cloud/bookworm/latest/$IMG_NAME"
        "https://cloud.debian.org/images/cloud/bookworm/latest/$IMG_NAME"
    )
    ok=false
    for url in "${MIRRORS[@]}"; do
        log "  Trying $url"
        if curl -L --connect-timeout 15 --max-time 600 -o "$IMG_CACHE.tmp" "$url" 2>/dev/null; then
            sz=$(stat -f%z "$IMG_CACHE.tmp" 2>/dev/null || echo 0)
            if [ "$sz" -gt 1048576 ]; then
                mv "$IMG_CACHE.tmp" "$IMG_CACHE"
                ok "Downloaded ($(( sz / 1048576 ))MB)"
                ok=true; break
            fi
            rm -f "$IMG_CACHE.tmp"
        fi
    done
    $ok || { err "Download failed."; exit 1; }
fi

# ── Step 2: Create VM disk ────────────────────────────────────────────────
if [ ! -f "$VM_DISK" ]; then
    log "Creating VM disk..."
    qemu-img create -f qcow2 -b "$IMG_CACHE" -F qcow2 "$VM_DISK" 20G >/dev/null
fi

# ── Step 3: Generate cloud-init seed ISO ──────────────────────────────────
if [ ! -f "$SEED_ISO" ]; then
    generate_seed_iso
fi

# ── Step 4: Start QEMU ────────────────────────────────────────────────────
# Clean up old SSH host keys for our port (VM key changes every --clean)
if [ -f "$HOME/.ssh/known_hosts" ]; then
    ssh-keygen -R "[127.0.0.1]:$VM_SSH" 2>/dev/null || true
    ssh-keygen -R "[localhost]:$VM_SSH" 2>/dev/null || true
fi
# Check if SSH port is already in use (stale QEMU from previous run?)
if lsof -i ":$VM_SSH" >/dev/null 2>&1; then
    warn "Port $VM_SSH is in use! Killing stale processes..."
    lsof -ti ":$VM_SSH" | xargs kill -9 2>/dev/null || true
    sleep 1
fi
log "Starting QEMU..."
QEMU_ARGS=(
    -m "$VM_RAM" -smp "$VM_CPUS"
    -drive "file=$VM_DISK,format=qcow2,if=virtio"
    -cdrom "$SEED_ISO"
    -netdev "user,id=n0,hostfwd=tcp::$VM_HOME-:8126,hostfwd=tcp::$VM_BRIDGE-:8101,hostfwd=tcp::$VM_SSH-:22"
    -device "virtio-net-pci,netdev=n0"
    -name "IORA-Dev" -cpu host
    -machine "$QEMU_MACHINE,accel=hvf"
    -device virtio-gpu
    -serial none
    -display cocoa,show-cursor=on
)

# Aarch64 extras
if [ "$HOST_ARCH" = "arm64" ]; then
    FW="/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
    [ -f "$FW" ] || FW=$(find /opt/homebrew -name "edk2-aarch64-code.fd" 2>/dev/null | head -1)
    [ -f "$FW" ] && QEMU_ARGS+=(-bios "$FW")
    QEMU_ARGS+=(-boot order=d,menu=off)
    # Replace virtio-net-pci with virtio-net-device for aarch64
    for i in "${!QEMU_ARGS[@]}"; do
        if [ "${QEMU_ARGS[$i]}" = "virtio-net-pci,netdev=n0" ]; then
            QEMU_ARGS[$i]="virtio-net-device,netdev=n0"
            break
        fi
    done
fi

"$QEMU_BIN" "${QEMU_ARGS[@]}" &
QEMU_PID=$!
log "QEMU PID: $QEMU_PID"

# Quick sanity: is QEMU still alive after 5 seconds?
sleep 5
if ! kill -0 "$QEMU_PID" 2>/dev/null; then
    err "QEMU died immediately after start!"
    err "  Check if another process is using port $VM_SSH."
    err "  Try: lsof -i :$VM_SSH"
    exit 1
fi

# ── Step 5: Wait for cloud-init to finish ─────────────────────────────────
log "Waiting for cloud-init to finish (first boot may take 5-10 min)..."
W_CLOUD=0
CLOUD_TIMEOUT=600
while [ $W_CLOUD -lt $CLOUD_TIMEOUT ]; do
    # After 30s, do one diagnostic SSH to see what's happening
    if [ $W_CLOUD -eq 35 ]; then
        log "Diagnostic SSH (should show 'SSH_OK' or error):"
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=5 -o AddressFamily=inet \
            -i "$SSH_KEY" -p "$VM_SSH" root@127.0.0.1 "echo SSH_OK" 2>&1
        echo ""
    fi
    if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=3 -o AddressFamily=inet \
         -i "$SSH_KEY" -p "$VM_SSH" root@127.0.0.1 \
         "test -f /var/lib/cloud/instance/boot-finished && echo READY" 2>/dev/null | grep -q READY; then
        ok "Cloud-init completed"
        break
    fi
    sleep 5; W_CLOUD=$((W_CLOUD+5))
    echo -n "."
    # Show elapsed time every 60 seconds
    if [ $((W_CLOUD % 60)) -eq 0 ] && [ $W_CLOUD -gt 0 ]; then
        echo -n "[${W_CLOUD}s]"
    fi
done
echo ""

if [ $W_CLOUD -ge $CLOUD_TIMEOUT ]; then
    err "Cloud-init did not finish within $((CLOUD_TIMEOUT/60)) minutes."
    err "  The VM might still be installing packages. Wait 2 more minutes and try:"
    err "    ssh -i $SSH_KEY -p $VM_SSH root@127.0.0.1"
    err "  Then re-run this script (it will skip cloud-init and resume)."
    exit 1
fi

ok "SSH ready! (cloud-init configured everything)"

# ── Step 6: Setup IORA via SSH ────────────────────────────────────────────
SSH="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=5 -o AddressFamily=inet -i $SSH_KEY -p $VM_SSH root@127.0.0.1"
SCP="scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o AddressFamily=inet -i $SSH_KEY -P $VM_SSH"

# Install rsync first (needed for project upload)
log "Installing rsync in VM..."
$SSH "apt-get update -qq && apt-get install -y -qq rsync" 2>&1 | tail -3

log "Uploading project via rsync..."
$SSH "mkdir -p /home/iora/iora" 2>/dev/null
rsync -az --delete \
    --exclude='.git' --exclude='target' --exclude='node_modules' \
    --exclude='.cache' --exclude='buildroot-*' --exclude='releases' \
    --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' \
    -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o AddressFamily=inet -i $SSH_KEY -p $VM_SSH" \
    "$REPO_ROOT/" "root@127.0.0.1:/home/iora/iora/" 2>&1 | tail -3
if [ ${PIPESTATUS[0]} -ne 0 ]; then
    err "rsync failed! Check: ssh -i $SSH_KEY -p $VM_SSH root@127.0.0.1"
    exit 1
fi
$SSH "chown -R iora:iora /home/iora/iora || sudo chown -R iora:iora /home/iora/iora" 2>/dev/null
ok "Project uploaded"

log "Installing system packages (curl, git, rust, docker, postgresql)..."
$SSH "export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && apt-get install -y -qq curl git build-essential pkg-config libssl-dev nodejs npm docker.io postgresql postgresql-client rsync python3 python3-pip htop vim" 2>&1 | tail -5
$SSH "systemctl enable docker --now && systemctl enable postgresql --now" 2>&1 | tail -3
# PostgreSQL: create roles + dev mode marker
$SSH 'bash -s' <<'PGEOF'
su - postgres -c "psql -c 'CREATE ROLE root WITH LOGIN SUPERUSER PASSWORD '\''iora'\'''" 2>/dev/null || true
su - postgres -c "psql -c 'CREATE USER iora WITH PASSWORD '\''iora'\'' CREATEDB'" 2>/dev/null || true
mkdir -p /etc/iora && touch /etc/iora/os-dev-mode
PGEOF
$SSH "su - iora -c 'curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable'" 2>&1 | tail -5
ok "Packages installed"

log "Setting up IORA OS compatibility..."
$SSH "bash /home/iora/iora/iora-os/iora-dev-compat.sh 2>&1" | tail -5
$SSH "bash /home/iora/iora/iora-os/iora-dev-services.sh 2>&1" | tail -5

VM_RAM_NUM=${VM_RAM%G}
if [ "$VM_RAM_NUM" -lt 8 ]; then
    log "Building IORA essentials (RAM <8GB: LTO off, only core services)..."
    BUILD_TARGETS="-p iora-core -p iora-home -p iora-dev-bridge -p iora-cli"
    CARGO_OPTS="CARGO_PROFILE_RELEASE_LTO=off CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4"
else
    log "Building IORA workspace (10-30 min first time)..."
    BUILD_TARGETS="--workspace"
    CARGO_OPTS=""
fi
$SSH "su - iora -c \"source ~/.cargo/env && cd /home/iora/iora/iora-os/backend && CARGO_BUILD_JOBS=$CARGO_JOBS $CARGO_OPTS cargo build --release $BUILD_TARGETS\"" 2>&1 | tail -20 || warn "Build had warnings"

log "Deploying binaries..."
$SSH 'bash -s' <<'EOF'
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
EOF

# Ensure iora-home uses PostgreSQL (binary may lack sqlite feature)
$SSH 'bash -s' <<'DBEOF'
su - postgres -c "psql -c 'CREATE DATABASE iora_home OWNER root'" 2>/dev/null || true
mkdir -p /etc/systemd/system/iora-home.service.d /opt/iora/build/iora-home/data
cat > /etc/systemd/system/iora-home.service.d/db.conf <<'CFG'
[Service]
Environment=DATABASE_URL=postgres://root:iora@localhost/iora_home
WorkingDirectory=/opt/iora/build/iora-home
CFG
systemctl daemon-reload
systemctl restart iora-home 2>/dev/null || true
DBEOF

# ── Frontend: Build + Deploy ─────────────────────────────────────────────
FRONTEND_DIR="$REPO_ROOT/frontend"
if [ -f "$FRONTEND_DIR/package.json" ] && command -v npm >/dev/null 2>&1; then
    log "Building frontend..."
    (cd "$FRONTEND_DIR" && npm install --silent && npm run build) 2>&1 | tail -5 || warn "Frontend build had warnings"
    if [ -d "$FRONTEND_DIR/dist" ]; then
        log "Deploying frontend to VM..."
        $SSH "mkdir -p /opt/iora/build/dist" 2>/dev/null
        $SCP -r "$FRONTEND_DIR/dist/" "root@127.0.0.1:/opt/iora/build/dist/" 2>&1 | tail -3
        ok "Frontend deployed"
    fi
else
    warn "npm not found – skipping frontend build (install Node.js for the dashboard UI)"
fi

ok "IORA Dev VM ready!"
echo ""
echo "  Dashboard:  http://localhost:$VM_HOME"
echo "  Dev Bridge:  http://localhost:$VM_BRIDGE/dev/health"
echo "  SSH:        ssh -i $SSH_KEY -p $VM_SSH root@127.0.0.1"
echo ""
echo "Press Ctrl+C to stop. VM stays running in background."
wait
