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
Resume/Continue Build for rumahl OS

Usage: $(basename "$0") [OPTIONS]

OPTIONS:
    --progress          Show a live progress bar (indeterminate, step-based)
    --clean-glibc       Clean glibc build directory before resuming
    --clean-linux       Clean kernel build directory before resuming
    --reconfigure       Re-run rumahl_defconfig before resuming
    --force-full-image  Require full GPT/loop/grub post-image flow (fail if unavailable)
    --allow-fallback    Allow post-image fallback to rootfs.ext2 (default)
    --force-fallback-image Always use rootfs.ext2 fallback for rumahl-os.img
    --with-images       After successful resume, generate release image formats
    --unattended        Forward non-interactive mode to image generation
    --ram               Resume with output directory in RAM (tmpfs)
    --ram-size SIZE     tmpfs size limit (e.g. 32G)
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

# ── RAM Build Support (lightweight variant for resume) ──────────────────────
RUMAHL_RAM_MIN_MB=16384

_parse_size_to_kb() {
    local val="$1"
    local num unit
    num=$(echo "${val}" | sed 's/[^0-9.]//g')
    unit=$(echo "${val}" | sed 's/[0-9.]//g' | tr '[:lower:]' '[:upper:]')
    case "${unit}" in
        G|GB)  echo $(awk "BEGIN { printf \"%.0f\", ${num} * 1024 * 1024 }" 2>/dev/null || echo 0) ;;
        M|MB)  echo $(awk "BEGIN { printf \"%.0f\", ${num} * 1024 }" 2>/dev/null || echo 0) ;;
        K|KB)  echo $(awk "BEGIN { printf \"%.0f\", ${num} }" 2>/dev/null || echo 0) ;;
        *)     echo 0 ;;
    esac
}

_kb_to_human() {
    local kb="$1"
    if [ "${kb}" -ge 1048576 ]; then
        awk "BEGIN { printf \"%.1fG\", ${kb} / 1048576 }"
    elif [ "${kb}" -ge 1024 ]; then
        awk "BEGIN { printf \"%.0fM\", ${kb} / 1024 }"
    else
        echo "${kb}K"
    fi
}

setup_ram_build() {
    [ "${RUMAHL_RAM_BUILD}" = "1" ] || return 0

    log_info "RAM BUILD: Mounting output/ on tmpfs for resume..."
    if [ "${RUMAHL_RAM_AGGRESSIVE}" = "1" ]; then
        log_info "  MODE: aggressive — dl/ + ccaches also in tmpfs"
    fi

    if [ "$(uname -s)" != "Linux" ]; then
        log_error "RAM build (tmpfs) is only supported on Linux."
        exit 1
    fi

    # Determine mount command
    local _mount_cmd=""
    if [ "${EUID:-$(id -u)}" -eq 0 ]; then
        _mount_cmd="mount"
    elif command -v sudo >/dev/null 2>&1; then
        _mount_cmd="sudo mount"
    else
        log_error "RAM build requires root privileges to mount tmpfs."
        exit 1
    fi
    _UMOUNT_CMD="${_mount_cmd//mount/umount}"

    # ── /tmp check ───────────────────────────────────────────────────────
    if ! mountpoint -q /tmp 2>/dev/null || ! df -t tmpfs /tmp >/dev/null 2>&1; then
        log_warn "  /tmp is NOT tmpfs — temp files will hit disk."
    fi

    # Check available RAM
    local _total_ram_kb _avail_ram_kb
    _total_ram_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    _avail_ram_kb=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
    local _total_ram_gb=$(( _total_ram_kb / 1048576 ))
    local _avail_ram_gb=$(( _avail_ram_kb / 1048576 ))

    log_info "  System RAM: ${_total_ram_gb} GB total, ${_avail_ram_gb} GB available"

    if [ "${_total_ram_kb}" -lt $(( RUMAHL_RAM_MIN_MB * 1024 )) ]; then
        log_warn "  Less than ${RUMAHL_RAM_MIN_MB} MB RAM — RAM build may OOM."
    fi

    # Auto fast-build for < 32 GB
    if [ "${_total_ram_kb}" -lt $(( 32 * 1024 * 1024 )) ] && [ "${RUMAHL_FAST_BUILD:-0}" != "1" ]; then
        log_info "  RAM < 32 GB → auto-enabling RUMAHL_FAST_BUILD=1"
        RUMAHL_FAST_BUILD=1
    fi

    # Calculate tmpfs size
    local _tmpfs_size_kb=0
    if [ -n "${RUMAHL_RAM_SIZE}" ]; then
        _tmpfs_size_kb=$(_parse_size_to_kb "${RUMAHL_RAM_SIZE}")
        [ "${_tmpfs_size_kb}" -le 0 ] && { log_error "Invalid --ram-size: ${RUMAHL_RAM_SIZE}"; exit 1; }
    else
        _tmpfs_size_kb=$(( _avail_ram_kb * 80 / 100 ))
        local _min_kb=$(( 16 * 1024 * 1024 ))
        [ "${_tmpfs_size_kb}" -lt "${_min_kb}" ] && _tmpfs_size_kb=${_min_kb}
        [ "${_tmpfs_size_kb}" -gt "${_total_ram_kb}" ] && _tmpfs_size_kb=${_total_ram_kb}
    fi
    log_info "  tmpfs size: $(_kb_to_human ${_tmpfs_size_kb})"

    local _output_dir="${BUILD_DIR}/output"
    mkdir -p "${_output_dir}"

    # Already mounted?
    if mountpoint -q "${_output_dir}" 2>/dev/null; then
        log_info "  output/ is already a tmpfs mount — reusing it."
        _RUMAHL_RAM_ALREADY_MOUNTED=1
        _setup_persistent_caches
        return 0
    fi

    # Backup existing output
    local _output_backup="${BUILD_DIR}/output.disk-backup"
    if [ -n "$(ls -A "${_output_dir}" 2>/dev/null)" ]; then
        log_info "  Moving existing output/ to backup..."
        rm -rf "${_output_backup}" 2>/dev/null || true
        mv "${_output_dir}" "${_output_backup}"
        mkdir -p "${_output_dir}"
        _RUMAHL_RAM_HAD_PREVIOUS_OUTPUT=1
    fi

    # Mount
    log_info "  Mounting tmpfs at ${_output_dir}..."
    if ! ${_mount_cmd} -t tmpfs -o "size=${_tmpfs_size_kb}k,mode=0755" tmpfs "${_output_dir}"; then
        log_error "  Failed to mount tmpfs."
        [ "${_RUMAHL_RAM_HAD_PREVIOUS_OUTPUT:-0}" = "1" ] && mv "${_output_backup}" "${_output_dir}"
        exit 1
    fi
    _RUMAHL_RAM_MOUNTED=1

    # Restore previously built output if available (so make can resume where it left off)
    if [ "${_RUMAHL_RAM_HAD_PREVIOUS_OUTPUT:-0}" = "1" ] && [ -d "${_output_backup}" ]; then
        log_info "  Restoring previous build state from disk backup..."
        cp -a "${_output_backup}/." "${_output_dir}/" 2>/dev/null || \
            log_warn "  Could not restore build state — starting fresh in RAM."
        log_success "  Build state restored to tmpfs."
        rm -rf "${_output_backup}"
        _RUMAHL_RAM_HAD_PREVIOUS_OUTPUT=0
    fi

    _setup_persistent_caches
    log_success "RAM build ready for resume."
}

_setup_persistent_caches() {
    local _output_dir="${BUILD_DIR}/output"

    # ── dl/ ──────────────────────────────────────────────────────────────
    if [ -n "${RUMAHL_PERSISTENT_DL_DIR:-}" ]; then
        :
    else
        RUMAHL_PERSISTENT_DL_DIR="${SCRIPT_DIR}/.rumahl-dl-cache"
    fi

    if [ "${RUMAHL_RAM_AGGRESSIVE}" = "1" ]; then
        export BR2_DL_DIR="${_output_dir}/dl"
        mkdir -p "${BR2_DL_DIR}"
        log_info "  dl/ → tmpfs (aggressive)"
    else
        mkdir -p "${RUMAHL_PERSISTENT_DL_DIR}"
        export BR2_DL_DIR="${RUMAHL_PERSISTENT_DL_DIR}"
        local _dl_link="${_output_dir}/dl"
        if [ -L "${_dl_link}" ] && [ "$(readlink -f "${_dl_link}" 2>/dev/null)" = "$(readlink -f "${RUMAHL_PERSISTENT_DL_DIR}" 2>/dev/null)" ]; then
            :
        else
            [ -e "${_dl_link}" ] && [ ! -L "${_dl_link}" ] && { cp -a "${_dl_link}/." "${RUMAHL_PERSISTENT_DL_DIR}/" 2>/dev/null || true; rm -rf "${_dl_link}"; }
            [ ! -e "${_dl_link}" ] && ln -sfn "${RUMAHL_PERSISTENT_DL_DIR}" "${_dl_link}"
        fi
    fi

    # ── ccache → tmpfs ───────────────────────────────────────────────────
    local _ram_ccache="${_output_dir}/.ccache"
    local _disk_ccache="${HOME}/.rumahl-cache/ccache"
    mkdir -p "${_ram_ccache}"
    export BR2_CCACHE_DIR="${_ram_ccache}"
    if [ -d "${_disk_ccache}" ] && [ -z "$(ls -A "${_ram_ccache}" 2>/dev/null)" ]; then
        cp -a "${_disk_ccache}/." "${_ram_ccache}/" 2>/dev/null || true
    fi
    _RUMAHL_RAM_CCACHE_DISK="${_disk_ccache}"

    # ── sccache → tmpfs ──────────────────────────────────────────────────
    local _ram_sccache="${_output_dir}/.sccache"
    local _disk_sccache="${HOME}/.rumahl-cache/sccache"
    mkdir -p "${_ram_sccache}"
    export SCCACHE_DIR="${_ram_sccache}"
    if [ -d "${_disk_sccache}" ] && [ -z "$(ls -A "${_ram_sccache}" 2>/dev/null)" ]; then
        cp -a "${_disk_sccache}/." "${_ram_sccache}/" 2>/dev/null || true
    fi
    _RUMAHL_RAM_SCCACHE_DISK="${_disk_sccache}"

    # ── cargo target → tmpfs ─────────────────────────────────────────────
    local _ram_cargo="${_output_dir}/.cargo-target"
    mkdir -p "${_ram_cargo}"
    export CARGO_TARGET_DIR="${_ram_cargo}"
}

teardown_ram_build() {
    [ "${RUMAHL_RAM_BUILD}" = "1" ] || return 0

    local _output_dir="${BUILD_DIR}/output"

    if [ "${RUMAHL_RAM_KEEP}" = "1" ]; then
        log_warn "  --ram-keep: output/ remains in tmpfs (will be lost on reboot)."
        return 0
    fi

    local _persist="${RUMAHL_RAM_PERSIST_DIR:-${BUILD_DIR}/output.persistent}"

    # Save ccache → disk
    local _ram_ccache="${_output_dir}/.ccache"
    if [ -d "${_ram_ccache}" ] && [ -n "$(ls -A "${_ram_ccache}" 2>/dev/null)" ]; then
        local _disk="${_RUMAHL_RAM_CCACHE_DISK:-${HOME}/.rumahl-cache/ccache}"
        mkdir -p "${_disk}"
        if command -v rsync >/dev/null 2>&1; then
            rsync -a --delete "${_ram_ccache}/" "${_disk}/" 2>/dev/null || true
        else
            cp -a "${_ram_ccache}/." "${_disk}/" 2>/dev/null || true
        fi
    fi

    # Save sccache → disk
    local _ram_sccache="${_output_dir}/.sccache"
    if [ -d "${_ram_sccache}" ] && [ -n "$(ls -A "${_ram_sccache}" 2>/dev/null)" ]; then
        local _disk="${_RUMAHL_RAM_SCCACHE_DISK:-${HOME}/.rumahl-cache/sccache}"
        mkdir -p "${_disk}"
        if command -v rsync >/dev/null 2>&1; then
            rsync -a --delete "${_ram_sccache}/" "${_disk}/" 2>/dev/null || true
        else
            cp -a "${_ram_sccache}/." "${_disk}/" 2>/dev/null || true
        fi
    fi

    # Save images
    if [ -d "${_output_dir}/images" ] && [ -n "$(ls -A "${_output_dir}/images" 2>/dev/null)" ]; then
        mkdir -p "${_persist}/images"
        cp -a "${_output_dir}/images/." "${_persist}/images/" 2>/dev/null || true
    fi

    # Save host/ if requested
    if [ -d "${_output_dir}/host" ] && [ "${RUMAHL_RAM_KEEP_HOST:-0}" = "1" ]; then
        mkdir -p "${_persist}/host"
        cp -a "${_output_dir}/host/." "${_persist}/host/" 2>/dev/null || true
    fi

    if [ -f "${BUILD_DIR}/.config" ]; then
        cp -a "${BUILD_DIR}/.config" "${_persist}/.config" 2>/dev/null || true
    fi

    if [ -L "${_output_dir}/dl" ]; then
        local _dl_target
        _dl_target=$(readlink -f "${_output_dir}/dl" 2>/dev/null || echo "")
        [ -n "${_dl_target}" ] && echo "${_dl_target}" > "${_persist}/.dl-target"
    fi

    log_success "  Build artefacts saved to ${_persist}/"

    # Unmount
    if [ "${_RUMAHL_RAM_MOUNTED:-0}" = "1" ]; then
        log_info "  Unmounting tmpfs from ${_output_dir}..."
        ${_UMOUNT_CMD} "${_output_dir}" 2>/dev/null || \
            log_warn "  Could not unmount — may be busy. Run: sudo umount ${_output_dir}"
    fi

    log_success "RAM build teardown complete — disk spared."
}

# ── GCC 15 compatibility fixes ──────────────────────────────────────────────
patch_host_cmake_gcc15() {
    local cmake_src="${BUILD_DIR}/output/build/host-cmake-3.28.1"
    [ -d "${cmake_src}" ] || return 0

    local patched_marker="${cmake_src}/.rumahl-gcc15-patched"
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
    local marker="${m4_src}/.rumahl-gcc15-patched"
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
    local marker="${gawk_src}/.rumahl-gcc15-patched"
    [ -f "${marker}" ] && return 0
    local io_c="${gawk_src}/io.c"
    if [ -f "${io_c}" ] && grep -q 'ssize_t(\*)()' "${io_c}" 2>/dev/null; then
        log_info "Patching host-gawk: fixing ssize_t(*)() casts (C23 compat)"
        sed -i 's/( ssize_t(\*)() ) read/( ssize_t(*)(int, void *, size_t) ) read/g' "${io_c}"
    fi
    touch "${marker}"
}

# ── rumahl: Buildroot host-compile include path fix ────────────────────────────
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

# ── rumahl: System Go bootstrap ───────────────────────────────────────────────
ensure_host_go() {
    local marker="${BUILD_DIR}/.rumahl-go-staged"
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
                apt-get install -y --no-install-recommends golang-go >/tmp/rumahl-go-install.log 2>&1 || true
            elif command -v sudo >/dev/null 2>&1; then
                sudo apt-get update -qq >/dev/null 2>&1 || true
                sudo apt-get install -y --no-install-recommends golang-go >/tmp/rumahl-go-install.log 2>&1 || true
            fi
        elif command -v brew >/dev/null 2>&1; then
            brew install go >/tmp/rumahl-go-install.log 2>&1 || true
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
    cat > "${mk_file}" << 'ORAGOMKPATCH'
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

# rumahl: Skip the ancient C compilation; use host system Go.
define HOST_GO_BOOTSTRAP_STAGE1_BUILD_CMDS
	@echo "rumahl: Go bootstrap stage1 provided by host system Go"
endef

# rumahl: Install host system Go instead of C-built Go 1.4.
# Requires golang-go >= 1.19 on the build host (installed by build script).
define HOST_GO_BOOTSTRAP_STAGE1_INSTALL_CMDS
	@echo "rumahl: Installing system Go as Go bootstrap stage1"
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
		rm -rf $(HOST_GO_BOOTSTRAP_STAGE1_ROOT)/$${sub} 2>/dev/null || true; \
		[ -d "$${SYS_GOROOT}/$${sub}" ] && cp -rL "$${SYS_GOROOT}/$${sub}" $(HOST_GO_BOOTSTRAP_STAGE1_ROOT)/ 2>/dev/null || true; \
	done
endef

$(eval $(host-generic-package))
ORAGOMKPATCH
    log_success "go-bootstrap-stage1.mk patched"
}

check_prereqs() {
    if [ ! -d "${BUILD_DIR}" ]; then
        log_error "Buildroot directory not found: ${BUILD_DIR}"
        log_info "Run ./build.sh all once to download and extract Buildroot."
        exit 1
    fi

    for f in external.desc external.mk Config.in configs/rumahl_defconfig; do
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
RUMAHL_RAM_BUILD="${RUMAHL_RAM_BUILD:-0}"
RUMAHL_RAM_SIZE="${RUMAHL_RAM_SIZE:-}"
RUMAHL_RAM_KEEP="${RUMAHL_RAM_KEEP:-0}"
RUMAHL_RAM_AGGRESSIVE="${RUMAHL_RAM_AGGRESSIVE:-0}"

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
        --ram)
            RUMAHL_RAM_BUILD=1
            ;;
        --ram-size)
            shift
            RUMAHL_RAM_SIZE="${1:-}"
            ;;
        --ram-size=*)
            RUMAHL_RAM_SIZE="${1#*=}"
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
    log_info "Running rumahl_defconfig..."
    PATH="${SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make BR2_EXTERNAL="${SCRIPT_DIR}" rumahl_defconfig
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

# ── RAM build setup ─────────────────────────────────────────────────────
setup_ram_build
if [ "${RUMAHL_RAM_BUILD}" = "1" ]; then
    trap teardown_ram_build EXIT
    echo ""
fi

log_info "make -j${JOBS} (cores: ${JOBS}, xz: $(xz --version 2>/dev/null | head -1 || echo unknown))"

set +e
if [ "${PROGRESS}" = true ]; then
    PATH="${SAFE_PATH}" \
        XZ_OPT="${XZ_OPT}" XZ_DEFAULTS="${XZ_DEFAULTS}" \
        LD_LIBRARY_PATH="${BUILD_DIR}/output/host/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        FORCE_UNSAFE_CONFIGURE=1 RUMAHL_POST_IMAGE_MODE="${POST_IMAGE_MODE}" \
        make -j"${JOBS}" 2>&1 | show_progress_stream | tee "${LOG_FILE}"
    BUILD_RC=${PIPESTATUS[0]}
else
    PATH="${SAFE_PATH}" \
        XZ_OPT="${XZ_OPT}" XZ_DEFAULTS="${XZ_DEFAULTS}" \
        LD_LIBRARY_PATH="${BUILD_DIR}/output/host/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        FORCE_UNSAFE_CONFIGURE=1 RUMAHL_POST_IMAGE_MODE="${POST_IMAGE_MODE}" \
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

# Tear down RAM build (save artefacts, unmount tmpfs)
teardown_ram_build

if [ "${WITH_IMAGES}" = true ]; then
    log_info "Generating release image formats from current build output..."
    IMAGE_ARGS=("--images-only")
    if [ "${UNATTENDED}" = true ]; then
        IMAGE_ARGS+=("--unattended")
    fi
    PATH="${SAFE_PATH}" "${SCRIPT_DIR}/build-all-images.sh" "${IMAGE_ARGS[@]}"
fi
