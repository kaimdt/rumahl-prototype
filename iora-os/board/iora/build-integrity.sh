#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# build-integrity.sh
#
# Called from the tail of board/iora/post-build.sh.  Responsible for:
#   1. Making sure the release key pair exists (generates a dev key on first
#      run; production builds should drop a real pair into  iora-os/keys/).
#   2. Cross-compiling the Rust binaries  iora-verify  and  iora-updater
#      against the target triple picked by  iora-os/build.sh, and copying
#      them into ${TARGET_DIR}/usr/bin/.
#   3. Running  iora-sign manifest  so that the freshly-installed binaries
#      (plus the critical systemd units) are covered by a signed manifest
#      under  ${TARGET_DIR}/etc/iora/manifest.json.sig.
#
# Required environment:
#   TARGET_DIR        Buildroot rootfs staging directory (arg $1 or env)
#   IORA_ARCH         pc|aarch64|armhf   (defaults: x86_64)
#
# This script exits 0 on success, non-zero on any hard failure.  A missing
# Rust toolchain only triggers a warning so that a plain `make` inside
# Buildroot still finishes.
# -----------------------------------------------------------------------------

set -euo pipefail

TARGET_DIR="${TARGET_DIR:-${1:-}}"
if [ -z "${TARGET_DIR}" ] || [ ! -d "${TARGET_DIR}" ]; then
    echo "[integrity] ERROR: TARGET_DIR not set or not a directory" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IORA_OS_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${IORA_OS_ROOT}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"
KEY_DIR="${IORA_KEYS_DIR:-${IORA_OS_ROOT}/keys}"
PRIV_KEY="${KEY_DIR}/iora-release.key"
PUB_KEY="${KEY_DIR}/iora-release.pub"

IORA_ARCH="${IORA_ARCH:-x86_64}"
case "${IORA_ARCH}" in
    x86_64|pc)         RUST_TRIPLE="x86_64-unknown-linux-gnu" ;;
    aarch64|rpi3|rpi4|rpi5|generic-arm64)
                       RUST_TRIPLE="aarch64-unknown-linux-gnu" ;;
    armhf)             RUST_TRIPLE="armv7-unknown-linux-gnueabihf" ;;
    *)                 RUST_TRIPLE="x86_64-unknown-linux-gnu" ;;
esac

log() { printf '[integrity] %s\n' "$*"; }

# ----- 1. Key pair ----------------------------------------------------------

mkdir -p "${KEY_DIR}"

build_host_tool() {
    local name="$1"
    if ! command -v cargo >/dev/null 2>&1; then
        log "WARNING: cargo not found on build host — skipping ${name}"
        return 1
    fi
    ( cd "${BACKEND_DIR}" && cargo build --release --bin "${name}" -q )
    echo "${BACKEND_DIR}/target/release/${name}"
}

IORA_SIGN_BIN="${IORA_SIGN_BIN:-}"
if [ -z "${IORA_SIGN_BIN}" ]; then
    if IORA_SIGN_BIN="$(build_host_tool iora-sign)"; then
        :
    else
        log "WARNING: cannot build iora-sign — integrity skipped"
        exit 0
    fi
fi

if [ ! -f "${PRIV_KEY}" ] || [ ! -f "${PUB_KEY}" ]; then
    log "generating dev Ed25519 release key pair at ${KEY_DIR}"
    log "  >>> DO NOT USE THIS KEY FOR PRODUCTION IMAGES <<<"
    "${IORA_SIGN_BIN}" keygen --out-dir "${KEY_DIR}" --name iora-release
fi

# ----- 2. Target binaries ---------------------------------------------------

install_target_bin() {
    local name="$1"
    local target_path="${BACKEND_DIR}/target/${RUST_TRIPLE}/release/${name}"
    if [ ! -f "${target_path}" ]; then
        if ! command -v cargo >/dev/null 2>&1; then
            log "WARNING: cargo not found — cannot build ${name} for ${RUST_TRIPLE}"
            return 1
        fi
        # rustup component: ensure target is installed if rustup is around.
        if command -v rustup >/dev/null 2>&1; then
            rustup target add "${RUST_TRIPLE}" >/dev/null 2>&1 || true
        fi
        log "building ${name} for ${RUST_TRIPLE}"
        if ! ( cd "${BACKEND_DIR}" && cargo build --release --target "${RUST_TRIPLE}" --bin "${name}" -q ); then
            log "WARNING: cross-compile of ${name} for ${RUST_TRIPLE} failed (missing linker?)"
            log "         Falling back to host-native binary — image will only work on the build host arch."
            if ! ( cd "${BACKEND_DIR}" && cargo build --release --bin "${name}" -q ); then
                log "ERROR: host-native build of ${name} failed too — see cargo output above"
                return 1
            fi
            target_path="${BACKEND_DIR}/target/release/${name}"
        fi
    fi
    if [ ! -f "${target_path}" ]; then
        log "ERROR: expected binary ${target_path} does not exist after build"
        return 1
    fi
    install -Dm0755 "${target_path}" "${TARGET_DIR}/usr/bin/${name}"
    log "installed /usr/bin/${name}"
}

install_target_bin iora-verify || log "WARNING: iora-verify not installed"
install_target_bin iora-updater || log "WARNING: iora-updater not installed"

# Dev bridge: only on dev images.  Stays absent on production builds so
# that toggling /etc/iora/dev-mode at runtime has no effect — the binary
# is simply not there.
if [ "${IORA_OS_DEV:-0}" = "1" ]; then
    install_target_bin iora-dev-bridge || log "WARNING: iora-dev-bridge not installed"
else
    rm -f "${TARGET_DIR}/usr/bin/iora-dev-bridge" 2>/dev/null || true
fi

# ----- 3. Public key + manifest --------------------------------------------

mkdir -p "${TARGET_DIR}/etc/iora"
install -Dm0644 "${PUB_KEY}" "${TARGET_DIR}/etc/iora/iora-release.pub"

log "generating signed manifest"
IORA_VERSION="${IORA_VERSION:-$(cat "${TARGET_DIR}/etc/iora-version" 2>/dev/null | awk '{print $NF}' || echo dev)}"
export IORA_VERSION
"${IORA_SIGN_BIN}" manifest \
    --root "${TARGET_DIR}" \
    --key  "${PRIV_KEY}" \
    --out  "${TARGET_DIR}/etc/iora/manifest.json"

chmod 0644 "${TARGET_DIR}/etc/iora/manifest.json" \
           "${TARGET_DIR}/etc/iora/manifest.json.sig" \
           "${TARGET_DIR}/etc/iora/iora-release.pub"

log "done"
