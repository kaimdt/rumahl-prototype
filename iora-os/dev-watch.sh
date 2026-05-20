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
    R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; C=$'\033[0;36m'
    D=$'\033[2m';    B=$'\033[1m';    N=$'\033[0m'
else
    R=''; G=''; Y=''; C=''; D=''; B=''; N=''
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

# SSH control socket directory (multiplexing → fast SCP/SSH calls)
SSH_CTL_DIR="$CACHE/ssh-ctl"
mkdir -p "$SSH_CTL_DIR"
chmod 700 "$SSH_CTL_DIR"

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
        --no-restart)      DO_RESTART=false; shift ;;
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
    -o ControlMaster=auto
    -o "ControlPath=$SSH_CTL_DIR/cm-%C"
    -o ControlPersist=120
    -i "$SSH_KEY"
)

ssh_vm() { ssh "${SSH_OPTS[@]}" -p "$VM_PORT" "root@$VM_HOST" "$@"; }
scp_to_vm() { scp "${SSH_OPTS[@]}" -P "$VM_PORT" -q "$1" "root@$VM_HOST:$2"; }

vm_reachable() {
    [ -f "$SSH_KEY" ] || return 1
    ssh_vm -o ConnectTimeout=5 -o BatchMode=yes "true" >/dev/null 2>&1
}

cleanup_ssh() {
    # Close the multiplexed master connection cleanly
    ssh -O exit "${SSH_OPTS[@]}" -p "$VM_PORT" "root@$VM_HOST" >/dev/null 2>&1 || true
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
        # Use try-restart so we don't fail when a unit doesn't exist
        ssh_vm "systemctl try-restart $name 2>/dev/null || systemctl restart $name 2>/dev/null || true" \
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
            if $DO_RESTART; then
                ssh_vm "systemctl try-restart $svc 2>/dev/null || systemctl restart $svc 2>/dev/null || true" >/dev/null 2>&1 || true
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

# ── Health check ──────────────────────────────────────────────────────────
health_check() {
    if ! vm_reachable; then
        warn "VM not reachable for health check"
        return 1
    fi
    log "Service status (failed only):"
    ssh_vm "systemctl --failed --no-legend --no-pager 2>/dev/null | awk '{print \$1, \$3}' | head -20" \
        || true
    log "iora-home /api/health:"
    ssh_vm "curl -sf --max-time 5 http://127.0.0.1:8126/api/health || curl -sf --max-time 5 http://127.0.0.1:8126/health || echo unreachable" \
        2>/dev/null || true
}

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

    local rc=0
    # Sync changed source files to VM before building
    rsync -az --delete \
        --exclude='.git' --exclude='target' --exclude='node_modules' \
        --exclude='.cache' --exclude='buildroot-*' --exclude='releases' \
        --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' \
        --exclude='.iora-dev' \
        -e "ssh ${SSH_OPTS[*]} -p $VM_PORT" \
        "$REPO_ROOT/" "root@$VM_HOST:/home/iora/iora/" 2>&1 | tail -3
    ssh_vm "su - iora -c 'cd $VM_WORKSPACE && cargo build --workspace 2>&1'" || rc=$?

    now=$(date +%s); elapsed=$((now - start))
    if [ "$rc" -ne 0 ]; then
        err "Rust build FAILED (exit $rc) after ${elapsed}s"
        return $rc
    fi
    ok "Rust build OK in ${elapsed}s"

    deploy_many "${ALL_SERVICES[@]}"
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
        systemctl try-restart iora-home 2>/dev/null || true
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

trigger_loop() {
    while true; do
        if $RUST_DIRTY; then RUST_DIRTY=false; build_rust || true; fi
        if $FE_DIRTY;   then FE_DIRTY=false;   build_frontend || true; fi
        sleep 1
    done
}

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

# ── Status table ──────────────────────────────────────────────────────────
show_status() {
    if ! vm_reachable; then
        warn "VM not reachable ($VM_HOST:$VM_PORT)"
        return
    fi
    printf '\n  %sService                       Active     Binary%s\n' "$Y" "$N"
    printf '  ────────────────────────────────────────────────────\n'
    for svc in "${ALL_SERVICES[@]}"; do
        local active bin
        active=$(ssh_vm "systemctl is-active $svc 2>/dev/null" 2>/dev/null || echo "unknown")
        bin=$(ssh_vm "test -f /usr/bin/$svc && echo yes || echo no" 2>/dev/null || echo "?")
        local col="$D"
        case "$active" in active) col="$G" ;; failed) col="$R" ;; activating) col="$Y" ;; esac
        printf '  %-28s  %s%-9s%s  %s\n' "$svc" "$col" "$active" "$N" "$bin"
    done
    echo
}

# ── Cleanup / signal handling ─────────────────────────────────────────────
cleanup() {
    stop_watchers
    cleanup_ssh
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
    "$($USE_ZIGBUILD && echo " (zigbuild)" || echo "")"

# Initial sanity check of VM reachability (non-fatal)
if vm_reachable; then ok "VM reachable"; else warn "VM not reachable – will retry on each build"; fi

# ── Initial build ─────────────────────────────────────────────────────────
build_rust || true
build_frontend || true

if ! $WATCH; then
    log "Initial build complete; --no-watch set, exiting."
    exit 0
fi

# ── Watcher + key loop ────────────────────────────────────────────────────
start_watchers
trigger_loop &
TRIGGER_PID=$!

cat <<EOF

${B}┌──────────────────────────────────────────────────────────────────┐
│  [B] full rebuild   [R] Rust    [F] Frontend                     │
│  [D] redeploy       [S] status  [H] health   [Q] quit            │
└──────────────────────────────────────────────────────────────────┘${N}
EOF

while true; do
    key=""
    # Read single char w/ 1s timeout so the loop is responsive but doesn't busy-spin.
    if read -r -t 1 -n 1 key 2>/dev/null; then :; fi
    case "${key:-}" in
        b|B) RUST_DIRTY=true; FE_DIRTY=true ;;
        r|R) RUST_DIRTY=true ;;
        f|F) FE_DIRTY=true ;;
        d|D)
            if vm_reachable; then
                # Force re-deploy: clear all hashes first
                rm -f "$HASH_DIR"/* 2>/dev/null || true
                deploy_many "${ALL_SERVICES[@]}"
            else
                warn "VM not reachable"
            fi
            ;;
        s|S) show_status ;;
        h|H) health_check ;;
        q|Q) log "bye."; kill "$TRIGGER_PID" 2>/dev/null || true; exit 0 ;;
    esac
done
