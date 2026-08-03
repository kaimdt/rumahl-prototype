#!/usr/bin/env bash
# ============================================================================
# install-requirements-macos.sh – IORA dependency installer (macOS)
# ============================================================================
# Installs the packages needed for one or more workflows:
#
#   --dev-only      Only the things dev-local.sh / dev-watch.sh need to run
#                   (QEMU + Rust + Node + cross tooling)
#   --build-only    Only the build-host deps (Docker Desktop etc.)
#   --full          Both of the above (default)
#   --check         Don't install anything, just print what's missing
#
#   --no-docker     Skip Docker install
#   --no-rust       Skip rustup/cargo install
#   --no-node       Skip Node.js install
#   --yes           Non-interactive (assume "yes" to all prompts)
#
# The script installs Homebrew automatically if it is missing, uses the
# prebuilt Homebrew formulae for sccache/cargo-zigbuild (much faster than
# `cargo install`) and is idempotent – safe to re-run any time.
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="full"
SKIP_DOCKER=false
SKIP_RUST=false
SKIP_NODE=false
CHECK_ONLY=false
ASSUME_YES=false

usage() {
    sed -n '4,22p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dev-only)    MODE="dev"; shift ;;
        --build-only)  MODE="build"; shift ;;
        --full)        MODE="full"; shift ;;
        --check)       CHECK_ONLY=true; shift ;;
        --no-docker)   SKIP_DOCKER=true; shift ;;
        --no-rust)     SKIP_RUST=true; shift ;;
        --no-node)     SKIP_NODE=true; shift ;;
        --yes|-y)      ASSUME_YES=true; shift ;;
        -h|--help)     usage; exit 0 ;;
        *)             echo "[ERROR] Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

# ── Logging helpers ───────────────────────────────────────────────────────
if [ -t 1 ]; then C=$'\033[0;36m'; G=$'\033[0;32m'; Y=$'\033[1;33m'; R=$'\033[0;31m'; N=$'\033[0m'
else C=''; G=''; Y=''; R=''; N=''; fi
log()  { printf '%s[*]%s %s\n' "$C" "$N" "$*"; }
ok()   { printf '%s[+]%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s[!]%s %s\n' "$Y" "$N" "$*" >&2; }
err()  { printf '%s[X]%s %s\n' "$R" "$N" "$*" >&2; }

if [ "$(uname -s)" != "Darwin" ]; then
    err "This script is for macOS only. Use install-requirements.sh --auto instead."
    exit 1
fi

# ── Homebrew: find or auto-install ────────────────────────────────────────
BREW=""
find_brew() {
    for p in /opt/homebrew/bin/brew /usr/local/bin/brew "$HOME/.homebrew/bin/brew"; do
        [ -x "$p" ] && { BREW="$p"; return 0; }
    done
    return 1
}

# ── Xcode Command Line Tools (required by Homebrew) ────────────────────────
ensure_xcode_clt() {
    if xcode-select -p >/dev/null 2>&1; then
        return 0
    fi
    warn "Xcode Command Line Tools are not installed - Homebrew requires them."
    $CHECK_ONLY && { warn "  (--check: would run 'xcode-select --install')"; return 1; }
    if ! $ASSUME_YES; then
        local ans=""
        if [ -t 0 ] && [ -z "${CI:-}" ]; then
            read -r -t 15 -p "[?] Install Xcode Command Line Tools now? (GUI prompt opens) [y/N] " ans || { echo; ans=""; }
        fi
        case "$ans" in
            y|Y|yes|YES) ;;
            *) warn "Skipped - run 'xcode-select --install' manually, then re-run this script."; return 1 ;;
        esac
    fi
    log "Starting Xcode CLT installation (GUI prompt may appear)..."
    xcode-select --install >/dev/null 2>&1 || true
    for _ in {1..120}; do
        xcode-select -p >/dev/null 2>&1 && { ok "Xcode Command Line Tools ready"; return 0; }
        sleep 5
    done
    warn "Xcode CLT still not ready after ~10 min - check the installer or run 'xcode-select --install'."
    return 1
}

ensure_brew() {
    if find_brew; then
        ok "Homebrew found: $BREW"
        case ":$PATH:" in
            *":$(dirname "$BREW"):"*) ;;
            *) export PATH="$(dirname "$BREW"):$PATH" ;;
        esac
        return 0
    fi
    log "Homebrew not found – installing it now (official installer, needs sudo)..."
    $CHECK_ONLY && { warn "  (--check: would install Homebrew)"; return 1; }
    if ! command -v curl >/dev/null 2>&1; then
        err "curl is required to install Homebrew. Install Xcode Command Line Tools first:"
        err "  xcode-select --install"
        return 1
    fi
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
        err "Homebrew install failed. Manual: https://brew.sh"
        return 1
    }
    find_brew || { err "Homebrew installed but not found."; return 1; }
    # shellcheck disable=SC2155
    export PATH="$(dirname "$BREW"):$PATH"
    ok "Homebrew installed: $BREW"
}

# ── Helpers ───────────────────────────────────────────────────────────────
brew_has() {
    brew list --formula "$1" >/dev/null 2>&1 || brew list --cask "$1" >/dev/null 2>&1
}

# brew_install <name> [extra args e.g. --cask] – retries once, verifies
brew_install() {
    local name="$1"; shift
    if brew_has "$name"; then
        ok "$name already installed"
        return 0
    fi
    if $CHECK_ONLY; then
        warn "  (--check: would install $name)"
        return 1
    fi
    log "Installing $name ..."
    for attempt in 1 2; do
        if brew install "$@" "$name" >"/tmp/iora-brew-${name}.log" 2>&1; then
            ok "$name installed"
            return 0
        fi
        warn "brew install $name failed (attempt $attempt/2) – retrying..."
    done
    err "brew install $name failed. See /tmp/iora-brew-${name}.log"
    return 1
}

BREW_UPDATED=""
ensure_brew_updated() {
    $CHECK_ONLY && return 0
    [ -n "$BREW_UPDATED" ] && return 0
    log "Updating Homebrew..."
    for attempt in 1 2 3; do
        if brew update >/dev/null 2>&1; then
            BREW_UPDATED=1
            return 0
        fi
        warn "brew update failed (attempt $attempt/3) – retrying..."
        sleep 3
    done
    warn "brew update failed – continuing with the existing package index."
    BREW_UPDATED=1
    return 0
}

# ── Toolchain installers ──────────────────────────────────────────────────
ensure_rust() {
    $SKIP_RUST && { log "Skipping Rust (--no-rust)"; return; }
    if command -v rustup >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1; then
        ok "Rust already installed: $(rustc --version 2>/dev/null)"
    else
        log "Installing rustup (stable, minimal profile)..."
        $CHECK_ONLY && { warn "  (--check: would install rustup)"; return; }
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
        # shellcheck disable=SC1091
        . "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
        ok "rustup installed: $(rustc --version 2>/dev/null)"
    fi
    # Targets for cross-compiling the dev VM services
    if command -v rustup >/dev/null 2>&1; then
        rustup target add x86_64-unknown-linux-gnu  >/dev/null 2>&1 || true
        rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1 || true
        rustup target add aarch64-unknown-linux-gnu >/dev/null 2>&1 || true
    fi
}

ensure_cargo_extras() {
    $SKIP_RUST && return
    $CHECK_ONLY && return
    command -v cargo >/dev/null 2>&1 || return
    for crate in sccache cargo-zigbuild; do
        if command -v "$crate" >/dev/null 2>&1; then
            ok "$crate already installed"
            continue
        fi
        # Prefer the prebuilt Homebrew formula – much faster than cargo install
        if brew_install "$crate"; then
            continue
        fi
        log "Falling back to 'cargo install --locked $crate' (may take a few minutes)..."
        cargo install --locked "$crate" 2>&1 | tail -2 || warn "  cargo install $crate failed (skippable)"
    done
}

ensure_node() {
    $SKIP_NODE && { log "Skipping Node.js (--no-node)"; return; }
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        ok "Node.js already installed: $(node --version)"
        return
    fi
    brew_install node
}

ensure_zig() {
    if command -v zig >/dev/null 2>&1; then
        ok "zig already installed: $(zig version)"
        return
    fi
    brew_install zig
}

ensure_docker() {
    $SKIP_DOCKER && { log "Skipping Docker (--no-docker)"; return; }
    if command -v docker >/dev/null 2>&1; then
        ok "Docker already installed: $(docker --version)"
        return
    fi
    if [ "$MODE" = "dev" ]; then
        log "Skipping Docker (dev-only mode)."
        return
    fi
    brew_install docker --cask
    if command -v docker >/dev/null 2>&1; then
        ok "Docker Desktop installed – start the app once to finish setup."
    else
        warn "Docker Desktop installed but not on PATH yet – start it from /Applications once."
    fi
}

# ── Final report ─────────────────────────────────────────────────────────
print_summary() {
    echo
    ok "Done. Summary:"
    for tool in brew qemu-system-x86_64 qemu-system-aarch64 qemu-img socat rustup cargo rustc node npm docker mold fswatch zig sccache cargo-zigbuild; do
        if command -v "$tool" >/dev/null 2>&1; then
            printf '  %s%-22s%s %s\n' "$G" "$tool" "$N" "$($tool --version 2>/dev/null | head -1 || echo present)"
        else
            printf '  %s%-22s%s missing\n' "$Y" "$tool" "$N"
        fi
    done
}

# ── Post-install recommendations ──────────────────────────────────────────
print_recommendations() {
    echo
    ok "Recommendations:"
    if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
        warn "  macOS ships an old Bash ($BASH_VERSION). The scripts still work, but"
        warn "  'brew install bash' provides a modern Bash if you want it."
    fi
    if ! git config --get user.name 2>/dev/null | grep -q . || ! git config --get user.email 2>/dev/null | grep -q .; then
        warn "  git user.name / user.email are not set:"
        warn "    git config --global user.name 'Your Name'"
        warn "    git config --global user.email 'you@example.com'"
    else
        ok "  git identity: $(git config --get user.name) <$(git config --get user.email)>"
    fi
    ok "  Next step: ./dev-local.sh  (starts the IORA dev VM)"
}

# ── Main ──────────────────────────────────────────────────────────────────
ensure_xcode_clt || true
if ! ensure_brew; then
    $CHECK_ONLY && exit 0
    exit 1
fi
ensure_brew_updated

COMMON_FORMULAE=(qemu git curl jq socat mold fswatch)
case "$MODE" in
    dev|full)
        for f in "${COMMON_FORMULAE[@]}"; do
            brew_install "$f" || { $CHECK_ONLY || warn "Optional package skipped: $f"; }
        done
        ensure_rust
        ensure_zig
        ensure_cargo_extras
        ensure_node
        ;;
esac
case "$MODE" in
    build|full)
        ensure_docker
        ;;
esac

print_summary
print_recommendations

$CHECK_ONLY && exit 0
ok "Installation complete. Restart your shell if new tools are not found."
