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
# ControlMaster keeps a single TCP connection open for ControlPersist seconds.
# All subsequent ssh/scp invocations reuse it — saves ~100-200ms per call,
# which matters a lot when a single deploy fires 20+ SSH commands.
SSH_SOCK_DIR="$CACHE/ssh-sockets"
mkdir -p "$SSH_SOCK_DIR"
chmod 700 "$SSH_SOCK_DIR"
SSH_OPTS=(
    -o StrictHostKeyChecking=no
    -o UserKnownHostsFile=/dev/null
    -o IdentitiesOnly=yes
    -o LogLevel=ERROR
    -o ServerAliveInterval=30
    -o ServerAliveCountMax=3
    -o ConnectTimeout=10
    -o AddressFamily=inet
    -o ControlMaster=auto
    -o "ControlPath=$SSH_SOCK_DIR/cm-%C"
    -o ControlPersist=600
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

# Deploy a list of services.
# Optimisations vs. the original loop:
#   * Single multiplexed SSH session enumerates which binaries exist and
#     computes their sha256 in one batch (was: 1 SSH call per service).
#   * Skip install + restart if the binary hash matches the previously
#     deployed one  \u2014 avoids needlessly bouncing healthy services on every
#     rebuild (huge time saver in fast incremental loops).
#   * Per-service install + restart runs in parallel (bounded fan-out).
#   * iora-home bootstrap role-fix is now idempotent and only sleeps when
#     the role actually needs fixing.
deploy_many() {
    local services=("$@")
    [ ${#services[@]} -eq 0 ] && { printf '  deployed=0 failed=0\n'; return 0; }
    local vm_target="$VM_TARGET"

    # ── 1. Batched discovery: which binaries exist + their hashes ─────
    # Single SSH round-trip emits "svc:hash" lines for binaries that exist.
    local svc_list="${services[*]}"
    local discovery
    discovery=$(ssh_vm "
        cd '$vm_target' 2>/dev/null || exit 0
        for s in $svc_list; do
            if [ -f \"\$s\" ]; then
                h=\$(sha256sum \"\$s\" 2>/dev/null | awk '{print \$1}')
                echo \"\$s:\$h\"
            fi
        done
    " 2>/dev/null) || discovery=""

    if [ -z "$discovery" ]; then
        printf '  deployed=0 failed=0 (no binaries built yet)\n'
        return 0
    fi

    # ── 2. Filter to actually-changed binaries ────────────────────────
    local -a to_deploy=()
    local -a to_skip=()
    while IFS=: read -r svc cur_hash; do
        [ -z "$svc" ] && continue
        local hf="$HASH_DIR/$svc"
        local prev_hash=""
        [ -f "$hf" ] && prev_hash=$(cat "$hf" 2>/dev/null)
        if [ -n "$cur_hash" ] && [ "$cur_hash" = "$prev_hash" ]; then
            to_skip+=("$svc")
        else
            to_deploy+=("$svc:$cur_hash")
        fi
    done <<<"$discovery"

    for svc in "${to_skip[@]}"; do
        dim "    $svc : unchanged"
    done

    if [ ${#to_deploy[@]} -eq 0 ]; then
        printf '  deployed=0 skipped=%d (all unchanged)\n' "${#to_skip[@]}"
        return 0
    fi

    # ── 3. Build one combined remote script for all changed services ──
    # Runs sequentially server-side but in a single SSH session (already
    # cheap thanks to ControlMaster); the local 'wait' fanout would add
    # complexity without measurable gain on small service counts.
    local remote_script="set +e"$'\n'
    local restart_block=""
    local home_changed=false
    for entry in "${to_deploy[@]}"; do
        local svc="${entry%%:*}"
        local svc_short="${svc#iora-}"
        [ "$svc" = "iora-home" ] && home_changed=true
        remote_script+="install -m 0755 '$vm_target/$svc' '/usr/bin/$svc' 2>/dev/null"$'\n'
        remote_script+="mkdir -p /etc/iora/db-credentials /tmp/iora-sandboxes /opt/iora/build/$svc/data /etc/systemd/system/$svc.service.d"$'\n'
        remote_script+="[ -f /etc/iora/db-credentials/$svc.env ] || echo 'DATABASE_URL=postgres://root:iora@localhost/iora_${svc_short}' > /etc/iora/db-credentials/$svc.env"$'\n'
        remote_script+="[ -f /etc/iora/$svc.env ] || printf 'DATABASE_URL=postgres://root:iora@localhost:5432/iora_${svc_short}\nRUST_LOG=${svc}=debug\n' > /etc/iora/$svc.env"$'\n'
        remote_script+="[ -f /etc/systemd/system/$svc.service.d/dev-relax.conf ] || printf '[Service]\nProtectSystem=no\nProtectHome=no\nPrivateTmp=no\nNoNewPrivileges=no\nRestrictAddressFamilies=\nSystemCallFilter=\nReadWritePaths=\nReadOnlyPaths=\nEnvironmentFile=/etc/iora/$svc.env\n' > /etc/systemd/system/$svc.service.d/dev-relax.conf && systemctl daemon-reload"$'\n'
        if [ "$svc" = "iora-home" ]; then
            remote_script+="grep -q IORA_BOOTSTRAP_ADMIN_USER /etc/iora/iora-home.env 2>/dev/null || printf 'IORA_BOOTSTRAP_ADMIN_USER=admin\nIORA_BOOTSTRAP_ADMIN_PASSWORD=admin1234\n' >> /etc/iora/iora-home.env"$'\n'
        fi
        if $DO_RESTART; then
            restart_block+="systemctl reset-failed $svc 2>/dev/null; (systemctl restart $svc 2>/dev/null || systemctl start $svc 2>/dev/null) &"$'\n'
        fi
    done
    if $DO_RESTART && [ -n "$restart_block" ]; then
        remote_script+="$restart_block"$'wait\n'
    fi

    if ! ssh_vm "$remote_script" >/dev/null 2>&1; then
        warn "  deploy: remote script reported errors (continuing)"
    fi

    # ── 4. Idempotent admin-role fix (only if iora-home changed and only
    #      if the role actually needs fixing — no fixed sleep). ─────────
    if $home_changed; then
        (
            # Marker file means we already fixed this VM's admin role.
            if ! ssh_vm "test -f /var/lib/iora/.admin-role-fixed" 2>/dev/null; then
                # Wait up to 8s for iora-home to finish bootstrap.
                local i
                for i in 1 2 3 4 5 6 7 8; do
                    if ssh_vm "su - postgres -c \"psql -tAc 'SELECT 1 FROM users LIMIT 1' iora_home\"" 2>/dev/null | grep -q 1; then
                        break
                    fi
                    sleep 1
                done
                ssh_vm "su - postgres -c \"psql iora_home -c \\\"UPDATE users SET role='admin' WHERE username='admin' AND role!='admin'\\\"\" >/dev/null 2>&1; mkdir -p /var/lib/iora && touch /var/lib/iora/.admin-role-fixed" 2>/dev/null || true
            fi
        ) &
    fi

    # ── 5. Persist hashes so the next deploy can skip unchanged ones ──
    local deployed=0
    for entry in "${to_deploy[@]}"; do
        local svc="${entry%%:*}"
        local hash="${entry#*:}"
        echo "$hash" > "$HASH_DIR/$svc"
        printf '    %s->%s %s\n' "$G" "$N" "$svc"
        deployed=$((deployed + 1))
    done

    printf '  deployed=%d skipped=%d\n' "$deployed" "${#to_skip[@]}"
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
    # Stream tar directly over SSH — no local tempfile, no separate scp +
    # unpack roundtrips. With ControlMaster this reuses the existing
    # connection. Unpack to a temp dir and mv-swap so the live dist is
    # never empty mid-deploy.
    if ! tar -czf - -C "$dist" . 2>/dev/null | \
         ssh "${SSH_OPTS[@]}" -p "$VM_PORT" "root@$VM_HOST" '
            set -e
            mkdir -p /opt/iora/build
            tmp=$(mktemp -d /opt/iora/build/.dist-XXXXXX)
            tar xzf - -C "$tmp"
            rm -rf /opt/iora/build/dist
            mv "$tmp" /opt/iora/build/dist
            systemctl reload nginx 2>/dev/null || true
         ' 2>/dev/null; then
        err "frontend deploy failed"
        return 1
    fi
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
    # Tear down any open SSH control-master sessions so the next run starts
    # fresh and we don't leak unix sockets in $CACHE/ssh-sockets.
    for sock in "$SSH_SOCK_DIR"/cm-*; do
        [ -S "$sock" ] || continue
        ssh -o ControlPath="$sock" -O exit "dummy" 2>/dev/null || true
        rm -f "$sock"
    done
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
# Dashboard TUI – proper terminal UI with resize support
# ═══════════════════════════════════════════════════════════════════

DASH_LOG=()
DASH_BUILDING=false
DASH_VM_ONLINE=false
DASH_LAST_BUILD="-"
DASH_LAST_DEPLOY="-"
DASH_ACTIVE_COUNT=0
DASH_AUTO_DEPLOY=$DO_DEPLOY
DASH_ROWS=24
DASH_COLS=80
DASH_HEADER_H=6
DASH_FOOTER_H=2
DASH_LOG_MAX=10

_dash_get_size() {
    DASH_ROWS=$(tput lines 2>/dev/null || echo 24)
    DASH_COLS=$(tput cols 2>/dev/null || echo 80)
    [ "$DASH_ROWS" -lt 10 ] && DASH_ROWS=10
    [ "$DASH_COLS" -lt 40 ] && DASH_COLS=40
    DASH_LOG_MAX=$((DASH_ROWS - DASH_HEADER_H - DASH_FOOTER_H))
    [ "$DASH_LOG_MAX" -lt 3 ] && DASH_LOG_MAX=3
}

_dash_sep() { printf '%*s' "$1" '' | tr ' ' '═'; }

_dash_header() {
    local sep; sep=$(_dash_sep $((DASH_COLS-2)))
    tput cup 0 0 2>/dev/null
    printf '%s%s' "$B" "$C"
    printf '╔%s╗\n' "$sep"
    printf '║ %-*s ║\n' $((DASH_COLS-4)) "IORA Dev Watch"
    printf '╠%s╣\n' "$sep"
    local vm_mark deploy_label
    $DASH_VM_ONLINE && vm_mark="${G}● online${N}" || vm_mark="${R}● offline${N}"
    $DASH_AUTO_DEPLOY && deploy_label="${G}ON${N}" || deploy_label="${R}OFF${N}"
    printf '║ VM: %b  │  Build: %b  │  Deploy: %b %*s║\n' \
        "$vm_mark" "$DASH_LAST_BUILD" "$deploy_label" $((DASH_COLS-55)) ''
    printf '╠%s╣\n' "$sep"
    printf '%s' "$N"
}

_dash_logs() {
    local row=$DASH_HEADER_H
    local total=${#DASH_LOG[@]}
    local start=$(( total > DASH_LOG_MAX ? total - DASH_LOG_MAX : 0 ))
    local i
    for ((i=start; i<total; i++)); do
        tput cup $row 0 2>/dev/null
        tput el 2>/dev/null
        printf ' %s' "${DASH_LOG[$i]}"
        row=$((row + 1))
    done
    while [ $row -lt $((DASH_HEADER_H + DASH_LOG_MAX)) ]; do
        tput cup $row 0 2>/dev/null
        tput el 2>/dev/null
        row=$((row + 1))
    done
}

_dash_footer() {
    local row=$((DASH_ROWS - 2))
    tput cup $row 0 2>/dev/null
    tput el 2>/dev/null
    local st
    if $DASH_BUILDING; then st="${Y}● BUILDING...${N}"
    elif ! $DASH_VM_ONLINE; then st="${R}VM offline — press C to connect${N}"
    else st="${G}● idle${N}"; fi
    printf '  %b  │  Services: %s/%s active  │  %s' \
        "$st" "$DASH_ACTIVE_COUNT" "${#ALL_SERVICES[@]}" \
        "${D}Q=quit B=build S=status H=health D=deploy R=restart J=journal${N}"
    row=$((DASH_ROWS - 1))
    tput cup $row 0 2>/dev/null
    tput el 2>/dev/null
    local sep; sep=$(_dash_sep $DASH_COLS)
    printf '%s%s%s' "$D" "$sep" "$N"
}

_dash_full() {
    _dash_get_size
    printf '\033[2J\033[H'
    _dash_header
    _dash_logs
    _dash_footer
}

_dash_log() {
    local ts; ts=$(date '+%H:%M:%S')
    DASH_LOG+=("$ts $*")
    [ ${#DASH_LOG[@]} -gt 500 ] && DASH_LOG=("${DASH_LOG[@]: -500}")
}

_dash_check_vm() {
    if vm_reachable 2>/dev/null; then DASH_VM_ONLINE=true; return 0
    else DASH_VM_ONLINE=false; return 1; fi
}

_dash_refresh_services() {
    $DASH_VM_ONLINE || { DASH_ACTIVE_COUNT=0; return; }
    DASH_ACTIVE_COUNT=$(ssh_vm "for s in ${ALL_SERVICES[*]}; do systemctl is-active \$s 2>/dev/null || echo unknown; done" 2>/dev/null | grep -c 'active' || echo 0)
}

_dash_overlay_status() {
    printf '\033[2J\033[H'
    printf '%s%s═══ Service Status %s%s\n\n' "$B" "$C" "$(_dash_sep $((DASH_COLS-20)))" "$N"
    if ! $DASH_VM_ONLINE; then
        printf '  %sVM offline — press C to connect%s\n' "$R" "$N"
    else
        printf '  %-30s %-10s %s\n' "Service" "Status" "Binary"
        printf '  %s\n' "$(_dash_sep 48)"
        for svc in "${ALL_SERVICES[@]}"; do
            local st col bin
            st=$(ssh_vm "systemctl is-active $svc 2>/dev/null | tr -d '\n'" 2>/dev/null || echo "?")
            col="$D"; case "$st" in active) col="$G" ;; failed) col="$R" ;; activating|reloading) col="$Y" ;; esac
            bin=$(ssh_vm "test -f /usr/bin/$svc && echo yes || echo no" 2>/dev/null || echo "?")
            printf '  %-30s %b%-10s%b  %s\n' "$svc" "$col" "$st" "$N" "$bin"
        done
    fi
    printf '\n  %sPress any key to return%s\n' "$D" "$N"
    read -r -s -n 1 < /dev/tty 2>/dev/null || true
}

_dash_overlay_health() {
    printf '\033[2J\033[H'
    printf '%s%s═══ Health Check %s%s\n\n' "$B" "$C" "$(_dash_sep $((DASH_COLS-20)))" "$N"
    if ! $DASH_VM_ONLINE; then
        printf '  %sVM offline%s\n' "$R" "$N"
    else
        if ssh_vm "curl -sf --max-time 3 http://127.0.0.1:8126/api/health 2>/dev/null" 2>/dev/null | grep -q '"status":"ok"'; then
            printf '  %s✓ iora-home API: OK%s\n' "$G" "$N"
        else printf '  %s✗ iora-home API: unreachable%s\n' "$R" "$N"; fi
        printf '\n  %sFailed services:%s\n' "$B" "$N"
        ssh_vm "systemctl --failed --no-legend --no-pager 2>/dev/null" 2>/dev/null | head -10 | while IFS= read -r l; do printf '  %s\n' "$l"; done
        printf '\n  %sDisk:%s\n' "$B" "$N"
        ssh_vm "df -h / 2>/dev/null | tail -1" 2>/dev/null | while IFS= read -r l; do printf '  %s\n' "$l"; done
    fi
    printf '\n  %sPress any key to return%s\n' "$D" "$N"
    read -r -s -n 1 < /dev/tty 2>/dev/null || true
}

_dash_overlay_restart() {
    printf '\033[2J\033[H'
    printf '%s%s═══ Restart Service %s%s\n\n' "$B" "$C" "$(_dash_sep $((DASH_COLS-20)))" "$N"
    if ! $DASH_VM_ONLINE; then
        printf '  %sVM offline%s\n' "$R" "$N"
        printf '\n  %sPress any key to return%s\n' "$D" "$N"
        read -r -s -n 1 < /dev/tty 2>/dev/null || true
        return
    fi
    local idx=1
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
        local target="${ALL_SERVICES[$((choice-1))]}"
        printf '\n  %sRestarting %s...%s\n' "$Y" "$target" "$N"
        ssh_vm "systemctl reset-failed $target 2>/dev/null; systemctl restart $target 2>/dev/null || systemctl start $target 2>/dev/null || true" 2>/dev/null || true
        sleep 1
        local new_st
        new_st=$(ssh_vm "systemctl is-active $target 2>/dev/null | tr -d '\n'" 2>/dev/null || echo "?")
        printf '  %s→ %s %s%s\n' "$G" "$target" "$new_st" "$N"
    fi
    printf '\n  %sPress any key to return%s\n' "$D" "$N"
    read -r -s -n 1 < /dev/tty 2>/dev/null || true
}

_dash_overlay_journal() {
    printf '\033[2J\033[H'
    printf '%s%s═══ Service Journal %s%s\n\n' "$B" "$C" "$(_dash_sep $((DASH_COLS-20)))" "$N"
    if ! $DASH_VM_ONLINE; then
        printf '  %sVM offline%s\n' "$R" "$N"
        printf '\n  %sPress any key to return%s\n' "$D" "$N"
        read -r -s -n 1 < /dev/tty 2>/dev/null || true
        return
    fi
    local idx=1
    for svc in "${ALL_SERVICES[@]}"; do
        printf '  %2d) %s\n' "$idx" "$svc"; idx=$((idx+1))
    done
    printf '\n  %sPick service (number):%s ' "$D" "$N"
    read -r -s -n 3 choice < /dev/tty 2>/dev/null || true
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "${#ALL_SERVICES[@]}" ] 2>/dev/null; then
        local target="${ALL_SERVICES[$((choice-1))]}"
        printf '\033[2J\033[H'
        printf '%s%s═══ journalctl -u %s -n 40 %s%s\n\n' "$B" "$C" "$target" "$(_dash_sep $((DASH_COLS-20)))" "$N"
        ssh_vm "journalctl -u $target --no-pager -n 40 2>/dev/null" 2>/dev/null || echo "  (no logs)"
        printf '\n  %sPress any key to return%s\n' "$D" "$N"
        read -r -s -n 1 < /dev/tty 2>/dev/null || true
    fi
}

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
# Main Dashboard Loop
# ═══════════════════════════════════════════════════════════════════

run_dashboard() {
    printf '\033[?25l'
    stty -echo 2>/dev/null

    _dash_cleanup() {
        printf '\033[?25h'
        stty echo 2>/dev/null
        tput cup "$DASH_ROWS" 0 2>/dev/null
        printf '\nbye.\n'
    }
    trap '_dash_cleanup' EXIT
    trap '_dash_full' WINCH

    _dash_get_size
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

    printf '\033[2J\033[H'
    _dash_header
    _dash_logs
    _dash_footer

    start_watchers
    _dash_build_loop &
    local build_pid=$!

    local tick=0
    while true; do
        if [ $((tick % 6)) -eq 0 ]; then
            local was_online=$DASH_VM_ONLINE
            _dash_check_vm
            [ "$was_online" != "$DASH_VM_ONLINE" ] && _dash_header
        fi
        if $DASH_VM_ONLINE && [ $((tick % 16)) -eq 0 ]; then
            _dash_refresh_services
            _dash_footer
        fi

        local was_building=$DASH_BUILDING
        if $BUILDING_RUST || $BUILDING_FE; then DASH_BUILDING=true; else DASH_BUILDING=false; fi
        [ "$was_building" != "$DASH_BUILDING" ] && { _dash_footer; _dash_header; }

        local key=""
        IFS= read -r -s -t 0.3 -n 1 key < /dev/tty 2>/dev/null || true

        case "${key:-}" in
            q|Q) kill "$build_pid" 2>/dev/null || true; exit 0 ;;
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
                    _dash_footer
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
            l|L)
                DASH_AUTO_DEPLOY=$(! $DASH_AUTO_DEPLOY); DO_DEPLOY=$DASH_AUTO_DEPLOY
                _dash_log "${C}[CONFIG]${N} Auto-deploy: $($DASH_AUTO_DEPLOY && echo ON || echo OFF)"
                _dash_header ;;
            s|S) _dash_overlay_status; _dash_full ;;
            h|H) _dash_overlay_health; _dash_full ;;
            R)   _dash_overlay_restart; _dash_refresh_services; _dash_full ;;
            j|J) _dash_overlay_journal; _dash_full ;;
            c|C)
                _dash_log "${C}[VM]${N} Connecting..."
                _dash_check_vm
                if $DASH_VM_ONLINE; then
                    _dash_log "${G}[VM]${N} Connected!"
                    _dash_refresh_services
                    _dash_header
                else _dash_log "${R}[VM]${N} Still unreachable — start VM with ./dev-local.sh"; fi ;;
        esac

        [ -n "${key:-}" ] && { _dash_logs; _dash_footer; }
        tick=$((tick + 1))
    done
}

run_dashboard
