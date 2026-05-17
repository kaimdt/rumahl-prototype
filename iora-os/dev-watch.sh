#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# IORA OS Dev-Loop – Intelligent Watch, Cross-Compile, Deploy
# ═══════════════════════════════════════════════════════════════════
# Features:
#   - Smart change detection (only rebuild changed crates)
#   - Dependency-aware deployment (correct restart order)
#   - Health checks after each restart
#   - Auto-recovery on failed deploys
#
# Usage: ./dev-watch.sh [--skip-sccache] [--target TARGET]
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$SCRIPT_DIR")"

if [ -d "$PROJECT_ROOT/iora-os/backend" ]; then
    WORKSPACE="$PROJECT_ROOT/iora-os/backend"
elif [ -d "$PROJECT_ROOT/backend" ]; then
    WORKSPACE="$PROJECT_ROOT/backend"
else
    echo "ERROR: Cannot find Rust workspace"
    exit 1
fi

SHARED_DIR="$PROJECT_ROOT/.iora-dev"
BIN_DIR="$SHARED_DIR/binaries"
SCCACHE_DIR="$SHARED_DIR/sccache"
DEBOUNCE_SEC=1.0

TARGET="${TARGET:-x86_64-unknown-linux-gnu}"
USE_SCCACHE=true
BUILD_COUNT=0
LAST_BUILD_TIME=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-sccache) USE_SCCACHE=false; shift ;;
        --target) TARGET="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# ═══════════════════════════════════════════════════════════════════
# SERVICE REGISTRY – EXAKT wie IORA OS devup.sh
# ═══════════════════════════════════════════════════════════════════
declare -A SVC_PORT SVC_AFTER SVC_PRIO SVC_CRITICAL
SVC_PORT[iora-core]=8090;           SVC_AFTER[iora-core]="";                                    SVC_PRIO[iora-core]=1;           SVC_CRITICAL[iora-core]=true
SVC_PORT[iora-home]=8126;           SVC_AFTER[iora-home]="iora-core";                            SVC_PRIO[iora-home]=2;           SVC_CRITICAL[iora-home]=true
SVC_PORT[iora-control]=8091;        SVC_AFTER[iora-control]="iora-core iora-home";               SVC_PRIO[iora-control]=3;        SVC_CRITICAL[iora-control]=true
SVC_PORT[iora-assist]=8092;         SVC_AFTER[iora-assist]="iora-core";                          SVC_PRIO[iora-assist]=4;         SVC_CRITICAL[iora-assist]=false
SVC_PORT[iora-secrets]=8093;        SVC_AFTER[iora-secrets]="";                                  SVC_PRIO[iora-secrets]=1;        SVC_CRITICAL[iora-secrets]=true
SVC_PORT[iora-watchdog]=8094;       SVC_AFTER[iora-watchdog]="iora-core";                        SVC_PRIO[iora-watchdog]=1;       SVC_CRITICAL[iora-watchdog]=true
SVC_PORT[iora-security]=8095;       SVC_AFTER[iora-security]="iora-watchdog";                    SVC_PRIO[iora-security]=3;       SVC_CRITICAL[iora-security]=true
SVC_PORT[iora-gateway]=8096;        SVC_AFTER[iora-gateway]="";                                  SVC_PRIO[iora-gateway]=5;        SVC_CRITICAL[iora-gateway]=false
SVC_PORT[iora-supervisor]=8097;     SVC_AFTER[iora-supervisor]="iora-core iora-secrets";         SVC_PRIO[iora-supervisor]=2;     SVC_CRITICAL[iora-supervisor]=true
SVC_PORT[iora-appstore]=8098;       SVC_AFTER[iora-appstore]="iora-core iora-supervisor";        SVC_PRIO[iora-appstore]=5;       SVC_CRITICAL[iora-appstore]=false
SVC_PORT[iora-api]=8099;            SVC_AFTER[iora-api]="iora-core iora-home";                   SVC_PRIO[iora-api]=4;            SVC_CRITICAL[iora-api]=false
SVC_PORT[iora-backup]=8100;         SVC_AFTER[iora-backup]="iora-core";                          SVC_PRIO[iora-backup]=6;         SVC_CRITICAL[iora-backup]=false
SVC_PORT[iora-dev-bridge]=8101;     SVC_AFTER[iora-dev-bridge]="iora-core iora-supervisor";      SVC_PRIO[iora-dev-bridge]=2;     SVC_CRITICAL[iora-dev-bridge]=true
SVC_PORT[iora-domain-validator]=8102; SVC_AFTER[iora-domain-validator]="iora-core";              SVC_PRIO[iora-domain-validator]=6; SVC_CRITICAL[iora-domain-validator]=false
SVC_PORT[iora-files]=8103;          SVC_AFTER[iora-files]="iora-core";                           SVC_PRIO[iora-files]=5;          SVC_CRITICAL[iora-files]=false
SVC_PORT[iora-network-monitor]=8104; SVC_AFTER[iora-network-monitor]="iora-core";                SVC_PRIO[iora-network-monitor]=6; SVC_CRITICAL[iora-network-monitor]=false
SVC_PORT[iora-nginx]=8089;          SVC_AFTER[iora-nginx]="";                                    SVC_PRIO[iora-nginx]=5;          SVC_CRITICAL[iora-nginx]=false
SVC_PORT[iora-resource-manager]=8105; SVC_AFTER[iora-resource-manager]="iora-core";              SVC_PRIO[iora-resource-manager]=6; SVC_CRITICAL[iora-resource-manager]=false
SVC_PORT[iora-updater]=8106;        SVC_AFTER[iora-updater]="iora-core";                         SVC_PRIO[iora-updater]=6;        SVC_CRITICAL[iora-updater]=false
SVC_PORT[iora-connector]=8088;      SVC_AFTER[iora-connector]="iora-core";                       SVC_PRIO[iora-connector]=5;      SVC_CRITICAL[iora-connector]=false

# ═══════════════════════════════════════════════════════════════════
# DEPLOY FUNCTIONS
# ═══════════════════════════════════════════════════════════════════

# Hash tracking for change detection
declare -A LAST_HASHES

deploy_binary() {
    local name="$1"
    local bin="$2"
    local vm_path="/usr/bin/$name"
    
    # Calculate hash
    local hash
    hash=$(sha256sum "$bin" | cut -d' ' -f1)
    local last_hash="${LAST_HASHES[$name]:-}"
    
    if [ "$hash" = "$last_hash" ]; then
        dim "    -> $name (unchanged, skipping)"
        return 0
    fi
    
    # Upload
    scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
        -i "$SSH_KEY" -P "${SSH_PORT:-2222}" "$bin" "root@127.0.0.1:$vm_path" 2>/dev/null
    
    if [ $? -ne 0 ]; then
        err "    -> $name SCP FAILED"
        return 1
    fi
    
    # Set permissions
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
        -i "$SSH_KEY" -p "${SSH_PORT:-2222}" root@127.0.0.1 "chmod 755 $vm_path" 2>/dev/null
    
    echo -e "    -> ${G}$name${N} -> $vm_path"
    LAST_HASHES[$name]="$hash"
    return 0
}

restart_with_health() {
    local name="$1"
    local port="${SVC_PORT[$name]:-}"
    
    # Restart
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
        -i "$SSH_KEY" -p "${SSH_PORT:-2222}" root@127.0.0.1 "systemctl restart $name" 2>/dev/null
    
    # Health check
    if [ -n "$port" ]; then
        local waited=0
        while [ $waited -lt 15 ]; do
            if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
                -i "$SSH_KEY" -p "${SSH_PORT:-2222}" root@127.0.0.1 \
                "curl -sf --max-time 3 http://localhost:$port/health >/dev/null 2>&1" 2>/dev/null; then
                echo -e "    -> ${G}$name restarted (healthy)${N}"
                return 0
            fi
            sleep 2
            waited=$((waited + 2))
        done
        echo -e "    -> ${Y}$name restarted (health check timeout)${N}"
    else
        echo -e "    -> ${G}$name restarted${N}"
    fi
    return 0
}

get_deploy_order() {
    # Simple topological sort
    local services=("$@")
    local ordered=()
    local visited=""
    
    visit() {
        local svc="$1"
        echo "$visited" | grep -q "$svc" && return
        visited="$visited $svc"
        
        local after="${SVC_AFTER[$svc]:-}"
        for dep in $after; do
            echo " ${services[*]} " | grep -q " $dep " && visit "$dep"
        done
        
        ordered+=("$svc")
    }
    
    for svc in "${services[@]}"; do
        visit "$svc"
    done
    
    echo "${ordered[@]}"
}

deploy_services() {
    local services=("$@")
    
    if [ ${#services[@]} -eq 0 ]; then
        dim "  No services to deploy"
        return
    fi
    
    # Get deploy order
    local ordered_str
    ordered_str=$(get_deploy_order "${services[@]}")
    read -ra ordered <<< "$ordered_str"
    
    echo ""
    echo "--------------------------------------------------------------"
    echo -e "${Y}  Deploying ${#ordered[@]} services in dependency order:${N}"
    echo "    ${ordered[*]}"
    echo "--------------------------------------------------------------"
    echo ""
    
    local deployed=0
    local failed=0
    
    for svc in "${ordered[@]}"; do
        local bin="$WORKSPACE/target/$TARGET/debug/$svc"
        if [ ! -f "$bin" ]; then
            dim "    -> $svc (binary not found, skipping)"
            continue
        fi
        
        if deploy_binary "$svc" "$bin"; then
            deployed=$((deployed + 1))
            restart_with_health "$svc"
            sleep 0.5
        else
            failed=$((failed + 1))
        fi
    done
    
    # Reload nginx
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
        -i "$SSH_KEY" -p "${SSH_PORT:-2222}" root@127.0.0.1 "systemctl reload nginx 2>/dev/null" 2>/dev/null
    
    echo ""
    echo "--------------------------------------------------------------"
    echo -e "  Deployed: ${G}$deployed${N}, Failed: ${R}$failed${N}"
    echo "--------------------------------------------------------------"
}

# ═══════════════════════════════════════════════════════════════════
# BUILD FUNCTION
# ═══════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════
# FRONTEND BUILD FUNCTION
# ═══════════════════════════════════════════════════════════════════

FRONTEND_DIR=""
for dir in "$PROJECT_ROOT/frontend" "$PROJECT_ROOT/../frontend"; do
    if [ -f "$dir/package.json" ]; then
        FRONTEND_DIR="$dir"
        break
    fi
done

build_and_sync_frontend() {
    if [ -z "$FRONTEND_DIR" ] || [ ! -d "$FRONTEND_DIR" ]; then
        warn "  Frontend not available"
        return
    fi
    
    if ! command -v npm &>/dev/null; then
        warn "  npm not found - skipping frontend"
        return
    fi
    
    local start_time=$(date +%s)
    
    echo ""
    echo "--------------------------------------------------------------"
    echo -e "${Y} [Frontend] Building frontend...${N}"
    echo "--------------------------------------------------------------"
    
    cd "$FRONTEND_DIR"
    
    # npm install
    if [ ! -d "node_modules" ]; then
        log "Running npm install..."
        npm install 2>&1 | tail -3
    fi
    
    # npm build
    local exit_code=0
    npm run build 2>&1 || exit_code=$?
    
    local elapsed=$(($(date +%s) - start_time))
    
    if [ "$exit_code" -eq 0 ]; then
        echo ""
        ok "Frontend build OK (${elapsed}s)"
        
        if [ -d "dist" ]; then
            log "Deploying frontend to VM..."
            
            # Create tar and upload
            local temp_tar="/tmp/iora-frontend-dist.tar.gz"
            tar -czf "$temp_tar" -C dist . 2>/dev/null
            
            if [ -f "$temp_tar" ]; then
                scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                    -o IdentitiesOnly=yes -i "$SSH_KEY" -P "${SSH_PORT:-2222}" \
                    "$temp_tar" "root@127.0.0.1:/tmp/iora-frontend-dist.tar.gz" 2>/dev/null
                
                if [ $? -eq 0 ]; then
                    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                        -o IdentitiesOnly=yes -i "$SSH_KEY" -p "${SSH_PORT:-2222}" \
                        root@127.0.0.1 "rm -rf /opt/iora/build/dist && mkdir -p /opt/iora/build/dist && tar xzf /tmp/iora-frontend-dist.tar.gz -C /opt/iora/build/dist && systemctl restart iora-home && systemctl reload nginx 2>/dev/null; echo DEPLOYED" 2>/dev/null
                    
                    if [ $? -eq 0 ]; then
                        echo -e "    -> ${G}frontend deployed + iora-home restarted + nginx reloaded${N}"
                    fi
                fi
                rm -f "$temp_tar"
            fi
        fi
    else
        echo ""
        err "Frontend build FAILED (exit code $exit_code)"
    fi
    
    cd "$WORKSPACE"
}

# ═══════════════════════════════════════════════════════════════════
# RUST BUILD FUNCTION
# ═══════════════════════════════════════════════════════════════════

build_and_sync() {
    local now
    now=$(date +%s)
    if [ "$((now - LAST_BUILD_TIME))" -lt 1 ]; then return; fi
    LAST_BUILD_TIME=$now
    BUILD_COUNT=$((BUILD_COUNT + 1))
    mkdir -p "$BIN_DIR"

    echo ""
    echo "--------------------------------------------------------------"
    echo -e "${Y} [Rust #$BUILD_COUNT] Building workspace...${N}"
    echo -e "${D}      $(date '+%H:%M:%S')${N}"
    echo "--------------------------------------------------------------"

    local start_time
    start_time=$(date +%s)

    cd "$WORKSPACE"
    local exit_code=0
    if $USE_ZIGBUILD; then
        cargo zigbuild --target "$TARGET" --workspace --color always 2>&1 || exit_code=$?
    else
        cargo build --target "$TARGET" --workspace --color always 2>&1 || exit_code=$?
    fi
    local elapsed
    elapsed=$(($(date +%s) - start_time))

    if [ "$exit_code" -eq 0 ]; then
        echo ""
        echo "--------------------------------------------------------------"
        ok "Build OK (${elapsed}s)"
        echo "--------------------------------------------------------------"
        local target_dir="$WORKSPACE/target/$TARGET/debug"
        local changed_services=()

        # Find changed binaries
        if [ -d "$WORKSPACE/services" ]; then
            for d in "$WORKSPACE/services"/*/; do
                local name
                name=$(basename "$d")
                local bin="$target_dir/$name"
                if [ -f "$bin" ]; then
                    local hash
                    hash=$(sha256sum "$bin" | cut -d' ' -f1)
                    local last_hash="${LAST_HASHES[$name]:-}"
                    if [ "$hash" != "$last_hash" ]; then
                        changed_services+=("$name")
                    fi
                fi
            done
        fi

        if [ ${#changed_services[@]} -gt 0 ]; then
            echo "  Changed: ${changed_services[*]}"
            deploy_services "${changed_services[@]}"
        else
            dim "  No binaries changed"
        fi

        # Copy to shared folder for 9p hot-reload
        if [ -d "$WORKSPACE/services" ]; then
            for d in "$WORKSPACE/services"/*/; do
                local name
                name=$(basename "$d")
                local bin="$target_dir/$name"
                [ -f "$bin" ] && cp "$bin" "$BIN_DIR/" 2>/dev/null
            done
        fi

        date +%s > "$BIN_DIR/.trigger" 2>/dev/null
        echo "--------------------------------------------------------------"
    else
        echo ""
        echo "--------------------------------------------------------------"
        err "Build FAILED (exit code $exit_code)"
        echo "--------------------------------------------------------------"
    fi
}

show_status() {
    echo ""
    echo -e "${Y}  SERVICE STATUS:${N}"
    echo "  +----------------------------------------------------------+"
    echo "  |  Service              Port  Status    Binary             |"
    echo "  +----------------------------------------------------------+"
    
    for svc in $(for k in "${!SVC_PORT[@]}"; do echo "$k"; done | sort); do
        local port="${SVC_PORT[$svc]}"
        local short_name=$(printf "%-20s" "$svc")
        
        # Check status
        local status="unknown"
        local status_color="$D"
        local result
        result=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
            -i "$SSH_KEY" -p "${SSH_PORT:-2222}" root@127.0.0.1 "systemctl is-active $svc 2>/dev/null" 2>/dev/null || echo "unknown")
        
        if [ "$result" = "active" ]; then
            status="active"
            status_color="$G"
        elif [ "$result" = "inactive" ]; then
            status="inactive"
            status_color="$D"
        else
            status="failed"
            status_color="$R"
        fi
        
        # Check binary
        local binary_status="missing"
        local bin_check
        bin_check=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
            -i "$SSH_KEY" -p "${SSH_PORT:-2222}" root@127.0.0.1 "test -f /usr/bin/$svc && echo EXISTS || echo MISSING" 2>/dev/null || echo "MISSING")
        if [ "$bin_check" = "EXISTS" ]; then binary_status="exists"; fi
        
        printf "  |  %-18s  %-5s  ${status_color}%-9s${N}  %-18s |\n" "$short_name" "$port" "$status" "$binary_status"
    done
    
    echo "  +----------------------------------------------------------+"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════
# COLORS & HELPERS
# ═══════════════════════════════════════════════════════════════════

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; D='\033[2m'; N='\033[0m'
log()    { echo -e "${C}[*]${N} $*"; }
ok()     { echo -e "${G}[+]${N} $*"; }
warn()   { echo -e "${Y}[!]${N} $*"; }
err()    { echo -e "${R}[X]${N} $*"; }
dim()    { echo -e "${D}$*${N}"; }

# ═══════════════════════════════════════════════════════════════════
# SETUP
# ═══════════════════════════════════════════════════════════════════

cat << EOF
  +====================================================================+
  |                  IORA OS Dev-Loop (Intelligent)                     |
  +====================================================================+
  |  Workspace:  $WORKSPACE
  |  Target:     $TARGET
  |  Gitignore:  Respecting .gitignore patterns
  |  Debounce:   Waiting for changes to settle
  +====================================================================+
EOF


mkdir -p "$BIN_DIR" "$SCCACHE_DIR"

# SSH config
SSH_KEY="$PROJECT_ROOT/iora-os/.cache/iora-dev-key"
SSH_PORT="${SSH_PORT:-2222}"

if [ ! -f "$SSH_KEY" ]; then
    warn "SSH key not found: $SSH_KEY"
    warn "Start the VM first: ./dev-local.sh"
fi

# Dependencies
log "Checking dependencies..."

# Rust target
if ! rustup target list --installed | grep -q "$TARGET"; then
    log "Installing target $TARGET..."
    rustup target add "$TARGET" 2>/dev/null || true
fi
dim "  target:     $TARGET OK"

# sccache
export SCCACHE_DIR="$SCCACHE_DIR"
SCCACHE_AVAILABLE=false
if $USE_SCCACHE && command -v sccache &>/dev/null; then
    export RUSTC_WRAPPER=sccache
    SCCACHE_AVAILABLE=true
    dim "  sccache:    OK"
fi

# Cross-compiler
CROSS_CC=""
USE_ZIGBUILD=false

if [ -f "$PROJECT_ROOT/iora-os/output/host/bin/x86_64-linux-gcc" ]; then
    CROSS_CC="$PROJECT_ROOT/iora-os/output/host/bin/x86_64-linux-gcc"
    TARGET="x86_64-unknown-linux-gnu"
    export PATH="$(dirname "$CROSS_CC"):$PATH"
    dim "  Toolchain:  Buildroot"
elif command -v x86_64-linux-musl-gcc &>/dev/null; then
    CROSS_CC="$(command -v x86_64-linux-musl-gcc)"
    TARGET="x86_64-unknown-linux-musl"
    dim "  Toolchain:  musl"
elif command -v x86_64-linux-gnu-gcc &>/dev/null; then
    CROSS_CC="$(command -v x86_64-linux-gnu-gcc)"
    TARGET="x86_64-unknown-linux-gnu"
    dim "  Toolchain:  gnu"
else
    USE_ZIGBUILD=true
    dim "  Toolchain:  zigbuild"
fi

if [ -n "$CROSS_CC" ]; then
    local cv="CC_$(echo "$TARGET" | tr '[:lower:]-' '[:upper:]_')"
    export "$cv=$CROSS_CC"
fi

echo ""
cat << EOF
  +====================================================================+
  |  Setup complete. Starting dev-loop...                               |
  +====================================================================+
EOF


# Initial status
log "Checking VM service status..."
echo ""

# ═══════════════════════════════════════════════════════════════════
# GITIGNORE PARSER
# ═══════════════════════════════════════════════════════════════════

load_gitignore() {
    local dir="$1"
    local gitignore="$dir/.gitignore"
    
    # Start with default ignore patterns
    GITIGNORE_PATTERNS=(
        ".git"
        "node_modules"
        ".next"
        "dist"
        "build"
        "target"
        ".cache"
        "*.pyc"
        "__pycache__"
        ".env.local"
        ".env.*.local"
    )
    
    # Add patterns from .gitignore
    if [ -f "$gitignore" ]; then
        while IFS= read -r line; do
            # Skip comments and empty lines
            [[ "$line" =~ ^[[:space:]]*# ]] && continue
            [[ -z "${line// /}" ]] && continue
            GITIGNORE_PATTERNS+=("$(echo "$line" | xargs)")
        done < "$gitignore"
    fi
}

should_ignore() {
    local path="$1"
    local basedir="$2"
    
    # Get relative path
    local relpath="${path#$basedir}"
    relpath="${relpath#/}"
    
    for pattern in "${GITIGNORE_PATTERNS[@]}"; do
        # Convert glob to regex-like check
        local regex="${pattern//\*/.*}"
        regex="${regex//\?/.}"
        
        # Check if path matches pattern
        if [[ "$relpath" =~ (^|[\/])$regex([\/]|$) ]]; then
            return 0  # should ignore
        fi
        
        # Check filename only
        local filename=$(basename "$path")
        if [[ "$filename" =~ ^$regex$ ]]; then
            return 0  # should ignore
        fi
    done
    
    return 1  # should not ignore
}

# Load gitignore patterns
load_gitignore "$WORKSPACE"
RUST_GITIGNORE_PATTERNS=("${GITIGNORE_PATTERNS[@]}")

FRONTEND_GITIGNORE_PATTERNS=()
if [ -n "${FRONTEND_DIR:-}" ] && [ -d "$FRONTEND_DIR" ]; then
    load_gitignore "$FRONTEND_DIR"
    FRONTEND_GITIGNORE_PATTERNS=("${GITIGNORE_PATTERNS[@]}")
    dim "  Frontend:   $FRONTEND_DIR"
fi

# ═══════════════════════════════════════════════════════════════════
# FILE WATCHER with Smart Debouncing
# ═══════════════════════════════════════════════════════════════════

# Smart debounce: Wait until no more changes come for DEBOUNCE_SEC
DEBOUNCE_PID=""
FE_DEBOUNCE_PID=""
LAST_CHANGE_TIME=0
FE_LAST_CHANGE_TIME=0

rust_debounce_handler() {
    local now=$(date +%s%N)
    LAST_CHANGE_TIME=$now
    
    # Kill previous debounce if running
    if [ -n "$DEBOUNCE_PID" ] && kill -0 "$DEBOUNCE_PID" 2>/dev/null; then
        kill "$DEBOUNCE_PID" 2>/dev/null
    fi
    
    # Start new debounce
    (
        sleep "$DEBOUNCE_SEC"
        # Only trigger if no new changes came during wait
        if [ "$(date +%s%N)" -le "$((LAST_CHANGE_TIME + DEBOUNCE_SEC * 1000000000))" ]; then
            build_and_sync
        fi
    ) &
    DEBOUNCE_PID=$!
}

frontend_debounce_handler() {
    local now=$(date +%s%N)
    FE_LAST_CHANGE_TIME=$now
    
    # Kill previous debounce if running
    if [ -n "$FE_DEBOUNCE_PID" ] && kill -0 "$FE_DEBOUNCE_PID" 2>/dev/null; then
        kill "$FE_DEBOUNCE_PID" 2>/dev/null
    fi
    
    # Start new debounce
    (
        sleep "$DEBOUNCE_SEC"
        # Only trigger if no new changes came during wait
        if [ "$(date +%s%N)" -le "$((FE_LAST_CHANGE_TIME + DEBOUNCE_SEC * 1000000000))" ]; then
            build_and_sync_frontend
        fi
    ) &
    FE_DEBOUNCE_PID=$!
}

WATCH_PID=""
FE_WATCH_PID=""

if command -v fswatch &>/dev/null; then
    # Rust watcher
    fswatch -0 -l "$DEBOUNCE_SEC" \
        --include '\.rs$|\.toml$' --exclude '/target/' --exclude '/\.iora-dev/' \
        "$WORKSPACE/services" "$WORKSPACE/shared" "$WORKSPACE/tools" "$WORKSPACE/apps" \
        2>/dev/null | while read -r -d '' file; do
        # Check gitignore
        if should_ignore "$file" "$WORKSPACE"; then
            continue
        fi
        rust_debounce_handler
    done &
    WATCH_PID=$!
    dim "  Watching:   fswatch (Rust)"
    
    # Frontend watcher
    if [ -n "${FRONTEND_DIR:-}" ] && [ -d "$FRONTEND_DIR" ]; then
        fswatch -0 -l "$DEBOUNCE_SEC" \
            --include '\.tsx$|\.ts$|\.jsx$|\.js$|\.css$|\.json$|\.html$' \
            --exclude '/node_modules/' --exclude '/\.next/' --exclude '/dist/' --exclude '/build/' \
            "$FRONTEND_DIR" \
            2>/dev/null | while read -r -d '' file; do
            # Check gitignore
            if should_ignore "$file" "$FRONTEND_DIR"; then
                continue
            fi
            frontend_debounce_handler
        done &
        FE_WATCH_PID=$!
        dim "  Watching:   fswatch (Frontend)"
    fi
    
    # Reload gitignore on change
    fswatch -0 -l 5 \
        --include '\.gitignore$' \
        "$WORKSPACE" "${FRONTEND_DIR:-}" \
        2>/dev/null | while read -r -d '' file; do
        if [[ "$file" == *"$WORKSPACE/.gitignore" ]]; then
            load_gitignore "$WORKSPACE"
            RUST_GITIGNORE_PATTERNS=("${GITIGNORE_PATTERNS[@]}")
        elif [[ "$file" == *"$FRONTEND_DIR/.gitignore" ]]; then
            load_gitignore "$FRONTEND_DIR"
            FRONTEND_GITIGNORE_PATTERNS=("${GITIGNORE_PATTERNS[@]}")
        fi
    done &
    dim "  Watching:   .gitignore changes"
    
elif command -v inotifywait &>/dev/null; then
    # Rust watcher
    while true; do
        inotifywait -r -q -e modify,create,move \
            --include '\.rs$|\.toml$' \
            --exclude '/target/' --exclude '/\.iora-dev/' \
            "$WORKSPACE/services" "$WORKSPACE/shared" "$WORKSPACE/tools" "$WORKSPACE/apps" \
            2>/dev/null
        # Check gitignore
        local changed_file=$(inotifywait -r -q -e modify,create,move --format '%w%f' \
            --include '\.rs$|\.toml$' \
            --exclude '/target/' --exclude '/\.iora-dev/' \
            "$WORKSPACE/services" "$WORKSPACE/shared" "$WORKSPACE/tools" "$WORKSPACE/apps" \
            2>/dev/null)
        if ! should_ignore "$changed_file" "$WORKSPACE"; then
            rust_debounce_handler
        fi
    done &
    WATCH_PID=$!
    dim "  Watching:   inotifywait (Rust)"
    
    # Frontend watcher
    if [ -n "${FRONTEND_DIR:-}" ] && [ -d "$FRONTEND_DIR" ]; then
        while true; do
            inotifywait -r -q -e modify,create,move \
                --include '\.tsx$|\.ts$|\.jsx$|\.js$|\.css$|\.json$|\.html$' \
                --exclude '/node_modules/' --exclude '/\.next/' --exclude '/dist/' --exclude '/build/' \
                "$FRONTEND_DIR" \
                2>/dev/null
            frontend_debounce_handler
        done &
        FE_WATCH_PID=$!
        dim "  Watching:   inotifywait (Frontend)"
    fi
else
    warn "  No file watcher (install fswatch or inotifywait)"
    warn "  Manual mode: press B to build"
fi

# ═══════════════════════════════════════════════════════════════════
# MAIN LOOP
# ═══════════════════════════════════════════════════════════════════

cat << EOF

  +====================================================================+
  |  [B] = rebuild all    [F] = frontend       [R] = Rust only         |
  |  [D] = deploy only    [H] = health check   [S] = status            |
  |  [Q] = quit                                                        |
  +====================================================================+
  |  Watching for changes... (press key to act)                        |
  +====================================================================+
EOF

cleanup() {
    [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null || true
    [ -n "$FE_WATCH_PID" ] && kill "$FE_WATCH_PID" 2>/dev/null || true
    [ -n "$DEBOUNCE_PID" ] && kill "$DEBOUNCE_PID" 2>/dev/null || true
    [ -n "$FE_DEBOUNCE_PID" ] && kill "$FE_DEBOUNCE_PID" 2>/dev/null || true
    exit 0
}
trap cleanup INT TERM

while true; do
    read -r -t 1 -n 1 key 2>/dev/null || true
    case "${key:-}" in
        b|B) build_and_sync; build_and_sync_frontend ;;
        r|R) build_and_sync ;;
        f|F) build_and_sync_frontend ;;
        d|D) 
            target_dir="$WORKSPACE/target/$TARGET/debug"
            all_services=()
            for d in "$WORKSPACE/services"/*/; do
                name=$(basename "$d")
                bin="$target_dir/$name"
                [ -f "$bin" ] && all_services+=("$name")
            done
            [ ${#all_services[@]} -gt 0 ] && deploy_services "${all_services[@]}"
            ;;
        h|H) 
            for svc in $(for k in "${!SVC_PORT[@]}"; do echo "$k"; done | sort); do
                ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes \
                    -i "$SSH_KEY" -p "$SSH_PORT" root@127.0.0.1 "systemctl is-active $svc" 2>/dev/null || true
            done
            ;;
        s|S) show_status ;;
        q|Q) cleanup ;;
    esac
done
