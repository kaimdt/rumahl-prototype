#!/usr/bin/env bash
# ============================================================================
# IORA OS – unified setup entry point for Linux, WSL and ARM / Raspberry Pi
# ============================================================================
#
# This script replaces the three separate install-requirements-*.sh scripts
# and walks a user through the full toolchain setup + optional image build.
# It auto-detects:
#   - WSL (Windows Subsystem for Linux)
#   - Native Linux (Debian, Ubuntu, Fedora, Arch, openSUSE, Alpine)
#   - Host architecture (x86_64 / aarch64 / armv7l)
#   - Raspberry Pi (via /proc/device-tree/model)
#
# Usage:
#   ./setup.sh                   Interactive, auto-detected
#   ./setup.sh --yes             Non-interactive, safe defaults
#   ./setup.sh --target rpi4     Pre-select build target
#   ./setup.sh --deps-only       Install only the toolchain, no build
#   ./setup.sh --build           Install deps AND start a build
#
# Supported build targets:
#   pc       x86_64 PC (BIOS + UEFI)         [default]
#   rpi3     Raspberry Pi 3 / Zero 2W        (aarch64)
#   rpi4     Raspberry Pi 4 / 400 / CM4      (aarch64)
#   rpi5     Raspberry Pi 5                  (aarch64)
#   generic-arm64   Any ARM64 board          (aarch64)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="pc"
ASSUME_YES=false
MODE="interactive"   # interactive | deps-only | build
HOST_ARCH="$(uname -m 2>/dev/null || echo unknown)"

# ── Colors ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
    R="\033[0;31m"; G="\033[0;32m"; Y="\033[1;33m"; B="\033[0;34m"; C="\033[0;36m"; BOLD="\033[1m"; N="\033[0m"
else
    R=""; G=""; Y=""; B=""; C=""; BOLD=""; N=""
fi
info()  { echo -e "${B}[INFO]${N} $*"; }
ok()    { echo -e "${G}[ OK ]${N} $*"; }
warn()  { echo -e "${Y}[WARN]${N} $*"; }
err()   { echo -e "${R}[ERR ]${N} $*" >&2; }
die()   { err "$*"; exit 1; }

# ── Detection ────────────────────────────────────────────────────────────────
detect_os() {
    OS_ID="unknown"
    OS_LIKE=""
    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_LIKE="${ID_LIKE:-}"
    fi

    IS_WSL=false
    if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
        IS_WSL=true
    fi

    IS_RPI=false
    RPI_MODEL=""
    if [ -r /proc/device-tree/model ]; then
        RPI_MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)
        case "$RPI_MODEL" in
            *"Raspberry Pi"*) IS_RPI=true ;;
        esac
    fi
}

pkg_manager() {
    # Returns one of: apt | dnf | pacman | zypper | apk | none
    case "$OS_ID $OS_LIKE" in
        *debian*|*ubuntu*|*raspbian*) echo apt ;;
        *fedora*|*rhel*|*centos*)     echo dnf ;;
        *arch*|*manjaro*)             echo pacman ;;
        *suse*|*opensuse*)            echo zypper ;;
        *alpine*)                     echo apk ;;
        *)
            if command -v apt-get >/dev/null 2>&1; then echo apt
            elif command -v dnf    >/dev/null 2>&1; then echo dnf
            elif command -v pacman >/dev/null 2>&1; then echo pacman
            elif command -v zypper >/dev/null 2>&1; then echo zypper
            elif command -v apk    >/dev/null 2>&1; then echo apk
            else echo none; fi
            ;;
    esac
}

SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    SUDO="sudo"
fi

ask_yn() {
    local prompt="$1"
    local default="${2:-y}"
    local suffix
    case "$default" in
        y|Y) suffix=" [Y/n]" ;;
        n|N) suffix=" [y/N]" ;;
        *)   suffix=" [y/n]" ;;
    esac
    if [ "$ASSUME_YES" = true ]; then
        [ "$default" = y ] && return 0 || return 1
    fi
    local ans
    read -rp "$(echo -e "${BOLD}${prompt}${suffix}:${N} ")" ans || ans=""
    [ -z "$ans" ] && ans="$default"
    case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ── Args ────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        --target|-t)   TARGET="${2:-pc}"; shift 2 ;;
        --yes|-y)      ASSUME_YES=true; shift ;;
        --deps-only)   MODE="deps-only"; shift ;;
        --build)       MODE="build"; shift ;;
        -h|--help)
            sed -n '2,30p' "$0"
            exit 0
            ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

# ── Banner ──────────────────────────────────────────────────────────────────
detect_os
PM=$(pkg_manager)
echo -e "${C}${BOLD}"
cat <<'BANNER'
  ___ ___  ____    _      ___  ____
 |_ _/ _ \|  _ \  / \    / _ \/ ___|
  | | | | | |_) |/ _ \  | | | \___ \
  | | |_| |  _ </ ___ \ | |_| |___) |
 |___\___/|_| \_/_/   \_\ \___/|____/
BANNER
echo -e "${N}"
info "Host arch:     ${HOST_ARCH}"
info "OS:            ${OS_ID} (package manager: ${PM})"
info "WSL:           ${IS_WSL}"
info "Raspberry Pi:  ${IS_RPI}${RPI_MODEL:+ (${RPI_MODEL})}"
info "Build target:  ${TARGET}"
echo

if [ "$PM" = "none" ]; then
    die "Could not detect a supported package manager. Install deps manually and re-run with --deps-only=skipped."
fi

# ── Package lists per target + distro ───────────────────────────────────────

# Common packages needed on every host (any target).
# musl-tools is required for the musl-static cargo fallback that build-all-images.sh
# uses when host glibc >= 2.39 (target glibc is 2.38) — without it crates with C
# dependencies fail to link with `cc: error: unrecognized command-line option`.
COMMON_APT=(build-essential git wget curl tar gzip xz-utils cpio unzip rsync bc
            libncurses-dev libssl-dev libelf-dev python3 python3-pip pkg-config
            ca-certificates file jq musl-tools nodejs npm ccache sccache mold)

# Extra packages when building PC-class x86 images.
PC_APT=(qemu-utils zip xorriso grub-common grub-pc-bin grub-efi-amd64-bin mtools dosfstools parted)

# Cross-compile tools for ARM / Raspberry Pi builds from an x86 host.
ARM_CROSS_APT=(gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
               gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf
               device-tree-compiler u-boot-tools)

# Tools useful to flash SD cards / USB sticks.
FLASH_APT=(dosfstools parted)

# Optional goodies
OPT_APT=(virtualbox rauc)

# Generic mapping for non-apt systems – best-effort naming.
COMMON_DNF=(make gcc gcc-c++ git wget curl tar gzip xz cpio unzip rsync bc
            ncurses-devel openssl-devel elfutils-libelf-devel python3 python3-pip
            pkgconf-pkg-config ca-certificates file jq musl-gcc)
PC_DNF=(qemu-img-utils zip xorriso grub2-tools grub2-efi-x64 mtools dosfstools parted)
ARM_DNF=(gcc-aarch64-linux-gnu gcc-arm-linux-gnu dtc uboot-tools)

COMMON_PACMAN=(base-devel git wget curl tar gzip xz cpio unzip rsync bc ncurses
               openssl libelf python python-pip pkgconf ca-certificates file jq musl)
PC_PACMAN=(qemu-base zip xorriso grub mtools dosfstools parted)
ARM_PACMAN=(aarch64-linux-gnu-gcc arm-none-eabi-gcc dtc uboot-tools)

COMMON_ZYPPER=(gcc gcc-c++ make git wget curl tar gzip xz cpio unzip rsync bc
               ncurses-devel libopenssl-devel libelf-devel python3 python3-pip
               pkg-config ca-certificates file jq)
PC_ZYPPER=(qemu-tools zip xorriso grub2 mtools dosfstools parted)
ARM_ZYPPER=(cross-aarch64-gcc13 cross-arm-none-gcc13 dtc u-boot-tools)

COMMON_APK=(build-base git wget curl tar gzip xz cpio unzip rsync bc
            ncurses-dev openssl-dev elfutils-dev python3 py3-pip pkgconf
            ca-certificates file jq bash)
PC_APK=(qemu-img zip xorriso grub grub-efi mtools dosfstools parted)
ARM_APK=(gcc-aarch64-none-elf dtc uboot-tools)

install_pkgs_apt() {
    info "Running apt-get update..."
    $SUDO apt-get update -qq
    info "Installing: $*"
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}
install_pkgs_dnf()    { $SUDO dnf install -y "$@"; }
install_pkgs_pacman() { $SUDO pacman -Sy --noconfirm --needed "$@"; }
install_pkgs_zypper() { $SUDO zypper --non-interactive install "$@"; }
install_pkgs_apk()    { $SUDO apk add --no-cache "$@"; }

install_pkgs() {
    case "$PM" in
        apt)    install_pkgs_apt    "$@" ;;
        dnf)    install_pkgs_dnf    "$@" ;;
        pacman) install_pkgs_pacman "$@" ;;
        zypper) install_pkgs_zypper "$@" ;;
        apk)    install_pkgs_apk    "$@" ;;
    esac
}

select_packages() {
    NEED_ARM=false
    case "$TARGET" in
        pc) ;;
        rpi3|rpi4|rpi5|generic-arm64) NEED_ARM=true ;;
        *) die "Unknown --target: $TARGET" ;;
    esac

    case "$PM" in
        apt)
            PKGS=("${COMMON_APT[@]}")
            [ "$TARGET" = pc ] && PKGS+=("${PC_APT[@]}")
            [ "$NEED_ARM" = true ] && PKGS+=("${ARM_CROSS_APT[@]}")
            PKGS+=("${FLASH_APT[@]}")
            ;;
        dnf)
            PKGS=("${COMMON_DNF[@]}")
            [ "$TARGET" = pc ] && PKGS+=("${PC_DNF[@]}")
            [ "$NEED_ARM" = true ] && PKGS+=("${ARM_DNF[@]}")
            ;;
        pacman)
            PKGS=("${COMMON_PACMAN[@]}")
            [ "$TARGET" = pc ] && PKGS+=("${PC_PACMAN[@]}")
            [ "$NEED_ARM" = true ] && PKGS+=("${ARM_PACMAN[@]}")
            ;;
        zypper)
            PKGS=("${COMMON_ZYPPER[@]}")
            [ "$TARGET" = pc ] && PKGS+=("${PC_ZYPPER[@]}")
            [ "$NEED_ARM" = true ] && PKGS+=("${ARM_ZYPPER[@]}")
            ;;
        apk)
            PKGS=("${COMMON_APK[@]}")
            [ "$TARGET" = pc ] && PKGS+=("${PC_APK[@]}")
            [ "$NEED_ARM" = true ] && PKGS+=("${ARM_APK[@]}")
            ;;
    esac
}

# ── WSL-specific tweaks ─────────────────────────────────────────────────────
wsl_tweaks() {
    [ "$IS_WSL" = true ] || return 0
    # systemd is optional in WSL.  Remind the user that virtualbox / RAUC
    # bundle creation is skipped because those need a full VM host.
    warn "Detected WSL – skipping VirtualBox / RAUC bundle deps (not supported on WSL)."
    # Ensure metadata so chmod etc. is preserved on /mnt/*.
    if [ -r /etc/wsl.conf ]; then
        if ! grep -q "^\[automount\]" /etc/wsl.conf; then
            warn "/etc/wsl.conf has no [automount] section – file permissions on /mnt/* may not be preserved."
        fi
    fi
}

# ── Docker Engine installation ───────────────────────────────────────────────
# Docker is required on the build host for build-all-images.sh which runs
# `docker build` to pre-compile IORA service binaries (Go/Rust) that are
# embedded into the OS image.  Without Docker on the host the service
# binaries are skipped and iora-build-images.service on the device has
# nothing to build from.
install_docker() {
    if command -v docker >/dev/null 2>&1; then
        ok "Docker already installed: $(docker --version)"
        return 0
    fi

    info "Docker Engine not found – installing..."

    case "$PM" in
        apt)
            # Official Docker convenience script works on Debian/Ubuntu/Raspbian.
            if [ "$IS_WSL" = true ]; then
                info "WSL detected – installing native Docker Engine."
                info "(Alternatively install Docker Desktop for Windows with WSL2 integration.)"
            fi
            if command -v curl >/dev/null 2>&1; then
                curl -fsSL https://get.docker.com | $SUDO sh
            else
                $SUDO apt-get update -qq
                $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y \
                    ca-certificates curl gnupg lsb-release
                install_docker_apt_repo
            fi
            ;;
        dnf)
            $SUDO dnf -y install dnf-plugins-core
            $SUDO dnf config-manager --add-repo \
                https://download.docker.com/linux/fedora/docker-ce.repo \
                2>/dev/null || true
            $SUDO dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            $SUDO systemctl enable --now docker
            ;;
        pacman)
            $SUDO pacman -Sy --noconfirm --needed docker docker-buildx docker-compose
            $SUDO systemctl enable --now docker
            ;;
        zypper)
            $SUDO zypper --non-interactive install docker docker-compose
            $SUDO systemctl enable --now docker
            ;;
        apk)
            $SUDO apk add --no-cache docker docker-compose
            $SUDO rc-update add docker boot 2>/dev/null || true
            $SUDO service docker start 2>/dev/null || true
            ;;
        *)
            warn "Cannot install Docker automatically for package manager: $PM"
            warn "Please install Docker Engine manually: https://docs.docker.com/engine/install/"
            return 0
            ;;
    esac

    # Add the invoking user to the docker group so they can run docker without sudo.
    local real_user="${SUDO_USER:-${USER:-}}"
    if [ -n "$real_user" ] && [ "$real_user" != root ]; then
        $SUDO usermod -aG docker "$real_user" 2>/dev/null || true
        warn "Added '${real_user}' to the docker group."
        warn "Log out and back in (or run 'newgrp docker') for the change to take effect."
    fi

    ok "Docker installed: $(docker --version 2>/dev/null || true)"
}

# ── Rust toolchain installation ──────────────────────────────────────────────
# Required to build the native IORA service binaries (iora-core, iora-home, …)
# that are embedded into the rootfs overlay by build-all-images.sh.
# Without Rust on the host, the binaries are missing and every native IORA
# service on the device stays inactive (ConditionPathExists fails silently).
install_rust() {
    # Already installed via the system package manager?
    if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
        ok "Rust already installed: $(rustc --version 2>/dev/null)"
        return 0
    fi

    # rustup binary exists (e.g. from a prior run) but cargo isn't on PATH?
    # Source the env script and re-check.
    local real_user="${SUDO_USER:-${USER:-}}"
    local user_home
    if [ -n "$real_user" ] && [ "$real_user" != root ]; then
        user_home="$(getent passwd "$real_user" | cut -d: -f6)"
    else
        user_home="${HOME:-/root}"
    fi
    if [ -f "${user_home}/.cargo/env" ]; then
        # shellcheck disable=SC1091
        . "${user_home}/.cargo/env"
        if command -v cargo >/dev/null 2>&1; then
            ok "Rust already installed (via rustup): $(rustc --version 2>/dev/null || echo 'version unknown')"
            # Make sure the current shell PATH contains cargo for the remainder
            # of this script (so build-all-images.sh picks it up).
            export PATH="${user_home}/.cargo/bin:$PATH"
            # A rustup install without a default toolchain errors out on
            # every cargo invocation ("could not choose a version of cargo
            # to run"). Always set stable — idempotent on existing installs.
            if command -v rustup >/dev/null 2>&1; then
                info "Ensuring rustup default toolchain is 'stable'…"
                if [ -n "$real_user" ] && [ "$real_user" != root ] && command -v sudo >/dev/null 2>&1; then
                    sudo -u "$real_user" rustup default stable || \
                        warn "rustup default stable failed — run it manually as $real_user"
                    if [ "${HOST_ARCH}" = "x86_64" ]; then
                        sudo -u "$real_user" rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1 || true
                    fi
                else
                    rustup default stable || \
                        warn "rustup default stable failed — run it manually"
                    if [ "${HOST_ARCH}" = "x86_64" ]; then
                        rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1 || true
                    fi
                fi
            fi
            return 0
        fi
    fi

    info "Rust toolchain not found — installing via rustup (non-interactive)..."

    # Prefer distro package when it's recent enough (Debian 12 / Ubuntu 24.04+).
    # Older distros ship rust 1.63 or older — too old for modern IORA deps —
    # so we always fall back to rustup which pins a known-good stable channel.
    case "$PM" in
        apt)
            # We still install curl + ca-certificates so the rustup bootstrap works.
            $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
                curl ca-certificates gcc build-essential >/dev/null 2>&1 || true
            ;;
        dnf)    $SUDO dnf install -y curl ca-certificates gcc make >/dev/null 2>&1 || true ;;
        pacman) $SUDO pacman -Sy --noconfirm --needed curl ca-certificates gcc make >/dev/null 2>&1 || true ;;
        zypper) $SUDO zypper --non-interactive install curl ca-certificates gcc make >/dev/null 2>&1 || true ;;
        apk)    $SUDO apk add --no-cache curl ca-certificates gcc musl-dev make >/dev/null 2>&1 || true ;;
    esac

    if ! command -v curl >/dev/null 2>&1; then
        warn "curl not available — cannot bootstrap rustup."
        warn "Install rustc + cargo manually: https://rustup.rs"
        return 1
    fi

    local RUSTUP_URL="https://sh.rustup.rs"
    local RUSTUP_ARGS="-y --default-toolchain stable --profile minimal --no-modify-path"

    # Run rustup as the invoking (non-root) user so binaries land in ~/.cargo
    # and are owned by that user. Passing `-y` to the installer makes it fully
    # unattended — no prompts, no "Press Enter" step.
    if [ -n "$real_user" ] && [ "$real_user" != root ] && command -v sudo >/dev/null 2>&1; then
        # shellcheck disable=SC2016
        sudo -u "$real_user" bash -c \
            "curl --proto '=https' --tlsv1.2 -sSf '$RUSTUP_URL' | sh -s -- $RUSTUP_ARGS"
    else
        curl --proto '=https' --tlsv1.2 -sSf "$RUSTUP_URL" | sh -s -- $RUSTUP_ARGS
    fi

    # Source the freshly-installed toolchain for the rest of this script.
    if [ -f "${user_home}/.cargo/env" ]; then
        # shellcheck disable=SC1091
        . "${user_home}/.cargo/env"
        export PATH="${user_home}/.cargo/bin:$PATH"
    fi

    if command -v cargo >/dev/null 2>&1; then
        ok "Rust installed: $(rustc --version 2>/dev/null)"

        # Best-effort: install the x86_64 target explicitly (no-op on x86_64
        # hosts, required for cross-builds from ARM). Errors are non-fatal.
        rustup target add x86_64-unknown-linux-gnu >/dev/null 2>&1 || true
        # Also install the musl target so build-all-images.sh can fall back
        # to a statically-linked build when the host glibc is newer than the
        # target glibc (Buildroot 2024.02 = glibc 2.38).
        if [ "${HOST_ARCH}" = "x86_64" ]; then
            if [ -n "$real_user" ] && [ "$real_user" != root ] && command -v sudo >/dev/null 2>&1; then
                sudo -u "$real_user" rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1 || true
            else
                rustup target add x86_64-unknown-linux-musl >/dev/null 2>&1 || true
            fi
        fi
    else
        warn "Rust installation completed but cargo is not on PATH."
        warn "Open a new shell (or run: source \"${user_home}/.cargo/env\") and retry."
        return 1
    fi
}

# ── Main flow ───────────────────────────────────────────────────────────────

select_packages
wsl_tweaks

info "Will install ${#PKGS[@]} packages via ${PM} for target '${TARGET}'."
# Non-interactive by design: the user ran setup.sh to set up the build host,
# so we don't ask for permission to install the very packages they requested.
# Pass --yes explicitly (or set IORA_SETUP_CONFIRM=1) to restore the prompt.
if [ "${IORA_SETUP_CONFIRM:-0}" = "1" ]; then
    if ! ask_yn "Proceed with installation?" y; then
        die "Aborted by user."
    fi
fi

install_pkgs "${PKGS[@]}" || die "Package installation failed."

# Best-effort: also install optional packages (don't fail on errors).
# Skip the interactive prompt by default in --yes mode.
if [ "$PM" = apt ] && [ "$IS_WSL" = false ] && [ "$TARGET" = pc ]; then
    if [ "${ASSUME_YES}" = true ] || ask_yn "Install optional VirtualBox/RAUC support?" n; then
        $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "${OPT_APT[@]}" \
            || warn "Optional packages failed – OVA export / RAUC bundle may be skipped."
    fi
fi

ok "Toolchain installation completed."

# ── Docker ───────────────────────────────────────────────────────────────────
install_docker || warn "Docker installation failed – run 'install_docker' manually or install Docker from https://docs.docker.com/engine/install/"

# ── Rust ─────────────────────────────────────────────────────────────────────
# Rust is required by build-all-images.sh :: build_service_binaries() to
# compile the native IORA service binaries. Without this, the IORA OS image
# boots but all iora-* services stay inactive.
install_rust || warn "Rust installation failed – native IORA services will NOT be built into the image."

# Persist detected target so build.sh picks it up by default.
CONFIG_FILE="${SCRIPT_DIR}/.setup-target"
echo "$TARGET" > "$CONFIG_FILE"
ok "Build target saved to $(basename "$CONFIG_FILE")."

# ── Build step ──────────────────────────────────────────────────────────────
if [ "$MODE" = "deps-only" ]; then
    info "Skipping build (--deps-only). Run ./build.sh --target ${TARGET} when you are ready."
    exit 0
fi

if [ "$MODE" = "build" ] || ask_yn "Build an IORA OS image for target '${TARGET}' now?" n; then
    info "Starting build (this can take 30-90 minutes)..."
    if [ -x "${SCRIPT_DIR}/build.sh" ]; then
        "${SCRIPT_DIR}/build.sh" all --target "${TARGET}" \
            ${ASSUME_YES:+--unattended} \
            --progress
    else
        die "build.sh not found or not executable."
    fi
fi

ok "Setup complete. Next steps:"
cat <<EOF

   • Build images:     ${SCRIPT_DIR}/build.sh all --target ${TARGET} --progress
   • Flash to SD/USB:  sudo xzcat <image>.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
   • Network install:  curl -sSL https://dist.kaimdt.com/v1/iora/netinstall.sh | sudo bash

   Happy hacking!
EOF
