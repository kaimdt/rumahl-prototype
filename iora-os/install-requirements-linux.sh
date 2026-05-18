#!/usr/bin/env bash
# ============================================================================
# install-requirements-linux.sh – IORA dependency installer (Debian/Ubuntu)
# ============================================================================
# Installs the packages needed for one or more workflows:
#
#   --dev-only      Only the things dev-local.sh / dev-watch.sh need to run
#                   (QEMU + cloud-image-utils + Rust + Node + cross tooling)
#   --build-only    Only the build-host deps (Buildroot, Docker, OVA, RAUC)
#   --full          Both of the above (default)
#   --check         Don't install anything, just print what's missing
#
#   --no-docker     Skip Docker install
#   --no-rust       Skip rustup/cargo install
#   --no-node       Skip Node.js install
#   --yes           Non-interactive (assume "yes" to apt prompts)
#
# This script is idempotent – safe to re-run any time.
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Args ──────────────────────────────────────────────────────────────────
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

if ! command -v apt-get >/dev/null 2>&1; then
    err "This script supports Debian/Ubuntu (apt-get based) systems only."
    exit 1
fi

if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    warn "WSL environment detected – prefer ./install-requirements-wsl.sh"
fi

if [ "${EUID}" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
APT_YES=""
$ASSUME_YES && APT_YES="-y"

# ── Package lists ─────────────────────────────────────────────────────────
COMMON_PKGS=(
    git curl wget ca-certificates gnupg openssh-client rsync jq pkg-config
    build-essential clang
)

DEV_PKGS=(
    qemu-system-x86 qemu-utils
    cloud-image-utils genisoimage
    socat dnsmasq-base bridge-utils
    inotify-tools
    musl-tools
    mold
)

BUILD_PKGS=(
    tar gzip xz-utils cpio unzip bc
    libncurses-dev libssl-dev libelf-dev
    python3 python3-pip
    zip xorriso
    grub-common grub-pc-bin grub-efi-amd64-bin mtools
)

OPTIONAL_PKGS=(virtualbox rauc)

# ── Helpers ───────────────────────────────────────────────────────────────
missing_pkgs() {
    local -n _pkgs=$1
    local out=()
    local p
    for p in "${_pkgs[@]}"; do
        if ! dpkg -s "$p" >/dev/null 2>&1; then out+=("$p"); fi
    done
    printf '%s\n' "${out[@]}"
}

install_pkgs() {
    local -n _pkgs=$1
    local missing
    mapfile -t missing < <(missing_pkgs _pkgs)
    if [ "${#missing[@]}" -eq 0 ]; then
        ok "All packages already installed: ${_pkgs[*]}"
        return 0
    fi
    log "Installing: ${missing[*]}"
    if $CHECK_ONLY; then
        warn "  (--check: would install ${#missing[@]} packages)"
        return 0
    fi
    ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install $APT_YES "${missing[@]}"
}

apt_updated=false
ensure_apt_update() {
    $CHECK_ONLY && return
    $apt_updated && return
    log "Updating apt index..."
    ${SUDO} apt-get update
    apt_updated=true
}

# ── Rust toolchain ────────────────────────────────────────────────────────
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
    # Useful targets for dev VM cross-compilation
    if command -v rustup >/dev/null 2>&1; then
        rustup target add x86_64-unknown-linux-gnu  >/dev/null 2>&1 || true
        rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1 || true
    fi
}

# Optional cargo helpers for the dev loop (best-effort, never fatal)
ensure_cargo_extras() {
    $SKIP_RUST && return
    $CHECK_ONLY && return
    command -v cargo >/dev/null 2>&1 || return
    for crate in sccache cargo-zigbuild; do
        if ! command -v "$crate" >/dev/null 2>&1; then
            log "Installing cargo helper: $crate (background, may take a minute)..."
            cargo install "$crate" --locked 2>&1 | tail -2 || warn "  cargo install $crate failed (skippable)"
        else
            ok "$crate already installed"
        fi
    done
}

# ── Node.js (for frontend builds) ─────────────────────────────────────────
ensure_node() {
    $SKIP_NODE && { log "Skipping Node.js (--no-node)"; return; }
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        ok "Node.js already installed: $(node --version)"
        return
    fi
    log "Installing Node.js LTS via NodeSource..."
    $CHECK_ONLY && { warn "  (--check: would install Node.js)"; return; }
    curl -fsSL https://deb.nodesource.com/setup_lts.x | ${SUDO} -E bash -
    ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install $APT_YES nodejs
    ok "Node.js installed: $(node --version)"
}

# ── Docker (build only) ───────────────────────────────────────────────────
ensure_docker() {
    $SKIP_DOCKER && { log "Skipping Docker (--no-docker)"; return; }
    if command -v docker >/dev/null 2>&1; then
        ok "Docker already installed: $(docker --version)"
        return
    fi
    log "Installing Docker Engine (official convenience script)..."
    $CHECK_ONLY && { warn "  (--check: would install Docker)"; return; }
    curl -fsSL https://get.docker.com | ${SUDO} sh
    if [ -n "${SUDO_USER:-}" ]; then
        ${SUDO} usermod -aG docker "${SUDO_USER}" || true
        warn "Added ${SUDO_USER} to 'docker' group – log out/in to take effect."
    fi
}

# ── Zig (only if cargo-zigbuild can't bootstrap it) ──────────────────────
ensure_zig() {
    $SKIP_RUST && return
    command -v zig >/dev/null 2>&1 && { ok "zig already installed: $(zig version)"; return; }
    $CHECK_ONLY && { warn "  (--check: zig missing – install via 'snap install zig' or download from https://ziglang.org)"; return; }
    if command -v snap >/dev/null 2>&1; then
        ${SUDO} snap install zig --classic --beta 2>/dev/null && { ok "zig installed via snap"; return; }
    fi
    warn "zig not auto-installed (no snap). Manual: https://ziglang.org/download/"
}

# ── Final report ─────────────────────────────────────────────────────────
print_summary() {
    echo
    ok "Done. Summary:"
    for tool in qemu-system-x86_64 cloud-localds genisoimage cargo rustup node npm docker mold inotifywait sccache cargo-zigbuild zig; do
        if command -v "$tool" >/dev/null 2>&1; then
            printf '  %s%-22s%s %s\n' "$G" "$tool" "$N" "$($tool --version 2>/dev/null | head -1 || echo present)"
        else
            printf '  %s%-22s%s missing\n' "$Y" "$tool" "$N"
        fi
    done
}

# ── Main ──────────────────────────────────────────────────────────────────
ensure_apt_update
install_pkgs COMMON_PKGS

case "$MODE" in
    dev|full)
        install_pkgs DEV_PKGS
        ensure_rust
        ensure_zig
        ensure_cargo_extras
        ensure_node
        ;;
esac
case "$MODE" in
    build|full)
        install_pkgs BUILD_PKGS
        ensure_docker
        log "Trying optional packages (VirtualBox, RAUC)..."
        if ! ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install $APT_YES "${OPTIONAL_PKGS[@]}" 2>/dev/null; then
            warn "Optional packages skipped (OVA export / RAUC may be unavailable)."
        fi
        ;;
esac

print_summary

$CHECK_ONLY && exit 0
ok "Installation complete."
