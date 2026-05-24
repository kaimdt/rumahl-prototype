#!/usr/bin/env bash
# ============================================================================
# dev-watch.sh – IORA OS Dev-Loop (watch → build → deploy)
# ============================================================================
# Watches the Rust workspace and frontend, cross-compiles for the VM target,
# uploads changed binaries via SSH and restarts the corresponding systemd
# services. Works on macOS, Linux and WSL2.
#
# Design goals: idempotent, autonomous, fault-tolerant.
#
# Usage:
#   ./dev-watch.sh                       Build once + watch + deploy
#   ./dev-watch.sh --no-watch            Build once and exit
#   ./dev-watch.sh --rust-only           Skip the frontend pipeline
#   ./dev-watch.sh --frontend-only       Skip the Rust pipeline
#   ./dev-watch.sh --services S1,S2      Only build specific services
#   ./dev-watch.sh --no-deploy           Build but don't deploy to VM
#   ./dev-watch.sh --auto-deploy         Auto-deploy after build (default)
#   ./dev-watch.sh --target TARGET       Override Cargo target triple
#   ./dev-watch.sh --skip-sccache        Don't use sccache
#   ./dev-watch.sh --vm-host HOST        SSH host (default 127.0.0.1)
#   ./dev-watch.sh --vm-port PORT        SSH port (default 2222)
#   ./dev-watch.sh --ssh-key FILE        SSH key (default <repo>/iora-os/.cache/iora-dev-key)
#   ./dev-watch.sh --no-restart          Upload but don't restart services
#   ./dev-watch.sh --help
# ============================================================================
# shellcheck disable=SC2155,SC2034

set -uo pipefail

# ── Colors & logging (defined BEFORE any helper uses them) ────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; C=$'\033[0;36m'; M=$'\033[0;35m'
    D=$'\033[2m';    B=$'\033[1m';    N=$'\033[0m'
else
    R=''; G=''; Y=''; C=''; D=''; B=''; N=''; M=''
fi
log()  { printf '%s[*]%s %s\n' "$C" "$N" "$*"; }
ok()   { printf '%s[+]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*" >&2; }
err()  { printf '%s[X]%s %s\n' "$R" "$N" "$*" >&2; }
dim()  { printf '%s%s%s\n' "$D" "$*" "$N"; }
die()  { err "$*"; exit 1; }

# ── Paths ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || { cd "$SCRIPT_DIR/.." && pwd; })"
CACHE="$SCRIPT_DIR/.cache"
SHARED="$REPO_ROOT/.iora-dev"
BIN_DIR="$SHARED/binaries"
SCCACHE_DIR="$SHARED/sccache"
HASH_DIR="$CACHE/hashes"
mkdir -p "$BIN_DIR" "$SCCACHE_DIR" "$HASH_DIR" "$CACHE"

# ── Workspace detection ───────────────────────────────────────────────────
if [ -f "$REPO_ROOT/iora-os/backend/Cargo.toml" ]; then
    WORKSPACE="$REPO_ROOT/iora-os/backend"
elif [ -f "$REPO_ROOT/backend/Cargo.toml" ]; then
    WORKSPACE="$REPO_ROOT/backend"
else
    die "Cannot find Rust workspace (looked for iora-os/backend or backend)"
fi

# VM-side paths (for in-VM build strategy)
VM_WORKSPACE="/home/iora/iora/iora-os/backend"
VM_TARGET="$VM_WORKSPACE/target/debug"

FRONTEND_DIR=""
for d in "$REPO_ROOT/frontend" "$REPO_ROOT/desktop"; do
    [ -f "$d/package.json" ] && FRONTEND_DIR="$d" && break
done

# ── Defaults / args ───────────────────────────────────────────────────────
TARGET="${IORA_DEV_TARGET:-x86_64-unknown-linux-gnu}"
VM_HOST="127.0.0.1"
VM_PORT=2222
SSH_KEY="$CACHE/iora-dev-key"
USE_SCCACHE=true
WATCH=true
DO_RUST=true
DO_FRONTEND=true
DO_RESTART=true
DO_DEPLOY=true
SELECTED_SERVICES=""
DEBOUNCE_SEC=1

show_help() {
    sed -n '4,22p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --no-watch)        WATCH=false; shift ;;
        --rust-only)       DO_FRONTEND=false; shift ;;
        --frontend-only)   DO_RUST=false; shift ;;
        --target)          TARGET="$2"; shift 2 ;;
        --skip-sccache)    USE_SCCACHE=false; shift ;;
        --vm-host)         VM_HOST="$2"; shift 2 ;;
        --vm-port)         VM_PORT="$2"; shift 2 ;;
        --ssh-key)         SSH_KEY="$2"; shift 2 ;;
        --restart)         DO_RESTART=false; shift ;;
        --services)        SELECTED_SERVICES="$2"; shift 2 ;;
        --no-deploy)       DO_DEPLOY=false; shift ;;
        --auto-deploy)     DO_DEPLOY=true; shift ;;
        -h|--help)         show_help; exit 0 ;;
        *)                 warn "Ignoring unknown argument: $1"; shift ;;
    esac
done

# ── Logging mirror ────────────────────────────────────────────────────────
LOG_FILE="$CACHE/dev-watch.log"
if [ -f "$LOG_FILE" ] && [ "$(wc -c <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
fi
exec > >(tee -a "$LOG_FILE") 2>&1

# ── SSH helpers (with ControlMaster for fast reuse) ──────────────────────
SSH_OPTS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o IdentitiesOnly=yes
    -o LogLevel=ERROR
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
    -o ConnectTimeout=10
    -o AddressFamily=inet
    -i "$SSH_KEY"
)

ssh_vm() { ssh "${SSH_OPTS[@]}" -p "$VM_PORT" "root@$VM_HOST" "$@"; }
scp_to_vm() { scp "${SSH_OPTS[@]}" -P "$VM_PORT" -q "$1" "root@$VM_HOST:$2"; }

vm_reachable() {
    [ -f "$SSH_KEY" ] || return 1
    ssh_vm -o ConnectTimeout=5 -o BatchMode=yes "true" 2>/dev/null
}

# ── Service auto-discovery ────────────────────────────────────────────────
# Scan workspace for crates with binary targets named `iora-*`. We try
# services/, tools/, apps/system/, dev/ — anywhere a Cargo.toml lives.
discover_services() {
    local out=()
    local dirs=("$WORKSPACE/services" "$WORKSPACE/tools" "$WORKSPACE/apps/system" "$WORKSPACE/dev")
    for base in "${dirs[@]}"; do
        [ -d "$base" ] || continue
        # Each immediate subdir with Cargo.toml is a candidate.
        for d in "$base"/*/; do
            [ -f "$d/Cargo.toml" ] || continue
            local name
            name=$(basename "$d")
            # Only deploy crates whose binary will start with iora-
            [[ "$name" == iora-* ]] || continue
            out+=("$name")
        done
    done
    # Deduplicate (preserve order)
    awk '!seen[$0]++' <<<"$(printf '%s\n' "${out[@]}")"
}

ALL_SERVICES=()
while IFS= read -r line; do
    ALL_SERVICES+=("$line")
done < <(discover_services)

# Filter to selected services if --services was specified
if [ -n "$SELECTED_SERVICES" ]; then
    IFS=',' read -ra WANTED <<< "$SELECTED_SERVICES"
    FILTERED=()
    for svc in "${ALL_SERVICES[@]}"; do
        for w in "${WANTED[@]}"; do
            if [ "$svc" = "$w" ]; then FILTERED+=("$svc"); break; fi
        done
    done
    ALL_SERVICES=("${FILTERED[@]}")
    log "Filtered to ${#ALL_SERVICES[@]} services: ${ALL_SERVICES[*]}"
fi
log "Discovered ${#ALL_SERVICES[@]} iora-* crates"

# ── Toolchain detection ───────────────────────────────────────────────────
# Rust builds happen inside the VM, but we still set up for frontend-only tooling.
setup_toolchain() {
    TOOLCHAIN="in-vm"
    log "Rust toolchain: builds inside Dev VM (no cross-compilation needed)"
}

# No-op: target handled by the VM's native toolchain.
ensure_rust_target() { :; }

# sccache wiring
setup_sccache() {
    export SCCACHE_DIR="$SCCACHE_DIR"
    if ! $USE_SCCACHE; then return 0; fi
    if command -v sccache >/dev/null 2>&1; then
        export RUSTC_WRAPPER="sccache"
        # Cap cache to 5GB by default (override with SCCACHE_CACHE_SIZE env)
        export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-5G}"
        ok "sccache enabled ($SCCACHE_DIR, max $SCCACHE_CACHE_SIZE)"
    else
        warn "sccache not found – builds will be slower (install via 'cargo install sccache')"
    fi
}

# ── Hash tracking (only deploy real changes) ──────────────────────────────
hash_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

bin_changed() {
    local name="$1" bin="$2"
    local hf="$HASH_DIR/$name"
    local cur prev
    cur=$(hash_file "$bin")
    prev=$(cat "$hf" 2>/dev/null || echo "")
    if [ "$cur" = "$prev" ]; then
        return 1
    fi
    echo "$cur" >"$hf"
    return 0
}

# ── Deploy a single binary ────────────────────────────────────────────────
deploy_binary() {
    local name="$1" bin="$2"
    local remote="/usr/bin/$name"

    # Upload to a temp file, then atomically move into place (avoids
    # corrupting a running binary on the VM mid-restart).
    local tmp="/tmp/.iora-deploy-$name.$$"
    if ! scp_to_vm "$bin" "$tmp"; then
        err "    $name : scp failed"
        return 1
    fi
    if ! ssh_vm "install -m 0755 '$tmp' '$remote' && rm -f '$tmp'"; then
        err "    $name : install failed"
        ssh_vm "rm -f '$tmp'" >/dev/null 2>&1 || true
        return 1
    fi

    if $DO_RESTART; then
        # Use restart (starts inactive services too) after resetting any failed state
        ssh_vm "systemctl reset-failed $name 2>/dev/null; systemctl restart $name 2>/dev/null || systemctl start $name 2>/dev/null || true" \
            >/dev/null 2>&1 || true
    fi
    printf '    %s->%s %s\n' "$G" "$N" "$name"
    return 0
}

# Deploy a list of services in parallel.
# Since we build inside the VM, source and dest are both local to the VM.
deploy_many() {
    local services=("$@")
    local deployed=0
    local failed=0
    local vm_target="$VM_TARGET"

    for svc in "${services[@]}"; do
        if ssh_vm "test -f $vm_target/$svc && install -m 0755 $vm_target/$svc /usr/bin/$svc"; then
            # Ensure Global Config env files exist
            local svc_short="${svc#iora-}"
            ssh_vm "mkdir -p /etc/iora/db-credentials /tmp/iora-sandboxes /opt/iora/build/$svc/data && \
              [ -f /etc/iora/db-credentials/$svc.env ] || echo 'DATABASE_URL=postgres://root:iora@localhost/iora_${svc_short}' > /etc/iora/db-credentials/$svc.env && \
              [ -f /etc/iora/$svc.env ] || echo -e 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_${svc_short}\nRUST_LOG=${svc}=debug' > /etc/iora/$svc.env && \
              echo -e '[Service]\nProtectSystem=no\nProtectHome=no\nPrivateTmp=no\nNoNewPrivileges=no\nRestrictAddressFamilies=\nSystemCallFilter=\nReadWritePaths=\nReadOnlyPaths=\nEnvironmentFile=/etc/iora/$svc.env' > /etc/systemd/system/$svc.service.d/dev-relax.conf" 2>/dev/null || true
            # For iora-home: add bootstrap admin credentials so dev login works immediately
            if [ "$svc" = "iora-home" ]; then
                ssh_vm "grep -q IORA_BOOTSTRAP_ADMIN_USER /etc/iora/iora-home.env 2>/dev/null || echo -e 'IORA_BOOTSTRAP_ADMIN_USER=admin\nIORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234' >> /etc/iora/iora-home.env" 2>/dev/null || true
            fi
            if $DO_RESTART; then
                ssh_vm "systemctl reset-failed $svc 2>/dev/null; systemctl restart $svc 2>/dev/null || systemctl start $svc 2>/dev/null || true" >/dev/null 2>&1 || true
            fi
            # For iora-home: ensure admin user has admin role (idempotent)
            # Fresh VMs: bootstrap env vars create admin/admin1234 automatically.
            # Existing VMs: fix role if user was created via UI registration.
            if [ "$svc" = "iora-home" ]; then
                sleep 5  # give iora-home time to finish bootstrap
                ssh_vm "su - postgres -c \"psql iora_home -c \\\"UPDATE users SET role='admin' WHERE username='admin' AND role!='admin'\\\" 2>/dev/null\" 2>/dev/null || true" 2>/dev/null || true
            fi
            printf '    %s->%s %s\n' "$G" "$N" "$svc"
            deployed=$((deployed + 1))
        else
            dim "    $svc : not built, skipping"
        fi
    done

    printf '  deployed=%s failed=%s\n' "$deployed" "$failed"
    return 0
}

# ═══════════════════════════════════════════════════════════════════
# ── Build: Rust (inside VM) ──────────────────────────────────────────────
# Cross-compilation from macOS fails due to OpenSSL native deps.
# Instead, we sync sources and build natively inside the Dev VM.
RUST_BUILD_N=0
build_rust() {
    if ! $DO_RUST; then return 0; fi
    RUST_BUILD_N=$((RUST_BUILD_N + 1))
    local start now elapsed
    start=$(date +%s)
    printf '\n%s──[Rust #%d @ %s]──────────────────────────────────────────%s\n' \
        "$Y" "$RUST_BUILD_N" "$(date '+%H:%M:%S')" "$N"

    if ! vm_reachable; then
        warn "VM not reachable – skipping Rust build"
        return 0
    fi

    # Auto-install Rust/cargo if missing (e.g. fresh VM)
    if ! ssh_vm "su - iora -c 'test -f /home/iora/.cargo/bin/cargo && echo OK'" 2>/dev/null | grep -q OK; then
        log "Rust not found in VM. Installing..."
        ssh_vm "echo 'nameserver 1.1.1.1' > /etc/resolv.conf; echo 'nameserver 8.8.8.8' >> /etc/resolv.conf" 2>/dev/null
        ssh_vm "su - iora -c 'curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal'" 2>&1 | tail -3
        ssh_vm "su - iora -c '/home/iora/.cargo/bin/cargo --version'" 2>/dev/null && ok "Rust installed" || { err "Rust install failed"; return 1; }
    fi

    # Fix target directory permissions (rsync may create as root)
    ssh_vm "chown -R iora:iora $VM_WORKSPACE/target 2>/dev/null; mkdir -p $VM_WORKSPACE/target && chown iora:iora $VM_WORKSPACE/target" 2>/dev/null || true

    # Auto-detect optimal CARGO_BUILD_JOBS from VM resources
    local VM_RAM_MB VM_CPUS
    VM_RAM_MB=$(ssh_vm "awk '/MemTotal/{printf \"%d\", \$2/1024}' /proc/meminfo" 2>/dev/null || echo 4096)
    VM_CPUS=$(ssh_vm "nproc" 2>/dev/null || echo 2)
    # Each rustc needs ~2GB RAM. Leave 1GB for system.
    local jobs_by_ram=$(( (VM_RAM_MB - 1024) / 2048 ))
    [ "$jobs_by_ram" -lt 1 ] && jobs_by_ram=1
    # Cap at CPU count
    local OPTIMAL_JOBS=$(( jobs_by_ram < VM_CPUS ? jobs_by_ram : VM_CPUS ))
    [ "$OPTIMAL_JOBS" -lt 1 ] && OPTIMAL_JOBS=1
    [ "$OPTIMAL_JOBS" -gt 8 ] && OPTIMAL_JOBS=8
    dim "  VM: ${VM_RAM_MB}MB RAM, ${VM_CPUS} CPUs → CARGO_BUILD_JOBS=$OPTIMAL_JOBS"

    local rc=0
    # Sync changed source files to VM before building
    rsync -az --delete \
        --exclude='.git' --exclude='target' --exclude='node_modules' \
        --exclude='.cache' --exclude='buildroot-*' --exclude='releases' \
        --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' \
        --exclude='.iora-dev' \
        -e "ssh ${SSH_OPTS[*]} -p $VM_PORT" \
        "$REPO_ROOT/" "root@$VM_HOST:/home/iora/iora/" 2>&1 | tail -3
    # Build only selected services (or full workspace)
    local cargo_cmd="CARGO_BUILD_JOBS=$OPTIMAL_JOBS /home/iora/.cargo/bin/cargo build"
    if [ -n "$SELECTED_SERVICES" ]; then
        IFS=',' read -ra PKGS <<< "$SELECTED_SERVICES"
        for pkg in "${PKGS[@]}"; do
            cargo_cmd="$cargo_cmd -p $pkg"
        done
        log "Building: ${PKGS[*]}"
    else
        cargo_cmd="$cargo_cmd --workspace"
    fi
    ssh_vm "su - iora -c 'cd $VM_WORKSPACE && $cargo_cmd 2>&1'" || rc=$?

    now=$(date +%s); elapsed=$((now - start))
    if [ "$rc" -ne 0 ]; then
        err "Rust build FAILED (exit $rc) after ${elapsed}s"
        return $rc
    fi
    ok "Rust build OK in ${elapsed}s"

    if $DO_DEPLOY; then
        deploy_many "${ALL_SERVICES[@]}"
    else
        dim "  (deploy skipped: --no-deploy)"
    fi
}

# ── Build: Frontend ───────────────────────────────────────────────────────
FE_BUILD_N=0
build_frontend() {
    if ! $DO_FRONTEND; then return 0; fi
    [ -n "$FRONTEND_DIR" ] || { dim "no frontend, skipping"; return 0; }
    if ! command -v npm >/dev/null 2>&1; then
        warn "npm not found, skipping frontend"; return 0
    fi
    FE_BUILD_N=$((FE_BUILD_N + 1))
    local start now elapsed rc=0
    start=$(date +%s)
    printf '\n%s──[Frontend #%d @ %s]──────────────────────────────────────%s\n' \
        "$Y" "$FE_BUILD_N" "$(date '+%H:%M:%S')" "$N"

    pushd "$FRONTEND_DIR" >/dev/null
    if [ ! -d node_modules ]; then
        log "Running 'npm install' (one-time)..."
        npm install --no-audit --no-fund || rc=$?
    fi
    [ "$rc" -eq 0 ] && (npm run build || rc=$?)
    popd >/dev/null

    now=$(date +%s); elapsed=$((now - start))
    if [ "$rc" -ne 0 ]; then
        err "Frontend build FAILED (exit $rc) after ${elapsed}s"
        return $rc
    fi
    ok "Frontend build OK in ${elapsed}s"

    if [ -d "$FRONTEND_DIR/dist" ] && vm_reachable; then
        deploy_frontend "$FRONTEND_DIR/dist"
    fi
}

deploy_frontend() {
    local dist="$1"
    local tar="$CACHE/iora-frontend.tar.gz"

    if ! tar -czf "$tar" -C "$dist" . 2>/dev/null; then
        err "frontend tar failed"; return 1
    fi
    if ! scp_to_vm "$tar" "/tmp/iora-frontend.tar.gz"; then
        err "frontend upload failed"; return 1
    fi
    ssh_vm '
        set -e
        mkdir -p /opt/iora/build/dist
        rm -rf /opt/iora/build/dist/*
        tar xzf /tmp/iora-frontend.tar.gz -C /opt/iora/build/dist
        rm -f /tmp/iora-frontend.tar.gz
        systemctl restart iora-home 2>/dev/null || systemctl start iora-home 2>/dev/null || true
        systemctl reload nginx 2>/dev/null || true
    ' >/dev/null 2>&1 || warn "frontend remote unpack reported errors"
    rm -f "$tar"
    ok "  frontend deployed → /opt/iora/build/dist"
}

# ── Watcher ───────────────────────────────────────────────────────────────
# Single debounced trigger per pipeline. Each handler runs a short bash
# loop that drains rapid bursts of events.
RUST_DIRTY=false
FE_DIRTY=false
BUILDING_RUST=false
BUILDING_FE=false

start_watchers() {
    local pids=()
    local rust_dirs=()
    for sub in services shared tools apps dev; do
        [ -d "$WORKSPACE/$sub" ] && rust_dirs+=("$WORKSPACE/$sub")
    done

    if command -v fswatch >/dev/null 2>&1; then
        # macOS / cross-platform fswatch
        (
            fswatch -0 --latency=0.5 -r \
                -e '/target(/|$)' -e '/node_modules(/|$)' -e '/\.git(/|$)' \
                -e '/dist(/|$)' -e '/\.iora-dev(/|$)' \
                -i '\.rs$' -i 'Cargo\.toml$' -i 'Cargo\.lock$' \
                "${rust_dirs[@]}" 2>/dev/null | while IFS= read -r -d '' _f; do
                RUST_DIRTY=true
            done
        ) &
        pids+=($!)
        if [ -n "$FRONTEND_DIR" ] && $DO_FRONTEND; then
            (
                fswatch -0 --latency=0.5 -r \
                    -e '/node_modules(/|$)' -e '/dist(/|$)' -e '/\.next(/|$)' \
                    -i '\.(tsx?|jsx?|css|html|json|svelte|vue)$' \
                    "$FRONTEND_DIR/src" "$FRONTEND_DIR/public" \
                    "$FRONTEND_DIR/index.html" "$FRONTEND_DIR/package.json" \
                    2>/dev/null | while IFS= read -r -d '' _f; do
                    FE_DIRTY=true
                done
            ) &
            pids+=($!)
        fi
        dim "watcher: fswatch"
    elif command -v inotifywait >/dev/null 2>&1; then
        (
            inotifywait -m -r -q -e modify,create,move,delete \
                --include '\.rs$|Cargo\.toml$|Cargo\.lock$' \
                --exclude '/(target|node_modules|\.git|dist|\.iora-dev)(/|$)' \
                "${rust_dirs[@]}" 2>/dev/null | while read -r _; do
                RUST_DIRTY=true
            done
        ) &
        pids+=($!)
        if [ -n "$FRONTEND_DIR" ] && $DO_FRONTEND; then
            (
                inotifywait -m -r -q -e modify,create,move,delete \
                    --include '\.(tsx?|jsx?|css|html|json)$' \
                    --exclude '/(node_modules|dist|\.next)(/|$)' \
                    "$FRONTEND_DIR/src" "$FRONTEND_DIR/public" 2>/dev/null \
                    | while read -r _; do FE_DIRTY=true; done
            ) &
            pids+=($!)
        fi
        dim "watcher: inotifywait"
    else
        warn "No file-watcher available (install fswatch or inotify-tools)."
        warn "Falling back to polling (5s)."
        (
            while true; do
                touch "$CACHE/.poll-tick"
                sleep 5
                # Naively assume change → rebuild incrementally (cargo handles it).
                RUST_DIRTY=true
                $DO_FRONTEND && [ -n "$FRONTEND_DIR" ] && FE_DIRTY=true
            done
        ) &
        pids+=($!)
    fi

    WATCH_PIDS=("${pids[@]}")
}

stop_watchers() {
    for p in "${WATCH_PIDS[@]:-}"; do
        kill "$p" 2>/dev/null || true
    done
}

# ── Cleanup / signal handling ─────────────────────────────────────────────
cleanup() {
    tput csr 1 "$(tput lines 2>/dev/null || echo 24)" 2>/dev/null || true
    printf '\033[?25h'
    stop_watchers
}
trap cleanup EXIT INT TERM

# ── Bootstrap ─────────────────────────────────────────────────────────────
cat <<EOF
${B}╔══════════════════════════════════════════════════════════════════╗
║              IORA OS Dev-Loop (intelligent)                       ║
╚══════════════════════════════════════════════════════════════════╝${N}
  Workspace : $WORKSPACE
  Frontend  : ${FRONTEND_DIR:-<none>}
  Target    : (will be detected)
  VM        : root@$VM_HOST:$VM_PORT
EOF

if [ ! -f "$SSH_KEY" ]; then
    warn "SSH key missing: $SSH_KEY"
    warn "Start the VM first: ./dev-local.sh"
fi

setup_toolchain
ensure_rust_target
setup_sccache
printf '  Toolchain : %s  → target %s%s\n' "$TOOLCHAIN" "$TARGET" \
    "$(${USE_ZIGBUILD:-false} && echo " (zigbuild)" || echo "")"

# Initial sanity check of VM reachability (non-fatal)
if vm_reachable; then ok "VM reachable"; else warn "VM not reachable – will retry on each build"; fi

# ── Initial build ─────────────────────────────────────────────────────────
build_rust || true
build_frontend || true

if ! $WATCH; then
    log "Initial build complete; --no-watch set, exiting."
    exit 0
fi

# ═══════════════════════════════════════════════════════════════════
# Dashboard TUI – persistent always-visible terminal dashboard
# ═══════════════════════════════════════════════════════════════════

DASH_LOG=()
DASH_BUILDING=false
DASH_VM_ONLINE=false
DASH_LAST_BUILD="-"
DASH_LAST_DEPLOY="-"
DASH_SERVICE_STATUS=""
DASH_ACTIVE_COUNT=0

_dash_log() {
    local ts
    ts=$(date '+%H:%M:%S')
    DASH_LOG+=("$ts $*")
    [ ${#DASH_LOG[@]} -gt 500 ] && DASH_LOG=("${DASH_LOG[@]: -500}")
}

_dash_check_vm() {
    if vm_reachable 2>/dev/null; then DASH_VM_ONLINE=true; return 0
    else DASH_VM_ONLINE=false; return 1; fi
}

_dash_refresh_services() {
    $DASH_VM_ONLINE || { DASH_ACTIVE_COUNT=0; return; }
    DASH_SERVICE_STATUS=$(ssh_vm "for s in ${ALL_SERVICES[*]}; do systemctl is-active \$s 2>/dev/null || echo unknown; done" 2>/dev/null || echo "")
    DASH_ACTIVE_COUNT=$(echo "$DASH_SERVICE_STATUS" | grep -c 'active' 2>/dev/null || echo 0)
}

_dash_render() {
    local rows cols
    rows=$(tput lines 2>/dev/null || echo 30)
    cols=$(tput cols 2>/dev/null || echo 80)
    [ "$rows" -lt 10 ] && rows=10
    [ "$cols" -lt 40 ] && cols=40

    tput sc 2>/dev/null || true
    printf '\033[2J\033[H'

    local vm_status deploy_label build_label
    if $DASH_VM_ONLINE; then vm_status="${G}● online${N}"
    else vm_status="${R}● offline${N}"; fi
    deploy_label="$($DASH_AUTO_DEPLOY && printf '%sON%s' "$G" "$N" || printf '%sOFF%s' "$R" "$N")"
    build_label="$DASH_LAST_BUILD"

    # ── Header ──
    local sep; sep=$(printf '%*s' $((cols-2)) '' | tr ' ' '═')
    printf '%s%s\n' "$B" "$C"
    printf '╔%s╗\n' "$sep"
    printf '║ %-*s ║\n' $((cols-4)) "IORA Dev Watch"
    printf '╠%s╣\n' "$sep"
    printf '║ %s  │  Build: %b  │  Deploy: %b %*s║\n' \
        "VM: $vm_status" "$build_label" "$deploy_label" $((cols-55)) ''
    printf '╠%s╣\n' "$sep"
    printf '%s' "$N"

    # ── Log region (scrollable) ──
    local log_top log_bottom max_log start shown
    log_top=7
    log_bottom=$((rows - 3))
    [ "$log_bottom" -lt "$log_top" ] && log_bottom="$log_top"
    tput csr "$log_top" "$log_bottom" 2>/dev/null || true

    max_log=$((log_bottom - log_top + 1))
    [ "$max_log" -lt 3 ] && max_log=3
    start=$(( ${#DASH_LOG[@]} > max_log ? ${#DASH_LOG[@]} - max_log : 0 ))
    shown=0
    local i
    for ((i=start; i<${#DASH_LOG[@]}; i++)); do
        printf ' %s\n' "${DASH_LOG[$i]}"
        shown=$((shown+1))
    done
    for ((i=shown; i<max_log; i++)); do printf '\n'; done

    # ── Status Bar (fixed at bottom) ──
    tput csr 1 "$rows" 2>/dev/null || true

    local status_text
    if $DASH_BUILDING; then status_text="${Y}● BUILDING...${N}"
    elif ! $DASH_VM_ONLINE; then status_text="${R}VM offline${N}"
    else status_text="${G}● idle${N}"; fi

    local bar_row=$((rows - 1))
    tput cup "$bar_row" 0 2>/dev/null || true
    tput el 2>/dev/null || true
    printf '  %b  │  Services: %s/%s active  │  %s' \
        "$status_text" "$DASH_ACTIVE_COUNT" "${#ALL_SERVICES[@]}" \
        "${D}Q=quit B=build S=status H=health D=deploy R=restart J=journal${N}"

    tput cup "$rows" 0 2>/dev/null || true
    tput el 2>/dev/null || true
    printf '%s%s%s\n' "$D" "$sep" "$N"

    tput rc 2>/dev/null || true
}

_dash_overlay() {
    local title="$1"; shift
    printf '\033[2J\033[H'
    printf '%s%s═══ %s %s%s\n\n' "$B" "$C" "$title" "$(printf '%*s' $((70-${#title})) '' | tr ' ' '═')" "$N"
    if ! $DASH_VM_ONLINE; then
        printf '  %sVM offline - press C to connect%s\n' "$R" "$N"
    else
        "$@"
    fi
    printf '\n  %sPress any key to return%s\n' "$D" "$N"
    read -r -s -n 1 < /dev/tty 2>/dev/null || true
}

_dash_show_status() {
    printf '  %-30s %-10s %s\n' "Service" "Status" "Binary"
    printf '  %s\n' "$(printf '%*s' 48 '' | tr ' ' '─')"
    for svc in "${ALL_SERVICES[@]}"; do
        local st col bin
        st=$(ssh_vm "systemctl is-active $svc 2>/dev/null | tr -d '\n'" 2>/dev/null || echo "?")
        col="$D"; case "$st" in active) col="$G" ;; failed) col="$R" ;; activating|reloading) col="$Y" ;; esac
        bin=$(ssh_vm "test -f /usr/bin/$svc && echo yes || echo no" 2>/dev/null || echo "?")
        printf '  %-30s %b%-10s%b  %s\n' "$svc" "$col" "$st" "$N" "$bin"
    done
}

_dash_show_health() {
    if ssh_vm "curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null" 2>/dev/null | grep -q '"status":"ok"'; then
        printf '  %s✓ iora-home API: OK%s\n' "$G" "$N"
    else printf '  %s✗ iora-home API: unreachable%s\n' "$R" "$N"; fi
    printf '\n  %sFailed services:%s\n' "$B" "$N"
    ssh_vm "systemctl --failed --no-legend --no-pager 2>/dev/null" 2>/dev/null | head -10 | while IFS= read -r l; do printf '  %s\n' "$l"; done
    printf '\n  %sDisk:%s\n' "$B" "$N"
    ssh_vm "df -h / 2>/dev/null | tail -1" 2>/dev/null | while IFS= read -r l; do printf '  %s\n' "$l"; done
}

_dash_restart_picker() {
    local idx=1 choice target
    for svc in "${ALL_SERVICES[@]}"; do
        local st col
        st=$(ssh_vm "systemctl is-active $svc 2>/dev/null | tr -d '\n'" 2>/dev/null || echo "?")
        col="$D"; case "$st" in active) col="$G" ;; failed) col="$R" ;; esac
        printf '  %2d) %-30s %b%s%b\n' "$idx" "$svc" "$col" "$st" "$N"
        idx=$((idx+1))
    done
    printf '\n  %sEnter number (any other key cancels):%s ' "$D" "$N"
    read -r -s -n 3 choice < /dev/tty 2>/dev/null || true
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "${#ALL_SERVICES[@]}" ] 2>/dev/null; then
        target="${ALL_SERVICES[$((choice-1))]}"
        printf '\n  %sRestarting %s...%s\n' "$Y" "$target" "$N"
        ssh_vm "systemctl reset-failed $target 2>/dev/null; systemctl restart $target 2>/dev/null || systemctl start $target 2>/dev/null || true" 2>/dev/null || true
        sleep 1
        local new_st
        new_st=$(ssh_vm "systemctl is-active $target 2>/dev/null | tr -d '\n'" 2>/dev/null || echo "?")
        printf '  %s→ %s %s%s\n' "$G" "$target" "$new_st" "$N"
    fi
    read -r -s -n 1 < /dev/tty 2>/dev/null || true
}

_dash_journal_picker() {
    local idx=1 choice target
    for svc in "${ALL_SERVICES[@]}"; do
        printf '  %2d) %s\n' "$idx" "$svc"; idx=$((idx+1))
    done
    printf '\n  %sPick service (number):%s ' "$D" "$N"
    read -r -s -n 3 choice < /dev/tty 2>/dev/null || true
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "${#ALL_SERVICES[@]}" ] 2>/dev/null; then
        target="${ALL_SERVICES[$((choice-1))]}"
        printf '\033[2J\033[H'
        printf '%s%s═══ journalctl -u %s -n 40 %s%s\n\n' "$B" "$C" "$target" "$(printf '%*s' $((50-${#target})) '' | tr ' ' '═')" "$N"
        ssh_vm "journalctl -u $target --no-pager -n 40 2>/dev/null" 2>/dev/null || echo "  (no logs)"
        printf '\n  %sPress any key to return%s\n' "$D" "$N"
        read -r -s -n 1 < /dev/tty 2>/dev/null || true
    fi
}

# ── Build trigger (runs in background, feeds output to dashboard) ────────
_dash_build_loop() {
    while true; do
        if $RUST_DIRTY; then
            RUST_DIRTY=false; BUILDING_RUST=true
            DASH_LAST_BUILD="${Y}Building Rust...${N}"
            _dash_log "${Y}[RUST]${N} Building..."
            build_rust > "$CACHE/dash-build.log" 2>&1 || true
            while IFS= read -r l; do [ -n "$l" ] && _dash_log "${M}[RUST]${N} $l"; done < "$CACHE/dash-build.log"
            BUILDING_RUST=false
            DASH_LAST_BUILD="${G}✓ Rust${N}"
            _dash_log "${G}[RUST]${N} Build complete"
            _dash_refresh_services
        fi
        if $FE_DIRTY; then
            FE_DIRTY=false; BUILDING_FE=true
            DASH_LAST_BUILD="${Y}Building FE...${N}"
            _dash_log "${Y}[FE]${N} Building..."
            build_frontend > "$CACHE/dash-build.log" 2>&1 || true
            while IFS= read -r l; do [ -n "$l" ] && _dash_log "${C}[FE]${N} $l"; done < "$CACHE/dash-build.log"
            BUILDING_FE=false
            DASH_LAST_BUILD="${G}✓ FE${N}"
            _dash_log "${G}[FE]${N} Build complete"
        fi
        sleep 1
    done
}

# ═══════════════════════════════════════════════════════════════════
# Main Dashboard
# ═══════════════════════════════════════════════════════════════════

run_dashboard() {
    printf '\033[?25l'
    stty -echo 2>/dev/null
    trap 'printf "\033[?25h"; stty echo 2>/dev/null; printf "\033[2J\033[H"; echo "bye."' EXIT

    DASH_AUTO_DEPLOY=$DO_DEPLOY
    DASH_LAST_BUILD="-"
    _dash_log "${C}[SYSTEM]${N} Dashboard ready. Checking VM..."
    _dash_check_vm
    if $DASH_VM_ONLINE; then
        _dash_log "${G}[SYSTEM]${N} VM online at $VM_HOST:$VM_PORT"
        _dash_refresh_services
        _dash_log "${G}[SYSTEM]${N} ${DASH_ACTIVE_COUNT}/${#ALL_SERVICES[@]} services active"
    else
        _dash_log "${Y}[SYSTEM]${N} VM offline — start with ./dev-local.sh, then press C"
    fi

    start_watchers
    _dash_build_loop &
    TRIGGER_PID=$!

    local tick=0
    while true; do
        if [ $((tick % 3)) -eq 0 ]; then _dash_check_vm; fi
        if $DASH_VM_ONLINE && [ $((tick % 8)) -eq 0 ]; then _dash_refresh_services; fi
        if $BUILDING_RUST || $BUILDING_FE; then DASH_BUILDING=true; else DASH_BUILDING=false; fi

        _dash_render

        local key=""
        IFS= read -r -s -t 0.5 -n 1 key < /dev/tty 2>/dev/null || true

        case "${key:-}" in
            q|Q) kill "$TRIGGER_PID" 2>/dev/null || true; exit 0 ;;
            b|B)
                if $BUILDING_RUST || $BUILDING_FE; then
                    _dash_log "${Y}[BUILD]${N} Already building"
                else
                    _dash_log "${C}[BUILD]${N} Full rebuild triggered"
                    RUST_DIRTY=true; FE_DIRTY=true
                fi ;;
            r)
                if $BUILDING_RUST; then _dash_log "${Y}[RUST]${N} Already building"
                else _dash_log "${C}[RUST]${N} Rust build triggered"; RUST_DIRTY=true; fi ;;
            f)
                if $BUILDING_FE; then _dash_log "${Y}[FE]${N} Already building"
                else _dash_log "${C}[FE]${N} Frontend build triggered"; FE_DIRTY=true; fi ;;
            d|D)
                if $DASH_VM_ONLINE; then
                    _dash_log "${C}[DEPLOY]${N} Deploying..."
                    _dash_render
                    rm -f "$HASH_DIR"/* 2>/dev/null || true
                    deploy_many "${ALL_SERVICES[@]}" 2>&1 | while IFS= read -r l; do _dash_log "${M}[DEPLOY]${N} $l"; done
                    DASH_LAST_DEPLOY="${G}✓ deployed${N}"
                    _dash_refresh_services
                    _dash_log "${G}[DEPLOY]${N} Done — ${DASH_ACTIVE_COUNT}/${#ALL_SERVICES[@]} active"
                else _dash_log "${Y}[DEPLOY]${N} VM offline"; fi ;;
            p|P)
                if $DASH_VM_ONLINE && [ -d "$FRONTEND_DIR/dist" ]; then
                    _dash_log "${C}[FE]${N} Deploying frontend..."
                    deploy_frontend "$FRONTEND_DIR/dist" 2>&1 | while IFS= read -r l; do _dash_log "${C}[FE]${N} $l"; done
                else _dash_log "${Y}[FE]${N} dist not found or VM offline"; fi ;;
            l|L) DASH_AUTO_DEPLOY=$(! $DASH_AUTO_DEPLOY); DO_DEPLOY=$DASH_AUTO_DEPLOY
                _dash_log "${C}[CONFIG]${N} Auto-deploy: $($DASH_AUTO_DEPLOY && echo ON || echo OFF)" ;;
            s|S) _dash_overlay "Service Status" _dash_show_status ;;
            h|H) _dash_overlay "Health Check" _dash_show_health ;;
            R)   _dash_overlay "Restart Service" _dash_restart_picker
                 _dash_refresh_services ;;
            j|J) _dash_overlay "Service Journal" _dash_journal_picker ;;
            c|C)
                _dash_log "${C}[VM]${N} Connecting..."
                _dash_check_vm
                if $DASH_VM_ONLINE; then
                    _dash_log "${G}[VM]${N} Connected!"
                    _dash_refresh_services
                else _dash_log "${R}[VM]${N} Still unreachable — start VM with ./dev-local.sh"; fi ;;
        esac
        tick=$((tick + 1))
    done
}

run_dashboard
