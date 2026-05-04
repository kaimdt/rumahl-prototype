#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/buildroot-2024.02"
SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
LOG_DIR="${SCRIPT_DIR}/releases/logs"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

normalize_shell_scripts() {
    # Keep all project shell scripts executable and with LF endings.
    find "${SCRIPT_DIR}" \
        -path "${SCRIPT_DIR}/buildroot-*" -prune -o \
        -type f -name "*.sh" -print0 | while IFS= read -r -d '' file; do
        sed -i 's/\r$//' "${file}" || true
        chmod +x "${file}" || true
    done
}

usage() {
    cat <<EOF
Resume/Continue Build for IORA OS

Usage: $(basename "$0") [OPTIONS]

OPTIONS:
    --progress          Show a live progress bar (indeterminate, step-based)
    --clean-glibc       Clean glibc build directory before resuming
    --clean-linux       Clean kernel build directory before resuming
    --reconfigure       Re-run iora_defconfig before resuming
    --force-full-image  Require full GPT/loop/grub post-image flow (fail if unavailable)
    --allow-fallback    Allow post-image fallback to rootfs.ext2 (default)
    --force-fallback-image Always use rootfs.ext2 fallback for iora-os.img
    --with-images       After successful resume, generate release image formats
    --unattended        Forward non-interactive mode to image generation
    --jobs N            Override parallel jobs (default: nproc)
    --log FILE          Write build log to custom file path
    -h, --help          Show this help

Examples:
    $(basename "$0")
    $(basename "$0") --progress
    $(basename "$0") --clean-glibc --progress
    $(basename "$0") --reconfigure --clean-linux --progress
EOF
}

show_progress_stream() {
    awk '
    BEGIN { step=0; width=28 }
    {
        print $0
        if ($0 ~ /^>>> /) {
            step++
            label=$0
            sub(/^>>> /, "", label)

            pos = step % width
            bar = ""
            for (i=0; i<width; i++) {
                if (i == pos) {
                    bar = bar ">"
                } else {
                    bar = bar "="
                }
            }

            printf "\r[%s] steps:%4d | %s", bar, step, label > "/dev/stderr"
            fflush("/dev/stderr")
        }
    }
    END {
        if (step > 0) {
            printf "\n" > "/dev/stderr"
        }
    }'
}

# ── GCC 15 compatibility fixes ──────────────────────────────────────────────
patch_host_cmake_gcc15() {
    local cmake_src="${BUILD_DIR}/output/build/host-cmake-3.28.1"
    [ -d "${cmake_src}" ] || return 0

    local patched_marker="${cmake_src}/.iora-gcc15-patched"
    [ -f "${patched_marker}" ] && return 0

    local network_h="${cmake_src}/Utilities/cmcppdap/include/dap/network.h"
    local socket_h="${cmake_src}/Utilities/cmcppdap/src/socket.h"

    if [ -f "${network_h}" ]; then
        if ! grep -q '<cstdint>' "${network_h}" 2>/dev/null; then
            log_info "Patching host-cmake: adding #include <cstdint> to network.h (GCC 15 compat)"
            sed -i '/^#include <functional>/i #include <cstdint>' "${network_h}"
        fi
    fi
    if [ -f "${socket_h}" ]; then
        if ! grep -q '<cstdint>' "${socket_h}" 2>/dev/null; then
            log_info "Patching host-cmake: adding #include <cstdint> to socket.h (GCC 15 compat)"
            sed -i '/^#include "dap\/io.h"/a #include <cstdint>' "${socket_h}"
        fi
    fi

    touch "${patched_marker}"
}

patch_host_m4_gcc15() {
    local m4_src="${BUILD_DIR}/output/build/host-m4-1.4.19"
    [ -d "${m4_src}" ] || return 0
    local marker="${m4_src}/.iora-gcc15-patched"
    [ -f "${marker}" ] && return 0
    for f in "${m4_src}/lib/gl_oset.h" "${m4_src}/lib/gl_list.h"; do
        if [ -f "$f" ] && grep -q 'INLINE _GL_ATTRIBUTE_NODISCARD' "$f" 2>/dev/null; then
            log_info "Patching host-m4: removing _GL_ATTRIBUTE_NODISCARD from inline fns"
            sed -i 's/\(GL_.*INLINE\) _GL_ATTRIBUTE_NODISCARD/\1/' "$f"
        fi
    done
    touch "${marker}"
}

patch_host_gawk_gcc15() {
    local gawk_src="${BUILD_DIR}/output/build/host-gawk-5.3.0"
    [ -d "${gawk_src}" ] || return 0
    local marker="${gawk_src}/.iora-gcc15-patched"
    [ -f "${marker}" ] && return 0
    local io_c="${gawk_src}/io.c"
    if [ -f "${io_c}" ] && grep -q 'ssize_t(\*)()' "${io_c}" 2>/dev/null; then
        log_info "Patching host-gawk: fixing ssize_t(*)() casts (C23 compat)"
        sed -i 's/( ssize_t(\*)() ) read/( ssize_t(*)(int, void *, size_t) ) read/g' "${io_c}"
    fi
    touch "${marker}"
}

# ── IORA: Buildroot host-compile include path fix ────────────────────────────
patch_buildroot_makefile_in() {
    local mk_in="${BUILD_DIR}/package/Makefile.in"
    [ -f "${mk_in}" ] || return 0
    grep -q '^override HOST_CFLAGS   +=' "${mk_in}" 2>/dev/null && return 0
    log_info "Patching Buildroot Makefile.in: adding 'override' to HOST_CFLAGS/CXXFLAGS/LDFLAGS +="
    sed -i 's/^HOST_CFLAGS   += /override HOST_CFLAGS   += /' "${mk_in}"
    sed -i 's/^HOST_CXXFLAGS += /override HOST_CXXFLAGS += /' "${mk_in}"
    sed -i 's/^HOST_LDFLAGS  += /override HOST_LDFLAGS  += /' "${mk_in}"
    log_success "Buildroot Makefile.in override patch applied"
}

# ── IORA: System Go bootstrap ───────────────────────────────────────────────
ensure_host_go() {
    local marker="${BUILD_DIR}/.iora-go-staged"
    [ -f "${marker}" ] && return 0
    local need_install=0
    if ! command -v go >/dev/null 2>&1; then
        need_install=1
    else
        local gover
        gover=$(go version 2>/dev/null | grep -oP 'go\K[0-9]+\.[0-9]+' | head -1 || echo "0.0")
        if ! awk -v v="${gover}" 'BEGIN{exit !(v+0 >= 1.19)}'; then
            need_install=1
        fi
    fi
    if [ "${need_install}" = "1" ]; then
        log_info "Installing golang-go (Go 1.4 C build incompatible with GCC 15+)"
        if command -v apt-get >/dev/null 2>&1; then
            if [ "$(id -u)" = "0" ]; then
                apt-get update -qq >/dev/null 2>&1 || true
                apt-get install -y --no-install-recommends golang-go >/tmp/iora-go-install.log 2>&1 || true
            elif command -v sudo >/dev/null 2>&1; then
                sudo apt-get update -qq >/dev/null 2>&1 || true
                sudo apt-get install -y --no-install-recommends golang-go >/tmp/iora-go-install.log 2>&1 || true
            fi
        elif command -v brew >/dev/null 2>&1; then
            brew install go >/tmp/iora-go-install.log 2>&1 || true
        fi
    fi
    local gover
    gover=$(go version 2>/dev/null | grep -oP 'go\K[0-9]+\.[0-9]+' | head -1 || echo "N/A")
    log_info "Host Go ${gover} available for bootstrap"
    touch "${marker}"
}

patch_go_bootstrap_mk() {
    local mk_file="${BUILD_DIR}/package/go-bootstrap-stage1/go-bootstrap-stage1.mk"
    [ -f "${mk_file}" ] || return 0
    grep -q 'SYSGO=\' "${mk_file}" 2>/dev/null && return 0
    log_info "Patching go-bootstrap-stage1.mk: replacing C build/install with system Go copy"
    cat > "${mk_file}" << 'IORAGOMKPATCH'
################################################################################
#
# go-bootstrap-stage1
#
################################################################################

# Use last C-based Go compiler: v1.4.x
# See https://golang.org/doc/install/source#bootstrapFromSource
GO_BOOTSTRAP_STAGE1_VERSION = 1.4-bootstrap-20171003
GO_BOOTSTRAP_STAGE1_SITE = https://dl.google.com/go
GO_BOOTSTRAP_STAGE1_SOURCE = go$(GO_BOOTSTRAP_STAGE1_VERSION).tar.gz

GO_BOOTSTRAP_STAGE1_LICENSE = BSD-3-Clause
GO_BOOTSTRAP_STAGE1_LICENSE_FILES = LICENSE

HOST_GO_BOOTSTRAP_STAGE1_ROOT = $(HOST_DIR)/lib/go-$(GO_BOOTSTRAP_STAGE1_VERSION)

# The go build system is not compatible with ccache, so use
# HOSTCC_NOCCACHE. See https://github.com/golang/go/issues/11685.
HOST_GO_BOOTSTRAP_STAGE1_MAKE_ENV = \
	GOOS=linux \
	GOROOT_FINAL="$(HOST_GO_BOOTSTRAP_STAGE1_ROOT)" \
	GOROOT="$(@D)" \
	GOBIN="$(@D)/bin" \
	CC=$(HOSTCC_NOCCACHE) \
	CGO_ENABLED=0

# IORA: Skip the ancient C compilation; use host system Go.
define HOST_GO_BOOTSTRAP_STAGE1_BUILD_CMDS
	@echo "IORA: Go bootstrap stage1 provided by host system Go"
endef

# IORA: Install host system Go instead of C-built Go 1.4.
# Requires golang-go >= 1.19 on the build host (installed by build script).
define HOST_GO_BOOTSTRAP_STAGE1_INSTALL_CMDS
	@echo "IORA: Installing system Go as Go bootstrap stage1"
	@SYSGO=$$(command -v go 2>/dev/null || echo ""); \
	if [ -z "$${SYSGO}" ] || [ ! -x "$${SYSGO}" ]; then \
		echo "ERROR: host system Go not found — install golang-go first"; \
		echo "       sudo apt-get install -y golang-go"; \
		exit 1; \
	fi; \
	SYS_GOROOT=$$(go env GOROOT 2>/dev/null || echo ""); \
	mkdir -p $(HOST_GO_BOOTSTRAP_STAGE1_ROOT)/bin; \
	cp "$$(command -v go)" $(HOST_GO_BOOTSTRAP_STAGE1_ROOT)/bin/go; \
	if command -v gofmt >/dev/null 2>&1; then \
		cp "$$(command -v gofmt)" $(HOST_GO_BOOTSTRAP_STAGE1_ROOT)/bin/gofmt; \
	fi; \
	for sub in pkg src lib; do \
		[ -d "$${SYS_GOROOT}/$${sub}" ] && cp -rL "$${SYS_GOROOT}/$${sub}" $(HOST_GO_BOOTSTRAP_STAGE1_ROOT)/ 2>/dev/null || true; \
	done
endef

$(eval $(host-generic-package))
IORAGOMKPATCH
    log_success "go-bootstrap-stage1.mk patched"
}

check_prereqs() {
    if [ ! -d "${BUILD_DIR}" ]; then
        log_error "Buildroot directory not found: ${BUILD_DIR}"
        log_info "Run ./build.sh all once to download and extract Buildroot."
        exit 1
    fi

    for f in external.desc external.mk Config.in configs/iora_defconfig; do
        if [ ! -f "${SCRIPT_DIR}/${f}" ]; then
            log_error "Missing required file: ${SCRIPT_DIR}/${f}"
            exit 1
        fi
    done
}

PROGRESS=false
CLEAN_GLIBC=false
CLEAN_LINUX=false
RECONFIGURE=false
JOBS="$(nproc)"
LOG_FILE=""
POST_IMAGE_MODE="auto"
WITH_IMAGES=false
UNATTENDED=false

while [ $# -gt 0 ]; do
    case "$1" in
        --progress)
            PROGRESS=true
            ;;
        --clean-glibc)
            CLEAN_GLIBC=true
            ;;
        --clean-linux)
            CLEAN_LINUX=true
            ;;
        --reconfigure)
            RECONFIGURE=true
            ;;
        --jobs)
            shift
            JOBS="${1:-}"
            if [ -z "${JOBS}" ]; then
                log_error "--jobs requires a numeric value"
                exit 1
            fi
            ;;
        --force-full-image)
            POST_IMAGE_MODE="full"
            ;;
        --allow-fallback)
            POST_IMAGE_MODE="auto"
            ;;
        --force-fallback-image)
            POST_IMAGE_MODE="fallback"
            ;;
        --with-images)
            WITH_IMAGES=true
            ;;
        --unattended|--non-interactive|--unattachment)
            UNATTENDED=true
            ;;
        --log)
            shift
            LOG_FILE="${1:-}"
            if [ -z "${LOG_FILE}" ]; then
                log_error "--log requires a file path"
                exit 1
            fi
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
    shift
done

check_prereqs
normalize_shell_scripts

mkdir -p "${LOG_DIR}"
if [ -z "${LOG_FILE}" ]; then
    LOG_FILE="${LOG_DIR}/resume-$(date +%Y%m%d-%H%M%S).log"
fi

log_info "Resuming build in ${BUILD_DIR}"
log_info "Log file: ${LOG_FILE}"
log_info "Jobs: ${JOBS}"
log_info "Post-image mode: ${POST_IMAGE_MODE}"
log_info "Generate release images after resume: ${WITH_IMAGES}"

cd "${BUILD_DIR}"

if [ "${RECONFIGURE}" = true ] || [ ! -f ".config" ]; then
    log_info "Running iora_defconfig..."
    PATH="${SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make BR2_EXTERNAL="${SCRIPT_DIR}" iora_defconfig
fi

if [ "${CLEAN_GLIBC}" = true ]; then
    log_warn "Cleaning glibc build directory before resume..."
    PATH="${SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make glibc-dirclean
fi

if [ "${CLEAN_LINUX}" = true ]; then
    log_warn "Cleaning linux build directory before resume..."
    PATH="${SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make linux-dirclean
fi

# Apply GCC 15 compat patches before building (idempotent, safe on all distros).
patch_buildroot_makefile_in
patch_host_cmake_gcc15
patch_host_m4_gcc15
patch_host_gawk_gcc15
ensure_host_go
patch_go_bootstrap_mk

# Strip -std=gnu17 from cmake's CXXFLAGS — cmake bootstrap C++ feature
# detection treats any compiler warning as a failure, and -std=gnu17 in
# CXXFLAGS causes 'valid for C/ObjC but not C++' warnings.
if [ -f "${BUILD_DIR}/package/cmake/cmake.mk" ] && ! grep -q 's%-std=gnu17' "${BUILD_DIR}/package/cmake/cmake.mk" 2>/dev/null; then
    sed -i '/^HOST_CMAKE_CXXFLAGS/s/"s%$(HOST_CPPFLAGS)%%"/"s%$(HOST_CPPFLAGS)%%" -e "s%-std=gnu17 %%g"/' "${BUILD_DIR}/package/cmake/cmake.mk"
    log_info "Patched cmake.mk: stripped -std=gnu17 from HOST_CMAKE_CXXFLAGS"
fi

# Force xz parallelism — prevent silent thread downgrades (16→3).
export XZ_OPT="-T0 --memlimit-compress=0"
export XZ_DEFAULTS="-T0 --memlimit-compress=0"

# GCC 15 (Ubuntu 26.04+) defaults to -std=gnu23; force gnu17 for host packages.
export HOST_CFLAGS="${HOST_CFLAGS:-} -std=gnu17"
export HOST_CXXFLAGS="${HOST_CXXFLAGS:-} -std=gnu17"

# Clean stale cmake CMakeCache.txt from previous failed runs.
rm -f "${BUILD_DIR}/output/build/host-cmake-"*/CMakeCache.txt 2>/dev/null || true

log_info "make -j${JOBS} (cores: ${JOBS}, xz: $(xz --version 2>/dev/null | head -1 || echo unknown))"

set +e
if [ "${PROGRESS}" = true ]; then
    PATH="${SAFE_PATH}" \
        XZ_OPT="${XZ_OPT}" XZ_DEFAULTS="${XZ_DEFAULTS}" \
        FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" \
        make -j"${JOBS}" 2>&1 | show_progress_stream | tee "${LOG_FILE}"
    BUILD_RC=${PIPESTATUS[0]}
else
    PATH="${SAFE_PATH}" \
        XZ_OPT="${XZ_OPT}" XZ_DEFAULTS="${XZ_DEFAULTS}" \
        FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" \
        make -j"${JOBS}" 2>&1 | tee "${LOG_FILE}"
    BUILD_RC=${PIPESTATUS[0]}
fi
set -e

if [ ${BUILD_RC} -ne 0 ]; then
    log_error "Build failed (exit ${BUILD_RC})."

    if grep -q "__lll_lock_wait_private\|__lll_lock_wake_private" "${LOG_FILE}"; then
        log_warn "Detected glibc linker error (__lll_lock_*)."
        log_info "Try: ./resume-build.sh --clean-glibc --progress"
    fi

    if grep -q "fatal error: gelf.h: No such file or directory\|fatal error: libelf.h: No such file or directory" "${LOG_FILE}"; then
        log_warn "Detected missing libelf headers for kernel objtool."
        log_info "Install once: sudo apt-get install -y libelf-dev pkg-config"
        log_info "No sudo available? Try: ./resume-build.sh --reconfigure --clean-linux --progress"
    fi

    log_info "Last 40 log lines:"
    tail -n 40 "${LOG_FILE}" || true
    exit ${BUILD_RC}
fi

log_success "Build resume finished successfully."

if [ "${WITH_IMAGES}" = true ]; then
    log_info "Generating release image formats from current build output..."
    IMAGE_ARGS=("--images-only")
    if [ "${UNATTENDED}" = true ]; then
        IMAGE_ARGS+=("--unattended")
    fi
    PATH="${SAFE_PATH}" "${SCRIPT_DIR}/build-all-images.sh" "${IMAGE_ARGS[@]}"
fi
