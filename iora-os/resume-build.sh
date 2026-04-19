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

set +e
if [ "${PROGRESS}" = true ]; then
    PATH="${SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" make -j"${JOBS}" 2>&1 | show_progress_stream | tee "${LOG_FILE}"
    BUILD_RC=${PIPESTATUS[0]}
else
    PATH="${SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" make -j"${JOBS}" 2>&1 | tee "${LOG_FILE}"
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
