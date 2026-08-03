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
    run_apt install $APT_YES "${missing[@]}" || warn "apt-get install failed for: ${missing[*]}"
}

# ── Self-healing apt helpers ──────────────────────────────────────────────
# Fix broken dpkg state (interrupted installs) and wait out stale locks
repair_apt_state() {
    $CHECK_ONLY && return
    log "Checking apt/dpkg health..."
    ${SUDO} dpkg --configure -a >/dev/null 2>&1 || true
    ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y --fix-broken >/dev/null 2>&1 || true
    # Wait out a concurrent apt/dpkg process (e.g. unattended-upgrades)
    if command -v fuser >/dev/null 2>&1; then
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || break
            warn "dpkg is locked by another process – waiting 5s..."
            sleep 5
        done
    fi
}

# Run apt-get with automatic repair + retry (transient mirror/lock hiccups)
run_apt() {
    local attempt=0
    until ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get "$@"; do
        attempt=$((attempt + 1))
        if [ "$attempt" -ge 3 ]; then
            return 1
        fi
        warn "apt-get $* failed (attempt $attempt/3) – repairing and retrying..."
        repair_apt_state
        sleep 5
    done
    return 0
}

apt_updated=false
ensure_apt_update() {
    $CHECK_ONLY && return
    $apt_updated && return
    repair_apt_state
    log "Updating apt index..."
    run_apt update || warn "apt-get update failed – continuing with existing index"
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

    # cargo-binstall installs prebuilt binaries – much faster than cargo install
    if ! command -v cargo-binstall >/dev/null 2>&1; then
        log "Installing cargo-binstall (prebuilt helper installer)..."
        curl -fsSL https://raw.githubusercontent.com/cargo-bins/cargo-binstall/main/install-from-binstall-release.sh 2>/dev/null | bash 2>/dev/null || true
    fi

    for crate in sccache cargo-zigbuild; do
        if command -v "$crate" >/dev/null 2>&1; then
            ok "$crate already installed"
            continue
        fi
        if command -v cargo-binstall >/dev/null 2>&1; then
            log "Installing $crate via cargo-binstall (prebuilt)..."
            if cargo binstall -y "$crate" 2>&1 | tail -1 >/dev/null; then
                ok "$crate installed"
                continue
            fi
        fi
        log "Falling back to 'cargo install --locked $crate' (may take a minute)..."
        cargo install "$crate" --locked 2>&1 | tail -2 || warn "  cargo install $crate failed (skippable)"
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
    if curl -fsSL https://deb.nodesource.com/setup_lts.x | ${SUDO} -E bash -; then
        run_apt install $APT_YES nodejs || warn "NodeSource nodejs install failed"
    else
        warn "NodeSource setup failed – falling back to the distro nodejs package."
        run_apt install $APT_YES nodejs npm || warn "distro nodejs install failed"
    fi
    command -v node >/dev/null 2>&1 && ok "Node.js installed: $(node --version)" || warn "node not on PATH yet – open a new shell."
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
    for attempt in 1 2; do
        curl -fsSL https://get.docker.com | ${SUDO} sh && break
        warn "Docker install failed (attempt $attempt/2) – retrying..."
    done
    if command -v docker >/dev/null 2>&1; then
        # Start the daemon now (systemd or sysvinit)
        ${SUDO} systemctl enable --now docker >/dev/null 2>&1 || ${SUDO} service docker start >/dev/null 2>&1 || true
        if [ -n "${SUDO_USER:-}" ]; then
            ${SUDO} usermod -aG docker "${SUDO_USER}" || true
            warn "Added ${SUDO_USER} to 'docker' group – log out/in to take effect."
        fi
        ok "Docker installed: $(docker --version)"
    else
        warn "Docker install failed – manual: https://docs.docker.com/engine/install/"
    fi
}

# ── KVM access (dev-local.sh uses KVM acceleration when available) ─────────
ensure_kvm_access() {
    [ -e /dev/kvm ] && [ -r /dev/kvm ] && [ -w /dev/kvm ] && return 0

    # No KVM device at all: only bother if the CPU supports virtualization
    if [ ! -e /dev/kvm ]; then
        grep -qwE 'vmx|svm' /proc/cpuinfo 2>/dev/null || return 0
        warn "/dev/kvm missing but CPU supports virtualization – trying to load the module..."
        ${SUDO} modprobe kvm_intel 2>/dev/null || ${SUDO} modprobe kvm_amd 2>/dev/null || \
            warn "Module load failed – enable virtualization in BIOS/EFI (VT-x/AMD-V)."
    fi

    if [ -e /dev/kvm ]; then
        if ! getent group kvm >/dev/null 2>&1; then
            ${SUDO} groupadd -r kvm 2>/dev/null || true
        fi
        local user="${SUDO_USER:-$(id -un)}"
        if ! id -nG "$user" 2>/dev/null | grep -qw kvm; then
            ${SUDO} usermod -aG kvm "$user" 2>/dev/null || true
            warn "Added '$user' to the 'kvm' group – log out/in (or 'newgrp kvm') to use KVM acceleration."
        fi
    fi
}

# ── Zig (snap or automatic official release download) ─────────────────────
ensure_zig() {
    $SKIP_RUST && return
    if command -v zig >/dev/null 2>&1; then
        ok "zig already installed: $(zig version)"
        return
    fi
    $CHECK_ONLY && { warn "  (--check: zig missing – would auto-download from ziglang.org)"; return; }

    # Try snap first (when available)
    if command -v snap >/dev/null 2>&1; then
        ${SUDO} snap install zig --classic --beta 2>/dev/null && { ok "zig installed via snap"; return; }
    fi

    # Automatic download of the latest official release (ziglang.org index.json)
    if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
        log "Downloading the latest official zig release from ziglang.org..."
        local json ver url arch tmp zigdir
        json=$(curl -fsSL --max-time 60 https://ziglang.org/download/index.json 2>/dev/null) || { warn "zig download failed (no network?)"; return 1; }
        # Keys are lexicographically sorted (0.10.0 < 0.2.0) – pick the newest
        # stable version that actually ships a Linux tarball
        ver=$(printf '%s' "$json" | jq -r 'to_entries[] | select(.value["x86_64-linux"] != null) | .key' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
        case "$(uname -m)" in
            aarch64|arm64) arch="aarch64-linux" ;;
            *) arch="x86_64-linux" ;;
        esac
        url=$(printf '%s' "$json" | jq -r --arg v "$ver" --arg a "$arch" '.[$v][$a].tarball')
        if [ -z "$url" ] || [ "$url" = "null" ]; then
            warn "No zig tarball for $arch found – manual: https://ziglang.org/download/"
            return 1
        fi
        tmp=$(mktemp -d)
        if curl -fL --max-time 300 -o "$tmp/zig.tar.xz" "$url"; then
            tar -xJf "$tmp/zig.tar.xz" -C "$tmp" 2>/dev/null || true
            zigdir=$(find "$tmp" -maxdepth 1 -type d -name 'zig-*' | head -1)
            if [ -n "$zigdir" ] && [ -x "$zigdir/zig" ]; then
                ${SUDO} mkdir -p /usr/local/lib
                ${SUDO} rm -rf "/usr/local/lib/$(basename "$zigdir")"
                ${SUDO} mv "$zigdir" /usr/local/lib/
                ${SUDO} ln -sf "/usr/local/lib/$(basename "$zigdir")/zig" /usr/local/bin/zig
                if command -v zig >/dev/null 2>&1; then
                    ok "zig $(zig version) installed from ziglang.org"
                    rm -rf "$tmp"
                    return 0
                fi
            fi
        fi
        rm -rf "$tmp"
        warn "zig download failed – manual: https://ziglang.org/download/"
        return 1
    fi

    warn "zig not auto-installed (no snap/curl/jq). Manual: https://ziglang.org/download/"
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

# ── Post-install recommendations ──────────────────────────────────────────
print_recommendations() {
    echo
    ok "Recommendations:"
    if ! git config --get user.name 2>/dev/null | grep -q . || ! git config --get user.email 2>/dev/null | grep -q .; then
        warn "  git user.name / user.email are not set:"
        warn "    git config --global user.name 'Your Name'"
        warn "    git config --global user.email 'you@example.com'"
    else
        ok "  git identity: $(git config --get user.name) <$(git config --get user.email)>"
    fi
    if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
        ok "  KVM acceleration available - the dev VM will be fast."
    else
        warn "  /dev/kvm not usable - the dev VM will run in slow TCG mode."
    fi
    ok "  Next step: ./dev-local.sh  (starts the IORA dev VM)"
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
        if ! run_apt install $APT_YES "${OPTIONAL_PKGS[@]}" >/dev/null 2>&1; then
            warn "Optional packages skipped (OVA export / RAUC may be unavailable)."
        fi
        ;;
esac

ensure_kvm_access

print_summary
print_recommendations

$CHECK_ONLY && exit 0
ok "Installation complete."
