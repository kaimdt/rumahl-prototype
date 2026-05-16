#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# IORA OS Dev-Loop – Watch, Cross-Compile, Sync to VM
# ═══════════════════════════════════════════════════════════════════
# Usage: ./dev-watch.sh [--skip-sccache] [--target TARGET]
#
# All dependencies (cross-compiler, sccache, rust target) are
# auto-installed if missing.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# -- Auto-detect paths --------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || dirname "$SCRIPT_DIR")"

if [ -d "$PROJECT_ROOT/iora-os/backend" ]; then
    WORKSPACE="$PROJECT_ROOT/iora-os/backend"
elif [ -d "$PROJECT_ROOT/backend" ]; then
    WORKSPACE="$PROJECT_ROOT/backend"
else
    echo "ERROR: Cannot find Rust workspace (iora-os/backend or backend/)"
    exit 1
fi

SHARED_DIR="$PROJECT_ROOT/.iora-dev"
BIN_DIR="$SHARED_DIR/binaries"
SCCACHE_DIR="$SHARED_DIR/sccache"
TRIGGER_FILE="$BIN_DIR/.trigger"
DEBOUNCE_SEC=1.0

TARGET="${TARGET:-x86_64-unknown-linux-gnu}"
USE_SCCACHE=true
BUILD_COUNT=0
LAST_BUILD_TIME=0
SCCACHE_AVAILABLE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-sccache) USE_SCCACHE=false; shift ;;
        --target) TARGET="$2"; shift 2 ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; N='\033[0m'; D='\033[0;90m'
log()  { echo -e "${C}[*]${N} $*"; }
ok()   { echo -e "${G}[+]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[X]${N} $*"; }
dim()  { echo -e "${D}    $*${N}"; }

mkdir -p "$BIN_DIR" "$SCCACHE_DIR"

# -- Header -------------------------------------------------------------
echo "=============================================================="
echo -e "${C} IORA OS Dev-Loop${N}"
echo "=============================================================="
echo "  Workspace:  $WORKSPACE"
echo "  Target:     $TARGET"
echo "  Shared dir: $SHARED_DIR"
echo ""

# -- Shared folder check ------------------------------------------------
if [ ! -d "$SHARED_DIR" ]; then
    err "Shared folder not found: $SHARED_DIR"
    echo "  The dev-local script creates this folder."
    echo "  Start the VM first: ./dev-local.sh"
    echo ""
fi

# -- Dependencies: auto-install -----------------------------------------
dim "Checking dependencies..."

# Package manager
PKG_MANAGER=""
command -v brew &>/dev/null && PKG_MANAGER="brew" && dim "brew:       OK"
command -v apt-get &>/dev/null && PKG_MANAGER="apt" && dim "apt:        OK"
[ -z "$PKG_MANAGER" ] && warn "No package manager (brew/apt). Install manually."

# Rust target
if ! rustup target list --installed 2>/dev/null | grep -qF "$TARGET"; then
    warn "target:     installing $TARGET..."
    rustup target add "$TARGET" || warn "target: install failed"
else
    dim "target:     $TARGET OK"
fi

# Cross C compiler
BUILDROOT_GCC=false
CROSS_CC_FOUND=false
[ -f "$PROJECT_ROOT/iora-os/output/host/bin/x86_64-linux-gcc" ] && BUILDROOT_GCC=true
[ -f "$PROJECT_ROOT/output/host/bin/x86_64-linux-gcc" ] && BUILDROOT_GCC=true
command -v x86_64-linux-musl-gcc &>/dev/null && CROSS_CC_FOUND=true
command -v x86_64-linux-gnu-gcc &>/dev/null && CROSS_CC_FOUND=true

if $CROSS_CC_FOUND; then
    dim "cross-cc:   OK"
elif $BUILDROOT_GCC; then
    dim "cross-cc:   Buildroot toolchain detected"
else
    warn "cross-cc:   not found - auto-installing..."
    case "$PKG_MANAGER" in
        brew)
            brew install x86_64-unknown-linux-gnu 2>&1 | tail -3
            command -v x86_64-linux-gnu-gcc &>/dev/null && ok "cross-cc:   installed" || err "cross-cc: install failed"
            ;;
        apt)
            sudo apt-get update -qq && sudo apt-get install -y -qq gcc-x86-64-linux-gnu 2>&1 | tail -3
            command -v x86_64-linux-gnu-gcc &>/dev/null && ok "cross-cc:   installed" || err "cross-cc: install failed"
            ;;
        *)
            err "cross-cc:   not found. Install manually:"
            echo "  macOS: brew install x86_64-unknown-linux-gnu"
            echo "  Linux: sudo apt-get install gcc-x86-64-linux-gnu"
            ;;
    esac
fi

# sccache
export SCCACHE_DIR="$SCCACHE_DIR"
if $USE_SCCACHE; then
    if command -v sccache &>/dev/null; then
        export RUSTC_WRAPPER=sccache
        SCCACHE_AVAILABLE=true
        dim "sccache:    OK"
    elif command -v cargo &>/dev/null; then
        warn "sccache:    installing via cargo (2-5 min)..."
        cargo install sccache 2>&1 | tail -3
        if command -v sccache &>/dev/null; then
            export RUSTC_WRAPPER=sccache
            SCCACHE_AVAILABLE=true
            ok "sccache:    installed"
        else
            SCCACHE_AVAILABLE=false
            warn "sccache:    install failed"
        fi
    else
        SCCACHE_AVAILABLE=false
        dim "sccache:    not found (optional)"
    fi
else
    dim "sccache:    disabled"
fi

# -- Cross-compiler detection -------------------------------------------
CROSS_CC=""
CROSS_CC_TYPE=""
EFFECTIVE_TARGET="$TARGET"

if [ -f "$PROJECT_ROOT/iora-os/output/host/bin/x86_64-linux-gcc" ]; then
    CROSS_CC="$PROJECT_ROOT/iora-os/output/host/bin/x86_64-linux-gcc"
    CROSS_CC_TYPE="Buildroot"
    EFFECTIVE_TARGET="x86_64-unknown-linux-gnu"
    export PATH="$(dirname "$CROSS_CC"):$PATH"
    cc_var="CC_$(echo "$EFFECTIVE_TARGET" | tr '[:lower:]-' '[:upper:]_')"
    export "$cc_var=$CROSS_CC"
    ok "Toolchain: Buildroot ($(dirname "$CROSS_CC"))"
elif [ -f "$PROJECT_ROOT/output/host/bin/x86_64-linux-gcc" ]; then
    CROSS_CC="$PROJECT_ROOT/output/host/bin/x86_64-linux-gcc"
    CROSS_CC_TYPE="Buildroot"
    EFFECTIVE_TARGET="x86_64-unknown-linux-gnu"
    export PATH="$(dirname "$CROSS_CC"):$PATH"
    cc_var="CC_$(echo "$EFFECTIVE_TARGET" | tr '[:lower:]-' '[:upper:]_')"
    export "$cc_var=$CROSS_CC"
    ok "Toolchain: Buildroot ($(dirname "$CROSS_CC"))"
elif command -v x86_64-linux-musl-gcc &>/dev/null; then
    CROSS_CC="$(command -v x86_64-linux-musl-gcc)"
    CROSS_CC_TYPE="musl"
    EFFECTIVE_TARGET="x86_64-unknown-linux-musl"
    cc_var="CC_$(echo "$EFFECTIVE_TARGET" | tr '[:lower:]-' '[:upper:]_')"
    export "$cc_var=$CROSS_CC"
    ok "Toolchain: musl ($CROSS_CC)"
elif command -v x86_64-linux-gnu-gcc &>/dev/null; then
    CROSS_CC="$(command -v x86_64-linux-gnu-gcc)"
    CROSS_CC_TYPE="gnu"
    EFFECTIVE_TARGET="x86_64-unknown-linux-gnu"
    cc_var="CC_$(echo "$EFFECTIVE_TARGET" | tr '[:lower:]-' '[:upper:]_')"
    export "$cc_var=$CROSS_CC"
    ok "Toolchain: gnu ($CROSS_CC)"
else
    # No native cross-compiler - try zigbuild
    USE_ZIGBUILD=false
    ZIG_BIN="$(command -v zig 2>/dev/null || true)"
    ZIGBUILD_BIN="$(command -v cargo-zigbuild 2>/dev/null || true)"

    if [ -z "$ZIG_BIN" ]; then
        warn "zig:        not found (required by cargo-zigbuild)"
        if [ "$PKG_MANAGER" = "brew" ]; then
            warn "            installing via brew..."
            brew install zig 2>&1 | tail -3
        elif [ "$PKG_MANAGER" = "apt" ]; then
            warn "            installing via snap..."
            sudo snap install zig --classic 2>&1 | tail -3 || warn "snap failed, install manually: sudo apt install zig"
        fi
        ZIG_BIN="$(command -v zig 2>/dev/null || true)"
        [ -n "$ZIG_BIN" ] && ok "zig:        installed" || err "zig:        install failed"
    fi

    if [ -n "$ZIGBUILD_BIN" ] && [ -n "$ZIG_BIN" ]; then
        USE_ZIGBUILD=true
        ok "Toolchain: Zig (cargo-zigbuild)"
    elif [ -n "$ZIG_BIN" ]; then
        warn "Toolchain: installing cargo-zigbuild ..."
        cargo install cargo-zigbuild 2>&1 | tail -3
        ZIGBUILD_BIN="$(command -v cargo-zigbuild 2>/dev/null || true)"
        if [ -n "$ZIGBUILD_BIN" ]; then
            USE_ZIGBUILD=true
            ok "Toolchain: Zig (cargo-zigbuild) - ready"
        else
            err "Toolchain: FAILED to install cargo-zigbuild"
        fi
    else
        err "Toolchain: Zig not available"
        echo "  Install: brew install zig && cargo install cargo-zigbuild"
    fi
fi

if [ "$EFFECTIVE_TARGET" != "$TARGET" ]; then
    dim "Target:     $EFFECTIVE_TARGET (auto-selected)"
    TARGET="$EFFECTIVE_TARGET"
fi

echo "=============================================================="
echo "  [B] = force rebuild    [Q] = quit    [S] = sccache stats"
echo "  [T] = toggle sccache   [C] = clear sccache"
echo ""

# -- Build function -----------------------------------------------------
build_and_sync() {
    local now
    now=$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo $(($(date +%s) * 1000)))
    if [ "$((now - LAST_BUILD_TIME))" -lt 800 ]; then return; fi
    LAST_BUILD_TIME=$now
    BUILD_COUNT=$((BUILD_COUNT + 1))
    mkdir -p "$BIN_DIR"

    echo ""
    echo "--------------------------------------------------------------"
    echo -e "${Y} [#$BUILD_COUNT] Building workspace...${N}"
    echo -e "${D}      $(date '+%H:%M:%S')${N}"
    echo "--------------------------------------------------------------"

    local start_time; start_time=$(date +%s)

    if [ -n "$CROSS_CC" ]; then
        local lv; lv="CARGO_TARGET_$(echo "$TARGET" | tr '[:lower:]-' '[:upper:]_')_LINKER"
        export "$lv=$CROSS_CC"
        local cv; cv="CC_$(echo "$TARGET" | tr '[:lower:]-' '[:upper:]_')"
        export "$cv=$CROSS_CC"
    fi

    cd "$WORKSPACE"
    local exit_code=0
    if $USE_ZIGBUILD; then
        cargo zigbuild --target "$TARGET" --workspace --color always 2>&1 || exit_code=$?
    else
        cargo build --target "$TARGET" --workspace --color always 2>&1 || exit_code=$?
    fi
    local elapsed; elapsed=$(($(date +%s) - start_time))

    if [ "$exit_code" -eq 0 ]; then
        echo ""; ok "Build OK (${elapsed}s)"
        local target_dir="$WORKSPACE/target/$TARGET/debug"
        local synced=0

        if [ -d "$WORKSPACE/services" ]; then
            for d in "$WORKSPACE/services"/*/; do
                local name; name=$(basename "$d")
                local bin="$target_dir/$name"
                [ -f "$bin" ] && { cp "$bin" "$BIN_DIR/" 2>/dev/null && synced=$((synced + 1)); }
            done
        fi
        if [ -d "$WORKSPACE/tools" ]; then
            for d in "$WORKSPACE/tools"/*/; do
                local name; name=$(basename "$d")
                local bin="$target_dir/$name"
                [ -f "$bin" ] && { cp "$bin" "$BIN_DIR/" 2>/dev/null && synced=$((synced + 1)); }
            done
        fi

        date +%s > "$TRIGGER_FILE" 2>/dev/null || warn "Failed to write trigger"
        dim "Synced $synced binaries"
        echo "--------------------------------------------------------------"
    else
        echo ""; err "Build FAILED (exit code $exit_code)"
        echo "--------------------------------------------------------------"
    fi
}

show_sccache_stats() {
    if $SCCACHE_AVAILABLE && command -v sccache &>/dev/null; then
        echo ""; echo -e "${C}  sccache stats:${N}"
        sccache --show-stats 2>&1 | while read -r l; do dim "$l"; done
        echo ""
    else
        dim "sccache is not enabled."
    fi
}

toggle_sccache() {
    if $SCCACHE_AVAILABLE; then
        SCCACHE_AVAILABLE=false; unset RUSTC_WRAPPER
        echo -e "${Y}  sccache: OFF${N}"
    else
        if command -v sccache &>/dev/null; then
            SCCACHE_AVAILABLE=true; export RUSTC_WRAPPER=sccache
            echo -e "${G}  sccache: ON${N}"
        else
            warn "sccache not installed"
        fi
    fi
}

# -- File watcher -------------------------------------------------------
WATCH_PID=""
if command -v fswatch &>/dev/null; then
    fswatch -0 -l "$DEBOUNCE_SEC" \
        --include '\.rs$|\.toml$' --exclude '/target/' --exclude '/\.iora-dev/' \
        "$WORKSPACE/services" "$WORKSPACE/shared" "$WORKSPACE/tools" "$WORKSPACE/apps" \
        2>/dev/null | while read -r -d '' _; do build_and_sync; done &
    WATCH_PID=$!
elif command -v inotifywait &>/dev/null; then
    { inotifywait -m -r -q --format '%w%f' \
        --include '\.(rs|toml)$' --exclude '/target/|/\.iora-dev/' \
        "$WORKSPACE/services" "$WORKSPACE/shared" "$WORKSPACE/tools" "$WORKSPACE/apps" \
        2>/dev/null | while read -r _; do build_and_sync; sleep "$DEBOUNCE_SEC"; done; } &
    WATCH_PID=$!
else
    warn "No file watcher found (fswatch/inotify-tools). Polling fallback..."
    { while true; do sleep 3
        if find "$WORKSPACE/services" "$WORKSPACE/shared" "$WORKSPACE/tools" "$WORKSPACE/apps" \
            -name '*.rs' -newer "$TRIGGER_FILE" 2>/dev/null | grep -q .; then build_and_sync; fi
    done; } &
    WATCH_PID=$!
fi

# -- Keyboard loop ------------------------------------------------------
dim "Ready. Press [B] for initial build, [Q] to quit."
trap 'kill $WATCH_PID 2>/dev/null; echo ""; echo "Done. ($BUILD_COUNT builds run)"; exit 0' INT TERM

while true; do
    read -rsn1 -t 0.3 key 2>/dev/null || true
    [ -z "${key:-}" ] && continue
    case "${key,,}" in
        b) build_and_sync ;;
        s) show_sccache_stats ;;
        t) toggle_sccache ;;
        c) rm -rf "$SCCACHE_DIR" 2>/dev/null; ok "sccache cleared"; mkdir -p "$SCCACHE_DIR" ;;
        q) kill "$WATCH_PID" 2>/dev/null; echo ""; echo "Done. ($BUILD_COUNT builds run)"; exit 0 ;;
    esac
done
