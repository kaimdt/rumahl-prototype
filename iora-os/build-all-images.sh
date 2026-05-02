#!/bin/bash
#
# IORA OS Complete Image Builder
# Creates all image formats for different deployment scenarios
#
# Generates:
#   - img.xz       - Raw disk image (USB/SD card, physical hardware)
#   - iso          - Archive ISO (contains compressed raw image; not directly bootable)
#   - installer-boot.iso - Bootable installer ISO (GRUB/UEFI)
#   - qcow2.xz     - QEMU/KVM image (compressed)
#   - vdi.zip      - VirtualBox image
#   - vmdk.zip     - VMware image
#   - ova          - Open Virtualization Archive (VirtualBox/VMware)
#   - raucb        - RAUC update bundle

set -e
set -o pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/buildroot-2024.02"
OUTPUT_DIR="${BUILD_DIR}/output/images"
RELEASE_DIR="${SCRIPT_DIR}/releases/$(date +%Y%m%d-%H%M%S)"
BUILDROOT_VERSION="2024.02"
BUILDROOT_URL="https://buildroot.org/downloads/buildroot-${BUILDROOT_VERSION}.tar.gz"
POST_IMAGE_MODE="auto"
UNATTENDED=false
IMAGES_ONLY=false
PROGRESS=false
REQUIRE_ALL_ARTIFACTS=false
ARTIFACT_FILTER="all"
BUILD_JOBS=""
XZ_PRESET="${XZ_PRESET:-9}"

CREATED_ARTIFACTS=()
SKIPPED_ARTIFACTS=()
PUBLISH_RELEASE=false

# VM image settings
VM_NAME="IORA-OS"
VM_VERSION="1.0"
VM_MEMORY_MB="2048"
VM_CPUS="2"
VM_DISK_SIZE="8G"

# RAUC signing (configure these for production)
RAUC_CERT="${SCRIPT_DIR}/rauc/cert.pem"
RAUC_KEY="${SCRIPT_DIR}/rauc/key.pem"
BUILDROOT_SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
FALLBACK_MARKER="${OUTPUT_DIR}/iora-os.fallback"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

mark_created() {
    CREATED_ARTIFACTS+=("$1")
}

mark_skipped() {
    SKIPPED_ARTIFACTS+=("$1")
}

want_artifact() {
    local artifact="$1"
    if [ "${ARTIFACT_FILTER}" = "all" ]; then
        return 0
    fi
    case ",${ARTIFACT_FILTER}," in
        *,${artifact},*) return 0 ;;
        *) return 1 ;;
    esac
}

set_artifact_filter() {
    local filter="$1"
    local normalized=""
    local item
    IFS=',' read -r -a _artifact_items <<< "${filter}"
    for item in "${_artifact_items[@]}"; do
        item="$(echo "${item}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
        case "${item}" in
            all)
                ARTIFACT_FILTER="all"
                return 0
                ;;
            raw|img|img-xz)
                item="raw" ;;
            boot|boot-iso|installer-boot|installer-boot-iso)
                item="boot-iso" ;;
            iso|archive-iso|qcow2|vdi|vmdk|ova|rauc|raucb)
                [ "${item}" = "archive-iso" ] && item="iso"
                [ "${item}" = "raucb" ] && item="rauc"
                ;;
            "")
                continue ;;
            *)
                log_error "Unknown artifact '${item}'. Expected: raw,iso,boot-iso,qcow2,vdi,vmdk,ova,rauc,all"
                exit 1
                ;;
        esac
        case ",${normalized}," in
            *,${item},*) ;;
            *) normalized="${normalized:+${normalized},}${item}" ;;
        esac
    done
    ARTIFACT_FILTER="${normalized:-all}"
}

xz_compress_file() {
    local src_file="$1"
    local dst_file="$2"
    local tmp_file="${dst_file}.tmp"

    rm -f "${tmp_file}" "${dst_file}"

    # Use streaming compression to avoid metadata/chgrp issues on some filesystems.
    # --memlimit-compress=0 disables xz's auto-throttling that otherwise drops
    # the thread count from -T0 (=ncpu) to 2-3 on high-RAM hosts because the
    # dictionary at -9 wants ~675 MiB per thread and xz caps total RAM at
    # ~25% of system memory by default. Override via XZ_MEMLIMIT env if needed.
    local _memlimit="${XZ_MEMLIMIT:-0}"
    if ! xz "-${XZ_PRESET}" -T0 --memlimit-compress="${_memlimit}" -c "${src_file}" > "${tmp_file}"; then
        rm -f "${tmp_file}"
        return 1
    fi

    mv -f "${tmp_file}" "${dst_file}"
}

require_bootable_base_image() {
    if [ -f "${FALLBACK_MARKER}" ]; then
        log_error "Current base image was produced via fallback mode and is not a validated bootable disk image."
        log_info "Rebuild with privileges and full post-image flow: sudo ./build.sh all --force-full-image --progress"
        return 1
    fi

    if [ ! -f "${OUTPUT_DIR}/rootfs.cpio.gz" ] && [ ! -f "${OUTPUT_DIR}/rootfs.cpio" ]; then
        log_warn "No Buildroot cpio initramfs output detected; installer ISO may be incomplete until you run a reconfigure rebuild."
    fi

    return 0
}

write_payload_metadata() {
    local target_dir="$1"
    local payload_mode="full"
    local payload_bootable="yes"
    local payload_layout="gpt+bios+uefi+abroot+data"
    local payload_boot_mode="dual"

    if [ -f "${FALLBACK_MARKER}" ]; then
        payload_mode="fallback"
        payload_bootable="no"
        payload_layout="rootfs.ext2-only"
        payload_boot_mode="none"
    elif [ -f "${OUTPUT_DIR}/iora-os.bootmode" ]; then
        payload_boot_mode=$(cat "${OUTPUT_DIR}/iora-os.bootmode" 2>/dev/null | tr -d '\r\n' || echo "dual")
        case "${payload_boot_mode}" in
            dual|uefi-only|bios-only)
                ;;
            *)
                payload_boot_mode="dual"
                ;;
        esac
    fi

    cat > "${target_dir}/PAYLOAD-METADATA" <<EOF
PAYLOAD_MODE=${payload_mode}
PAYLOAD_BOOTABLE=${payload_bootable}
PAYLOAD_LAYOUT=${payload_layout}
PAYLOAD_BOOT_MODE=${payload_boot_mode}
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

normalize_shell_scripts() {
    # Keep all project shell scripts executable and with LF endings.
    find "${SCRIPT_DIR}" \
        -path "${SCRIPT_DIR}/buildroot-*" -prune -o \
        -type f -name "*.sh" -print0 | while IFS= read -r -d '' file; do
        sed -i 's/\r$//' "${file}" || true
        chmod +x "${file}" || true
    done
}

prompt_yes_no() {
    local question="$1"
    local default_answer="${2:-N}"
    local reply

    if [ "${UNATTENDED}" = true ]; then
        if [ "${default_answer}" = "Y" ]; then
            return 0
        fi
        return 1
    fi

    if [ ! -t 0 ]; then
        log_warn "No interactive terminal detected, defaulting to '${default_answer}' for: ${question}"
        if [ "${default_answer}" = "Y" ]; then
            return 0
        fi
        return 1
    fi

    while true; do
        read -r -p "${question} [y/n]: " reply
        case "${reply}" in
            [Yy]|[Yy][Ee][Ss]) return 0 ;;
            [Nn]|[Nn][Oo]) return 1 ;;
            *) echo "Please answer y or n." ;;
        esac
    done
}

dep_to_package() {
    case "$1" in
        xz) echo "xz-utils" ;;
        qemu-img) echo "qemu-utils" ;;
        libelf) echo "libelf-dev" ;;
        *) echo "$1" ;;
    esac
}

try_apt_install() {
    local package_list=("$@")
    local installer=""

    if ! command -v apt-get &> /dev/null; then
        return 1
    fi

    if [ "${EUID}" -eq 0 ]; then
        installer=""
    elif command -v sudo &> /dev/null; then
        installer="sudo"
    else
        return 1
    fi

    if [ -n "${installer}" ]; then
        ${installer} DEBIAN_FRONTEND=noninteractive apt-get update && \
            ${installer} DEBIAN_FRONTEND=noninteractive apt-get install -y "${package_list[@]}"
    else
        DEBIAN_FRONTEND=noninteractive apt-get update && \
            DEBIAN_FRONTEND=noninteractive apt-get install -y "${package_list[@]}"
    fi
}

offer_install_missing_packages() {
    local reason="$1"
    shift
    local packages=("$@")

    if [ ${#packages[@]} -eq 0 ]; then
        return 0
    fi

    if [ "${UNATTENDED}" = true ]; then
        log_info "Unattended mode: attempting automatic install for ${reason}: ${packages[*]}"
        try_apt_install "${packages[@]}" || true
        return 0
    fi

    if prompt_yes_no "Missing ${reason}. Try automatic install now (${packages[*]})?" "N"; then
        if ! try_apt_install "${packages[@]}"; then
            log_warn "Automatic installation failed for ${reason}."
            return 1
        fi
    fi

    return 0
}

show_install_alternatives() {
    local feature="$1"
    local package_hint="$2"

    log_warn "Alternative options for ${feature}:"
    log_warn "  1) Install manually: sudo apt-get install -y ${package_hint}"
    log_warn "  2) Build in a native Linux VM/host with full tooling"
    log_warn "  3) Continue without this artifact if optional"
}

refresh_optional_tool_flags() {
    ISO_TOOL_AVAILABLE=false
    HAS_VBOXMANAGE=false
    HAS_RAUC=false
    HAS_GRUB_MKRESCUE=false

    if command -v xorriso &> /dev/null || command -v genisoimage &> /dev/null || command -v mkisofs &> /dev/null; then
        ISO_TOOL_AVAILABLE=true
    fi

    if command -v grub-mkrescue &> /dev/null; then
        HAS_GRUB_MKRESCUE=true
    fi

    if command -v VBoxManage &> /dev/null; then
        HAS_VBOXMANAGE=true
    fi

    if command -v rauc &> /dev/null; then
        HAS_RAUC=true
    fi
}

check_dependencies() {
    log_info "Checking build dependencies..."

    local missing_deps=()
    local missing_packages=()

    # Core build tools
    local core_cmds=(tar gzip xz zip)
    if [ "${IMAGES_ONLY}" = false ]; then
        core_cmds+=(make gcc g++ patch wget)
    fi

    for cmd in "${core_cmds[@]}"; do
        if ! command -v $cmd &> /dev/null; then
            missing_deps+=($cmd)
        fi
    done

    # Kernel tools (objtool) need libelf headers via pkg-config only for full build.
    if [ "${IMAGES_ONLY}" = false ]; then
        if command -v pkg-config &> /dev/null; then
            if ! pkg-config --exists libelf; then
                missing_deps+=("libelf")
            fi
        else
            missing_deps+=("pkg-config")
        fi
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        for dep in "${missing_deps[@]}"; do
            missing_packages+=("$(dep_to_package "$dep")")
        done

        log_warn "Missing required dependencies: ${missing_deps[*]}"

        offer_install_missing_packages "required dependencies" "${missing_packages[@]}" || true

        local still_missing=()
        for dep in "${missing_deps[@]}"; do
            if [ "$dep" = "libelf" ]; then
                if ! command -v pkg-config &> /dev/null || ! pkg-config --exists libelf; then
                    still_missing+=("$dep")
                fi
            elif ! command -v "$dep" &> /dev/null; then
                still_missing+=("$dep")
            fi
        done

        if [ ${#still_missing[@]} -ne 0 ]; then
            log_error "Still missing required dependencies: ${still_missing[*]}"
            show_install_alternatives "required build dependencies" "${missing_packages[*]}"

            if [ "${UNATTENDED}" = true ]; then
                log_error "Unattended mode: cannot continue with missing required dependencies."
                exit 1
            fi

            if ! prompt_yes_no "Continue anyway? Build may fail." "N"; then
                exit 1
            fi
        fi
    fi

    refresh_optional_tool_flags

    if want_artifact iso && [ "${ISO_TOOL_AVAILABLE}" = false ]; then
        log_warn "No ISO creator found (xorriso/genisoimage/mkisofs) - ISO creation will be skipped"
        if offer_install_missing_packages "ISO creation tools" "xorriso"; then
            refresh_optional_tool_flags
        fi
        if [ "${ISO_TOOL_AVAILABLE}" = false ]; then
            show_install_alternatives "ISO generation" "xorriso"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "ISO cannot be generated right now. Continue build without ISO?" "Y"; then
                exit 1
            fi
        fi
    fi

    if want_artifact boot-iso && [ "${HAS_GRUB_MKRESCUE}" = false ]; then
        log_warn "grub-mkrescue not found - bootable installer ISO will be skipped"
        if offer_install_missing_packages "bootable ISO tooling" "grub-pc-bin grub-common mtools"; then
            refresh_optional_tool_flags
        fi
        if [ "${HAS_GRUB_MKRESCUE}" = false ]; then
            show_install_alternatives "bootable installer ISO" "grub-pc-bin grub-common mtools"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "Bootable installer ISO cannot be generated right now. Continue without it?" "Y"; then
                exit 1
            fi
        fi
    fi

    # UEFI boot tooling check — grub-mkrescue silently produces BIOS-only ISOs
    # when mtools or xorriso are missing. The installer must boot on UEFI too.
    if want_artifact boot-iso; then
        local need_uefi=()
        command -v mformat  >/dev/null 2>&1 || need_uefi+=(mtools)
        command -v xorriso  >/dev/null 2>&1 || need_uefi+=(xorriso)
        if [ -d /usr/lib/grub/x86_64-efi ] || [ -d /usr/share/grub/x86_64-efi ]; then
            :
        else
            need_uefi+=("grub-efi-amd64-bin")
        fi
        if [ "${#need_uefi[@]}" -gt 0 ]; then
            log_warn "UEFI boot tooling missing: ${need_uefi[*]} — installer ISO may only boot on BIOS."
            if offer_install_missing_packages "UEFI ISO tooling" "${need_uefi[@]}"; then
                :
            else
                show_install_alternatives "UEFI-bootable installer ISO" "${need_uefi[*]}"
                if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "Continue without UEFI boot support?" "Y"; then
                    exit 1
                fi
            fi
        fi
    fi

    if want_artifact ova && [ "${HAS_VBOXMANAGE}" = false ]; then
        log_warn "VBoxManage not found - OVA export will be skipped"
        if offer_install_missing_packages "OVA export tools" "virtualbox"; then
            refresh_optional_tool_flags
        fi
        if [ "${HAS_VBOXMANAGE}" = false ]; then
            show_install_alternatives "OVA export" "virtualbox"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "OVA cannot be generated right now. Continue build without OVA?" "Y"; then
                exit 1
            fi
        fi
    fi

    if want_artifact rauc && [ "${HAS_RAUC}" = false ]; then
        log_warn "RAUC not found - update bundle creation will be skipped"
        if offer_install_missing_packages "RAUC tooling" "rauc"; then
            refresh_optional_tool_flags
        fi
        if [ "${HAS_RAUC}" = false ]; then
            show_install_alternatives "RAUC bundle creation" "rauc"
            if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "RAUC bundle cannot be generated right now. Continue build without RAUC bundle?" "Y"; then
                exit 1
            fi
        fi
    fi

    if (want_artifact qcow2 || want_artifact vdi || want_artifact vmdk || want_artifact ova) && ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not found - qcow2/vdi/vmdk export will be skipped"
        if offer_install_missing_packages "VM conversion tooling" "qemu-utils"; then
            if ! command -v qemu-img &> /dev/null; then
                show_install_alternatives "VM image conversion" "qemu-utils"
                if [ "${UNATTENDED}" = false ] && ! prompt_yes_no "VM images cannot be generated right now. Continue build without qcow2/vdi/vmdk?" "Y"; then
                    exit 1
                fi
            fi
        fi
    fi

    log_success "All dependencies available"
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --force-full-image)
                POST_IMAGE_MODE="full"
                ;;
            --allow-fallback)
                POST_IMAGE_MODE="auto"
                ;;
            --force-fallback-image)
                POST_IMAGE_MODE="fallback"
                ;;
            --images-only)
                IMAGES_ONLY=true
                ;;
            --minimal-artifacts|--quick)
                set_artifact_filter "raw,boot-iso"
                if [ "${XZ_PRESET}" = "9" ]; then
                    XZ_PRESET="6"
                fi
                ;;
            --artifacts)
                shift
                set_artifact_filter "${1:-}"
                ;;
            --artifacts=*)
                set_artifact_filter "${1#*=}"
                ;;
            --progress)
                PROGRESS=true
                ;;
            --jobs)
                shift
                BUILD_JOBS="${1:-}"
                ;;
            --jobs=*)
                BUILD_JOBS="${1#*=}"
                ;;
            --xz-preset)
                shift
                XZ_PRESET="${1:-9}"
                ;;
            --xz-preset=*)
                XZ_PRESET="${1#*=}"
                ;;
            --require-all-artifacts)
                REQUIRE_ALL_ARTIFACTS=true
                ;;
            --unattended|--non-interactive|--unattachment)
                UNATTENDED=true
                ;;
            --publish)
                PUBLISH_RELEASE=true
                ;;
            -h|--help)
                cat <<EOF
Usage: $(basename "$0") [OPTIONS]

OPTIONS:
    --force-full-image     Require full GPT/loop/grub post-image flow (fail if unavailable)
    --allow-fallback       Allow automatic fallback to rootfs.ext2 image (default)
    --force-fallback-image Always use rootfs.ext2 fallback for iora-os.img
    --images-only          Skip Buildroot compile, generate release artifacts from existing output/images
    --minimal-artifacts    Create only raw image + bootable installer ISO (faster local install build)
    --artifacts LIST       Comma list: raw,iso,boot-iso,qcow2,vdi,vmdk,ova,rauc,all
    --progress             Show build step progress while running make
    --jobs N               Override Buildroot make parallelism (default: nproc)
    --xz-preset N          xz compression preset 0-9 (default: 9; quick uses 6)
    --require-all-artifacts Fail build if any optional artifact is skipped
    --unattended           No interactive prompts; auto-attempt install and continue when optional tooling is missing
    --publish              Publish release to IORA update server (requires IORA_UPDATE_API_KEY)
    -h, --help             Show this help
EOF
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
        shift
    done
}

download_buildroot() {
    if [ -d "${BUILD_DIR}" ]; then
        log_info "Buildroot already downloaded"
        return
    fi

    log_info "Downloading Buildroot ${BUILDROOT_VERSION}..."
    cd "${SCRIPT_DIR}"

    if [ ! -f "buildroot-${BUILDROOT_VERSION}.tar.gz" ]; then
        wget "${BUILDROOT_URL}"
    fi

    log_info "Extracting Buildroot..."
    tar xzf "buildroot-${BUILDROOT_VERSION}.tar.gz"

    log_success "Buildroot ready"
}

configure_buildroot() {
    log_info "Configuring Buildroot for IORA OS..."

    cd "${BUILD_DIR}"
    local config_key="${IORA_DEFCONFIG:-iora_defconfig}|dev=${IORA_OS_DEV:-0}"
    local config_marker=".iora-config-key"
    local current_key=""
    [ -f "${config_marker}" ] && current_key="$(cat "${config_marker}" 2>/dev/null || true)"

    if [ -f .config ] && [ "${current_key}" = "${config_key}" ] && [ "${IORA_FORCE_RECONFIGURE:-0}" != "1" ]; then
        log_info "Reusing existing Buildroot .config (${config_key}); running olddefconfig only."
        PATH="${BUILDROOT_SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make BR2_EXTERNAL="${SCRIPT_DIR}" olddefconfig
    else
        PATH="${BUILDROOT_SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make BR2_EXTERNAL="${SCRIPT_DIR}" "${IORA_DEFCONFIG:-iora_defconfig}"
        if [ "${IORA_OS_DEV:-0}" = "1" ]; then
            log_info "Enabling native build toolchain for IORA OS Dev image..."
            if ! grep -q '^BR2_PACKAGE_IORA_DEV_TOOLCHAIN=y$' .config 2>/dev/null; then
                cat >> .config <<'EOF'
BR2_PACKAGE_IORA_DEV_TOOLCHAIN=y
EOF
            fi
            PATH="${BUILDROOT_SAFE_PATH}" FORCE_UNSAFE_CONFIGURE=1 make BR2_EXTERNAL="${SCRIPT_DIR}" olddefconfig
        fi
        echo "${config_key}" > "${config_marker}"
    fi

    log_success "Buildroot configured"
}

build_base_image() {
    log_info "Building IORA OS base image (this may take 1-2 hours)..."
    log_info "Post-image mode: ${POST_IMAGE_MODE}"

    # Force xz to use ALL cores. The old `${XZ_OPT:-...}` default-syntax
    # silently left pre-existing restrictive settings (e.g. XZ_OPT=-T3)
    # in place. Now we ALWAYS override to -T0 and disable memory
    # throttling so xz stops dropping threads from 16→3.
    #
    # Buildroot's `make` also needs XZ_OPT in its environment — it runs
    # xz inside recipes that don't always inherit the outer shell env.
    local _old_xz_opt="${XZ_OPT:-<unset>}"
    local _old_xz_defaults="${XZ_DEFAULTS:-<unset>}"
    export XZ_OPT="-T0 --memlimit-compress=0"
    export XZ_DEFAULTS="-T0 --memlimit-compress=0"

    if [ "${_old_xz_opt}" != "-T0 --memlimit-compress=0" ] || \
       [ "${_old_xz_defaults}" != "-T0 --memlimit-compress=0" ]; then
        log_info "  xz parallelism: forcing -T0 (was XZ_OPT=${_old_xz_opt}, XZ_DEFAULTS=${_old_xz_defaults})"
    fi

    local _ncpu
    _ncpu="${BUILD_JOBS:-$(nproc)}"
    log_info "  make -j${_ncpu} (override with --jobs N)"

    cd "${BUILD_DIR}"
    if [ "${PROGRESS}" = true ]; then
        PATH="${BUILDROOT_SAFE_PATH}" \
            XZ_OPT="${XZ_OPT}" XZ_DEFAULTS="${XZ_DEFAULTS}" \
            FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" IORA_UNATTENDED="${UNATTENDED}" \
            make -j"${_ncpu}" 2>&1 | show_progress_stream
    else
        PATH="${BUILDROOT_SAFE_PATH}" \
            XZ_OPT="${XZ_OPT}" XZ_DEFAULTS="${XZ_DEFAULTS}" \
            FORCE_UNSAFE_CONFIGURE=1 IORA_POST_IMAGE_MODE="${POST_IMAGE_MODE}" IORA_UNATTENDED="${UNATTENDED}" \
            make -j"${_ncpu}"
    fi

    log_success "Base image built successfully"
}

# =============================================================================
# Compile IORA service binaries and embed them in the rootfs overlay
# =============================================================================
# All IORA system containers are self-built on the device (no registry pulls).
# To make the on-device build fast we pre-compile the Rust service binaries
# here (on the build host) and place them into the rootfs overlay so that
# post-build.sh can bundle them into /opt/iora/build/<service>/bin/.
#
# Build strategy (in order of preference):
#   1) Native `cargo build --release` on the build host (fastest, no Docker).
#      This is the default path since we migrated off the Docker-based build.
#   2) Docker builder image (legacy fallback for hosts where cargo is missing
#      but Docker is available).
#   3) Skip with a loud warning — the resulting image will boot but every
#      native IORA service will stay inactive because ConditionPathExists on
#      /opt/iora/build/<svc>/bin/<svc> will fail. Setup wizard on :8080 may
#      also be unreachable if it depends on the native stack.

# ─── Frontend (React/Vite dashboard) ─────────────────────────────────────────
# The IORA dashboard frontend lives in the repo root (one level up from
# this iora-os/ folder): package.json + vite.config.ts + src/. iora-home
# (Rust backend on port 8126) serves the produced dist/ directory; without
# a built bundle it falls back to an embedded "backend is running" page.
#
# Strategy: build dist/ once via `npm ci && npm run build`, copy it into the
# rootfs overlay at /opt/iora/iora-home/dist/, and let iora-home read the
# path from the IORA_HOME_DIST env var (set in /etc/iora/iora-home.env).
#
# Reuses an existing dist/ on the host if (a) it exists, (b) all source
# files in src/ + index.html are older than dist/index.html, and
# IORA_REBUILD_FRONTEND is not set to 1. Otherwise rebuilds.
#
# Skip with IORA_SKIP_FRONTEND=1 if you only want the backend image.
build_frontend_bundle() {
    if [ "${IORA_SKIP_FRONTEND:-0}" = "1" ]; then
        log_info "IORA_SKIP_FRONTEND=1 → skipping frontend bundle"
        return 0
    fi

    # Locate the frontend source. The repo layout puts package.json at the
    # repo root (one level up from iora-os/). Older sibling layouts placed
    # it next to backend/. Try a few candidates.
    local FRONTEND_DIR=""
    for candidate in \
        "${SCRIPT_DIR}/../frontend" \
        "${SCRIPT_DIR}/.." \
        "${SCRIPT_DIR}/../.." \
        "${SCRIPT_DIR}/frontend"; do
        if [ -f "${candidate}/package.json" ] && [ -f "${candidate}/vite.config.ts" ]; then
            FRONTEND_DIR="$(cd "${candidate}" && pwd)"
            break
        fi
    done
    if [ -z "${FRONTEND_DIR}" ]; then
        log_warn "Frontend source (package.json + vite.config.ts) not found near ${SCRIPT_DIR}"
        log_warn "iora-home will serve the embedded fallback page on :8126."
        return 0
    fi
    log_info "Building dashboard frontend from: ${FRONTEND_DIR}"

    # Skip the build if dist/ is already up-to-date relative to src/.
    local rebuild=1
    if [ "${IORA_REBUILD_FRONTEND:-0}" != "1" ] && [ -f "${FRONTEND_DIR}/dist/index.html" ]; then
        local newest_src
        newest_src=$(find "${FRONTEND_DIR}/src" "${FRONTEND_DIR}/index.html" \
            "${FRONTEND_DIR}/package.json" "${FRONTEND_DIR}/vite.config.ts" \
            -type f -printf '%T@\n' 2>/dev/null | sort -nr | head -n 1)
        local dist_mtime
        dist_mtime=$(stat -c '%Y' "${FRONTEND_DIR}/dist/index.html" 2>/dev/null || echo 0)
        if [ -n "${newest_src}" ] && [ "${dist_mtime}" -gt "${newest_src%.*}" ]; then
            log_success "Frontend dist/ is newer than sources — reusing existing build"
            rebuild=0
        fi
    fi

    if [ "${rebuild}" = "1" ]; then
        # Auto-install nodejs+npm on Debian/Ubuntu if missing — the build is
        # often run on a fresh VM where setup.sh hasn't been re-run after
        # this commit added nodejs to COMMON_APT.
        if ! command -v npm >/dev/null 2>&1; then
            log_warn "npm not found — attempting auto-install via apt-get"
            if command -v apt-get >/dev/null 2>&1; then
                if [ "$(id -u)" = "0" ]; then
                    apt-get update -qq >/tmp/iora-apt.log 2>&1 || true
                    apt-get install -y --no-install-recommends nodejs npm >>/tmp/iora-apt.log 2>&1 || true
                else
                    sudo -n apt-get update -qq >/tmp/iora-apt.log 2>&1 || true
                    sudo -n apt-get install -y --no-install-recommends nodejs npm >>/tmp/iora-apt.log 2>&1 || true
                fi
            fi
        fi
        if ! command -v npm >/dev/null 2>&1; then
            log_error "npm STILL not found after auto-install attempt."
            log_error "Install Node.js manually: sudo apt-get install -y nodejs npm"
            log_error "Or skip the frontend with: IORA_SKIP_FRONTEND=1 sudo ./build.sh all"
            log_error "Without the frontend, :8126 will only show the IORA placeholder page."
            return 1
        fi

        log_info "  Node: $(node --version 2>/dev/null || echo unknown), npm: $(npm --version 2>/dev/null || echo unknown)"

        # Use `npm ci` if package-lock.json exists (reproducible), else `npm install`.
        local install_cmd="install"
        [ -f "${FRONTEND_DIR}/package-lock.json" ] && install_cmd="ci"

        log_info "  npm ${install_cmd} (in ${FRONTEND_DIR})..."
        if ! ( cd "${FRONTEND_DIR}" && npm "${install_cmd}" --no-audit --no-fund --prefer-offline ) >/tmp/iora-npm-install.log 2>&1; then
            log_error "  npm ${install_cmd} FAILED — last 30 lines of /tmp/iora-npm-install.log:"
            tail -n 30 /tmp/iora-npm-install.log 2>/dev/null | sed 's/^/      /' || true
            log_error "  Image will be built without the dashboard UI (:8126 → IORA placeholder page)."
            log_error "  Set IORA_SKIP_FRONTEND=1 to silence this error, or fix npm and re-run."
            return 1
        fi

        log_info "  npm run build..."
        if ! ( cd "${FRONTEND_DIR}" && npm run build ) >/tmp/iora-npm-build.log 2>&1; then
            log_error "  npm run build FAILED — last 40 lines of /tmp/iora-npm-build.log:"
            tail -n 40 /tmp/iora-npm-build.log 2>/dev/null | sed 's/^/      /' || true
            log_error "  Image will be built without the dashboard UI (:8126 → IORA placeholder page)."
            return 1
        fi
        log_success "  npm run build OK"
    fi

    if [ ! -f "${FRONTEND_DIR}/dist/index.html" ]; then
        log_warn "Frontend build produced no dist/index.html"
        return 0
    fi

    # Stage dist/ into the rootfs overlay at /opt/iora/iora-home/dist/.
    local FRONTEND_DEST="${SCRIPT_DIR}/board/iora/rootfs-overlay/opt/iora/iora-home/dist"
    rm -rf "${FRONTEND_DEST}"
    mkdir -p "${FRONTEND_DEST}"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete "${FRONTEND_DIR}/dist/" "${FRONTEND_DEST}/"
    else
        cp -a "${FRONTEND_DIR}/dist/." "${FRONTEND_DEST}/"
    fi
    local size
    size=$(du -sh "${FRONTEND_DEST}" 2>/dev/null | cut -f1 || echo "?")
    log_success "Frontend bundle staged: ${FRONTEND_DEST} (${size})"
}

build_service_binaries() {
    local OVERLAY="${SCRIPT_DIR}/board/iora/rootfs-overlay/opt/iora/build"
    # Resolve the backend/ source tree. We try the in-tree location first
    # (iora-os/backend/) — that's where the workspace lives in this repo and
    # is what `git pull` updates. The legacy sibling layout
    # (home-assistant-dashb/backend/, one level up) is only used as a
    # fallback for older checkouts. If both exist, the in-tree copy wins —
    # otherwise an old sibling tree silently shadows freshly pulled changes
    # and the build uses stale sources.
    local BACKEND_DIR=""
    for candidate in \
        "${SCRIPT_DIR}/backend" \
        "${SCRIPT_DIR}/../backend" \
        "${SCRIPT_DIR}/../../backend"; do
        if [ -f "${candidate}/Cargo.toml" ] && [ -f "${candidate}/Dockerfile" ]; then
            BACKEND_DIR="${candidate}"
            break
        fi
    done
    if [ -z "${BACKEND_DIR}" ]; then
        log_warn "backend/ source directory not found near ${SCRIPT_DIR}; skipping binary embedding."
        log_warn "Without native service binaries, iora-core/iora-home/... will NOT start on boot."
        return 0
    fi
    log_info "  Resolved backend source: ${BACKEND_DIR}"

    # ── Make cargo visible to this script ────────────────────────────────
    # setup.sh installs rustup with --no-modify-path, so a fresh shell after
    # the installer does NOT have ~/.cargo/bin on PATH. That was the root
    # cause of "overlay is empty after build": cargo existed on disk but
    # `command -v cargo` returned false and the function silently fell
    # through to the Docker fallback, which then also failed.
    if ! command -v cargo >/dev/null 2>&1; then
        for env_file in \
            "${HOME}/.cargo/env" \
            "${CARGO_HOME:-}/env" \
            "/root/.cargo/env" \
            "/home/${SUDO_USER:-$USER}/.cargo/env"
        do
            if [ -n "${env_file}" ] && [ -f "${env_file}" ]; then
                # shellcheck disable=SC1090
                . "${env_file}" 2>/dev/null || true
            fi
        done
        # Also add the conventional install dirs directly, in case the env
        # file is missing but the binaries exist.
        for bin_dir in \
            "${HOME}/.cargo/bin" \
            "/root/.cargo/bin" \
            "/home/${SUDO_USER:-$USER}/.cargo/bin" \
            "/usr/local/cargo/bin"
        do
            if [ -d "${bin_dir}" ] && [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
                PATH="${bin_dir}:${PATH}"
                export PATH
            fi
        done
    fi

    # Auto-install rustup as a last-ditch effort so that a fresh CI host or
    # a user who forgot to run setup.sh still produces working images
    # instead of an empty overlay.
    if ! command -v cargo >/dev/null 2>&1 && [ "${IORA_AUTO_INSTALL_RUST:-1}" = "1" ]; then
        log_warn "cargo not found on PATH. Installing rustup non-interactively…"
        if command -v curl >/dev/null 2>&1; then
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
                | sh -s -- -y --default-toolchain stable --profile minimal --no-modify-path \
                >/tmp/iora-rustup-install.log 2>&1 || \
                log_warn "rustup install failed (see /tmp/iora-rustup-install.log)"
            # shellcheck disable=SC1091
            [ -f "${HOME}/.cargo/env" ] && . "${HOME}/.cargo/env"
        else
            log_warn "curl not available; cannot auto-install rustup."
        fi
    fi

    local SERVICES="iora-core iora-home iora-control iora-assist iora-secrets \
                    iora-watchdog iora-security iora-gateway iora-supervisor \
                    iora-api iora-appstore iora-backup iora-connector \
                    iora-dev-bridge iora-domain-validator iora-files \
                    iora-network-monitor iora-nginx iora-resource-manager \
                    iora-updater"
    # CLI tools as `package:binary` pairs (binary may differ from crate name —
    # iora-cli ships its binary as `ora`, the user-facing command).
    local CLI_TOOLS="iora-cli:ora iora-sign:iora-sign iora-verify:iora-verify"

    # ── GLIBC compatibility check ───────────────────────────────────────────
    # Native cargo builds on a host with a newer glibc than the target produce
    # binaries that fail at runtime with `version 'GLIBC_2.39' not found`
    # (or similar). Buildroot 2024.02 ships glibc 2.38, so a host with
    # glibc >= 2.39 (Ubuntu 24.04, recent Arch/Fedora) WILL produce broken
    # binaries unless we use the Dockerfile path (Alpine/musl static).
    # IORA_BUILD_BACKEND lets the user force a specific path:
    #   auto    – pick the safest (default)
    #   native  – always cargo on host
    #   docker  – always Dockerfile / Alpine
    local _IORA_BUILD_BACKEND="${IORA_BUILD_BACKEND:-auto}"
    local _host_glibc
    _host_glibc="$(ldd --version 2>/dev/null | head -n 1 | grep -oE '[0-9]+\.[0-9]+' | tail -n 1 || echo 0.0)"
    # Tracks whether we automatically switched the rust triple to musl below.
    # When set, the native build path will use a statically-linked target
    # instead of glibc, so the produced binaries have no host-glibc dep.
    local _IORA_AUTO_MUSL=0
    if [ "${_IORA_BUILD_BACKEND}" = "auto" ]; then
        if ! command -v ldd >/dev/null 2>&1; then
            if command -v docker >/dev/null 2>&1; then
                log_warn "No glibc runtime detected on the host (ldd unavailable)."
                log_warn "Using Docker / Alpine builder on this host."
                _IORA_BUILD_BACKEND="docker"
            fi
        elif awk -v h="${_host_glibc}" 'BEGIN { exit !(h+0 >= 2.39) }'; then
            # Prefer Docker when available: the Alpine builder image has
            # musl-libssl pre-installed, so the openssl-sys crate (used by
            # 9+ services via reqwest/sqlx/etc.) compiles out of the box.
            # Cross-compiling openssl-sys from a glibc host to a musl target
            # requires either a manually-built musl-libssl or per-crate
            # `vendored` features in every Cargo.toml — both are fragile.
            #
            # musl-static is the secondary fallback for hosts without Docker:
            # it works for crates that don't use openssl, and the failure
            # mode for openssl users is a clear `openssl-sys build script
            # failed` instead of a runtime GLIBC_2.39 crash.
            if command -v docker >/dev/null 2>&1; then
                log_warn "Host glibc ${_host_glibc} is newer than target glibc 2.38."
                log_warn "Native cargo build would produce binaries that fail with GLIBC_2.39 errors."
                log_warn "Switching to Docker / Alpine-musl build path automatically."
                log_warn "Override with IORA_BUILD_BACKEND=native (musl) or IORA_RUST_TRIPLE=...."
                _IORA_BUILD_BACKEND="docker"
            elif [ -z "${IORA_RUST_TRIPLE:-}" ] \
                && command -v rustup >/dev/null 2>&1 \
                && [ "${IORA_ARCH:-x86_64}" = "x86_64" ]; then
                log_warn "Host glibc ${_host_glibc} is newer than target glibc 2.38."
                log_warn "Docker not available — falling back to musl-static cargo build."
                log_warn "WARNING: services using openssl-sys will fail unless musl-libssl is"
                log_warn "         installed. Install Docker for the most reliable build."
                _IORA_AUTO_MUSL=1
            else
                log_warn "Host glibc ${_host_glibc} > target 2.38 but neither Docker nor"
                log_warn "rustup+x86_64 is available — produced binaries WILL crash at boot."
                log_warn "Install one of:"
                log_warn "  - docker (preferred — handles openssl-sys out of the box)"
                log_warn "  - rustup + musl-tools (fallback — limited crate support)"
            fi
        fi
    fi

    # ── Wipe stale binaries from a previous run ────────────────────────────
    # Otherwise a newer host glibc + a previous-generation binary that
    # happened to NOT use any 2.39 symbols can survive a "failed" rebuild
    # and silently boot — only to crash the first time it hits a 2.39 syscall.
    log_info "Cleaning stale service binaries from rootfs overlay…"
    for svc in ${SERVICES}; do
        rm -f "${OVERLAY}/${svc}/bin/${svc}"
    done

    # ── Strategy 1: native cargo build on the build host ────────────────────
    if [ "${_IORA_BUILD_BACKEND}" != "docker" ] && command -v cargo >/dev/null 2>&1; then
        log_info "Pre-compiling IORA service binaries natively with cargo..."
        log_info "Backend source: ${BACKEND_DIR}"
        log_info "cargo: $(command -v cargo) ($(cargo --version 2>/dev/null || echo unknown))"

        local RUST_TRIPLE="${IORA_RUST_TRIPLE:-x86_64-unknown-linux-gnu}"
        case "${IORA_ARCH:-x86_64}" in
            aarch64|rpi3|rpi4|rpi5|generic-arm64)
                RUST_TRIPLE="aarch64-unknown-linux-gnu" ;;
            armhf)
                RUST_TRIPLE="armv7-unknown-linux-gnueabihf" ;;
        esac
        if [ "${_IORA_AUTO_MUSL}" = "1" ]; then
            RUST_TRIPLE="x86_64-unknown-linux-musl"
            # Set RUSTFLAGS *per-target* via the CARGO_TARGET_<TRIPLE>_RUSTFLAGS
            # env var, NOT the global RUSTFLAGS. A global RUSTFLAGS leaks into
            # the host build of proc-macros (which are dylibs and break with
            # +crt-static), causing errors like
            #   "cannot produce proc-macro for `async-trait` as the target
            #    `x86_64-unknown-linux-gnu` does not support these crate types"
            # on the host-native fallback path.
            export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-C target-feature=+crt-static"
            # OpenSSL on musl: the openssl-sys crate's build script needs to
            # find a musl-built libssl. We don't ship one, so prefer the
            # vendored copy (compiled from source by the openssl-sys build
            # script). Honored by openssl-sys >= 0.9.78.
            export OPENSSL_STATIC="${OPENSSL_STATIC:-1}"
            export PKG_CONFIG_ALLOW_CROSS="${PKG_CONFIG_ALLOW_CROSS:-1}"
            log_info "  Using musl-static target: ${RUST_TRIPLE}"
            if ! command -v musl-gcc >/dev/null 2>&1; then
                log_warn "  musl-gcc not found on PATH — crates with C deps may fail to link."
                log_warn "  Install with: sudo apt-get install -y musl-tools  (Debian/Ubuntu)"
                log_warn "             or: sudo dnf install -y musl-gcc        (Fedora)"
            fi
        fi

        if command -v rustup >/dev/null 2>&1; then
            # Always ensure a default toolchain is set. A fresh rustup
            # install with --no-modify-path (the path setup.sh takes) does
            # NOT configure one unless --default-toolchain was passed —
            # and even if it was, an older rustup that was already on the
            # system may be in a half-configured state. The command is
            # cheap and idempotent: if `stable` is already the default
            # rustup just re-links it. The previous "only run if default
            # is empty" gate didn't work because rustup prints its error
            # to stdout, which made the `grep -q '\S'` guard match.
            log_info "Ensuring rustup default toolchain is set to stable…"
            rustup default stable >/tmp/iora-rustup-default.log 2>&1 || \
                log_warn "rustup default stable failed (see /tmp/iora-rustup-default.log — last 10 lines below)"
            [ -f /tmp/iora-rustup-default.log ] && \
                tail -n 10 /tmp/iora-rustup-default.log 2>/dev/null | sed 's/^/    /' || true
            if ! rustup target add "${RUST_TRIPLE}" >/tmp/iora-rustup-target.log 2>&1; then
                log_warn "rustup target add ${RUST_TRIPLE} failed — falling back to Docker if available."
                if command -v docker >/dev/null 2>&1; then
                    log_warn "Switching build backend to Docker because ${RUST_TRIPLE} cannot be installed locally."
                    _IORA_BUILD_BACKEND="docker"
                fi
            fi
        else
            if command -v docker >/dev/null 2>&1; then
                log_warn "rustup not found on PATH; switching to Docker build backend."
                _IORA_BUILD_BACKEND="docker"
            fi
        fi

        if [ "${_IORA_BUILD_BACKEND}" = "docker" ]; then
            log_info "Docker build backend selected; skipping native cargo build."
        else
            # Use -p <package> instead of --bin: each IORA service lives in its
        # own workspace crate of the same name, so -p is unambiguous and
        # also builds the crate's *lib* dependencies in the right order.
        local CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${BACKEND_DIR}/target}"
        export CARGO_TARGET_DIR
        : >/tmp/iora-cargo-build.log
        local CARGO_LOG_DIR="/tmp/iora-cargo-logs"
        rm -rf "${CARGO_LOG_DIR}"
        mkdir -p "${CARGO_LOG_DIR}"

        # ── Optimised workspace build ───────────────────────────────────
        # Build all services in ONE cargo invocation so that cargo can
        # parallelise across ALL crates (22 packages × dependencies)
        # instead of just one package at a time. Shared dependencies
        # (iora-shared, tokio, axum, …) are compiled exactly once.
        #
        # On a 16-core build VM this typically cuts build time from
        # ~12 min to ~4 min compared to the old per-package loop.
        #
        # If the workspace build fails we fall back to individual
        # per-package builds so one type-error doesn't nuke everything.
        local _cargo_jobs="${CARGO_BUILD_JOBS:-$(nproc)}"
        export CARGO_BUILD_JOBS="${_cargo_jobs}"
        log_info "cargo build --workspace --release --target ${RUST_TRIPLE}  (jobs=${_cargo_jobs})"
        local _ws_log="${CARGO_LOG_DIR}/_workspace.log"
        local built_ok=""
        local built_fail=""

        if ( cd "${BACKEND_DIR}" && \
             cargo build --workspace --release --target "${RUST_TRIPLE}" \
                 --message-format=short ) \
             >"${_ws_log}" 2>&1; then
            cat "${_ws_log}" >>/tmp/iora-cargo-build.log
            log_success "Workspace build OK — all packages compiled together."
            # Mark all services as OK.
            for entry in ${SERVICES} ${CLI_TOOLS}; do
                local svc="${entry%%:*}"
                built_ok="${built_ok} ${svc}"
            done
        else
            cat "${_ws_log}" >>/tmp/iora-cargo-build.log
            log_warn "Workspace build failed — falling back to per-package builds for resilience."
            # Extract which packages failed from cargo's error output
            # so we only retry those individually.
            local _failed_pkgs
            _failed_pkgs=$(grep -oP 'could not compile `\K[^`]+' "${_ws_log}" 2>/dev/null | sort -u || true)

            for entry in ${SERVICES} ${CLI_TOOLS}; do
                local svc="${entry%%:*}"
                local svc_log="${CARGO_LOG_DIR}/${svc}.log"
                # Skip packages that already compiled fine in the workspace build.
                local _bin_cross="${CARGO_TARGET_DIR}/${RUST_TRIPLE}/release/${svc}"
                if [ -f "${_bin_cross}" ]; then
                    built_ok="${built_ok} ${svc}"
                    continue
                fi
                # If it wasn't in the failed list either, try building it.
                log_info "  cargo build -p ${svc} --release --target ${RUST_TRIPLE}"
                if ( cd "${BACKEND_DIR}" && \
                     cargo build --release --target "${RUST_TRIPLE}" -p "${svc}" \
                         --message-format=short ) \
                     >"${svc_log}" 2>&1; then
                    cat "${svc_log}" >>/tmp/iora-cargo-build.log
                    built_ok="${built_ok} ${svc}"
                    continue
                fi
                log_warn "    ${svc}: cross-compile failed."
                if [ "${_IORA_AUTO_MUSL:-0}" = "1" ]; then
                    log_warn "    ${svc}: BUILD FAILED (musl) — first 5 errors:"
                    grep -m 5 -E "^error" "${svc_log}" 2>/dev/null \
                        | sed 's/^/        /' || true
                    log_warn "    Hint: re-run with IORA_BUILD_BACKEND=docker to use the"
                    log_warn "          Alpine-based builder (musl + openssl pre-installed)."
                    built_fail="${built_fail} ${svc}"
                    continue
                fi
                log_warn "    ${svc}: trying host-native fallback…"
                if ( cd "${BACKEND_DIR}" && \
                     cargo build --release -p "${svc}" --message-format=short ) \
                     >>"${svc_log}" 2>&1; then
                    cat "${svc_log}" >>/tmp/iora-cargo-build.log
                    built_ok="${built_ok} ${svc}:hostnative"
                else
                    cat "${svc_log}" >>/tmp/iora-cargo-build.log
                    log_warn "    ${svc}: BUILD FAILED — first 5 errors:"
                    grep -m 5 -E "^error" "${svc_log}" 2>/dev/null \
                        | sed 's/^/        /' || true
                    built_fail="${built_fail} ${svc}"
                fi
            done
        fi

        if [ -n "${built_fail}" ]; then
            log_warn "The following services did NOT compile:${built_fail}"
            log_warn "Per-crate logs in ${CARGO_LOG_DIR}/<svc>.log"
            log_warn "Combined log: /tmp/iora-cargo-build.log"
            log_warn "The image will still be produced — failed services will stay INACTIVE on boot."
            log_warn "Fix the compile errors in backend/<svc>/ and re-run the build."
        fi

        local failed=0
        for svc in ${SERVICES}; do
            local dest="${OVERLAY}/${svc}/bin"
            mkdir -p "${dest}"

            local src_cross="${CARGO_TARGET_DIR}/${RUST_TRIPLE}/release/${svc}"
            local src_host="${CARGO_TARGET_DIR}/release/${svc}"
            local src=""
            if [ -f "${src_cross}" ]; then
                src="${src_cross}"
            elif [ -f "${src_host}" ]; then
                src="${src_host}"
            fi

            if [ -n "${src}" ]; then
                install -m 0755 "${src}" "${dest}/${svc}"
                rm -f "${dest}/.keep"
                log_success "  ${svc}: $(du -h "${dest}/${svc}" | cut -f1)"
            else
                log_warn "  ${svc}: no binary produced (see above)."
                rm -f "${dest}/${svc}"
                failed=$((failed + 1))
            fi
        done

        if [ "${failed}" -gt 0 ]; then
            log_warn "${failed} service binary/binaries missing after cargo build."
            log_warn "The resulting image will still boot; those services will stay INACTIVE"
            log_warn "(ConditionPathExists on /opt/iora/build/<svc>/bin/<svc> will fail)."
        else
            log_success "All IORA service binaries embedded in rootfs overlay (native build)."
        fi

        # ── CLI tools → /usr/bin ───────────────────────────────────────────
        local cli_dest="${SCRIPT_DIR}/board/iora/rootfs-overlay/usr/bin"
        mkdir -p "${cli_dest}"
        for entry in ${CLI_TOOLS}; do
            local cli="${entry%%:*}"
            local bin="${entry##*:}"
            local cli_src_cross="${CARGO_TARGET_DIR}/${RUST_TRIPLE}/release/${bin}"
            local cli_src_host="${CARGO_TARGET_DIR}/release/${bin}"
            local cli_src=""
            if [ -f "${cli_src_cross}" ]; then
                cli_src="${cli_src_cross}"
            elif [ -f "${cli_src_host}" ]; then
                cli_src="${cli_src_host}"
            fi
            if [ -n "${cli_src}" ]; then
                install -m 0755 "${cli_src}" "${cli_dest}/${bin}"
                log_success "  ${cli} → /usr/bin/${bin}"
            else
                log_warn "  ${cli}: not built (CLI tool unavailable on target)"
            fi
        done

        # ── glibc symbol audit ─────────────────────────────────────────────
        # Last-line-of-defence: scan every produced binary for GLIBC version
        # tags newer than what Buildroot 2024.02 ships (2.38). If found, the
        # binary will crash at boot — try to auto-recover by rebuilding the
        # offending services in Docker (Alpine/musl), where they get linked
        # against musl-libc and produce no GLIBC version tags at all.
        if command -v objdump >/dev/null 2>&1; then
            local _too_new=""
            local _too_new_svcs=""
            for svc in ${SERVICES}; do
                local _bin="${OVERLAY}/${svc}/bin/${svc}"
                [ -f "${_bin}" ] || continue
                local _max
                _max="$(objdump -T "${_bin}" 2>/dev/null \
                    | grep -oE 'GLIBC_[0-9]+\.[0-9]+' \
                    | sort -uV | tail -n 1 || true)"
                if [ -n "${_max}" ]; then
                    local _ver="${_max#GLIBC_}"
                    if awk -v v="${_ver}" 'BEGIN { exit !(v+0 > 2.38) }'; then
                        _too_new="${_too_new} ${svc}(${_max})"
                        _too_new_svcs="${_too_new_svcs} ${svc}"
                    fi
                fi
            done
            if [ -n "${_too_new}" ]; then
                log_warn "GLIBC compatibility AUDIT FAILED:${_too_new}"
                log_warn "These binaries reference glibc symbols newer than the target's 2.38."
                log_warn "They WILL crash at boot with 'GLIBC_2.XX not found'."
                # Attempt automatic recovery via the Docker/Alpine builder.
                # This rebuilds ONLY the affected services in a musl-linked
                # environment so the rest of the build (which already passed
                # the audit) is not redone.
                if [ "${IORA_GLIBC_AUDIT_NO_RECOVER:-0}" != "1" ] \
                    && command -v docker >/dev/null 2>&1 \
                    && [ -f "${BACKEND_DIR}/Dockerfile" ]; then
                    log_warn "Auto-recovery: rebuilding affected services in Docker (Alpine/musl)…"
                    if iora_docker_rebuild_services "${_too_new_svcs}"; then
                        # Re-audit after recovery so the build status reflects reality.
                        local _still_bad=""
                        for svc in ${_too_new_svcs}; do
                            local _bin="${OVERLAY}/${svc}/bin/${svc}"
                            [ -f "${_bin}" ] || { _still_bad="${_still_bad} ${svc}(missing)"; continue; }
                            local _max
                            _max="$(objdump -T "${_bin}" 2>/dev/null \
                                | grep -oE 'GLIBC_[0-9]+\.[0-9]+' \
                                | sort -uV | tail -n 1 || true)"
                            if [ -n "${_max}" ]; then
                                local _ver="${_max#GLIBC_}"
                                if awk -v v="${_ver}" 'BEGIN { exit !(v+0 > 2.38) }'; then
                                    _still_bad="${_still_bad} ${svc}(${_max})"
                                fi
                            fi
                        done
                        if [ -z "${_still_bad}" ]; then
                            log_success "GLIBC audit OK after Docker recovery — all binaries safe."
                        else
                            log_warn "GLIBC audit STILL FAILED after Docker recovery:${_still_bad}"
                            if [ "${IORA_GLIBC_AUDIT_FATAL:-0}" = "1" ]; then
                                log_error "IORA_GLIBC_AUDIT_FATAL=1 — aborting."
                                return 1
                            fi
                        fi
                    else
                        log_warn "Docker recovery failed; binaries WILL crash at boot."
                        if [ "${IORA_GLIBC_AUDIT_FATAL:-0}" = "1" ]; then
                            log_error "IORA_GLIBC_AUDIT_FATAL=1 — aborting."
                            return 1
                        fi
                    fi
                else
                    log_warn "Docker not available for auto-recovery."
                    log_warn "Re-run with IORA_BUILD_BACKEND=docker, or install Docker."
                    if [ "${IORA_GLIBC_AUDIT_FATAL:-0}" = "1" ]; then
                        log_error "IORA_GLIBC_AUDIT_FATAL=1 is set — aborting build."
                        return 1
                    fi
                fi
            else
                log_success "GLIBC audit OK — every binary stays within glibc 2.38 symbol set."
            fi
        fi

        return 0
        fi
    fi

    # We reach here when either cargo is unavailable OR auto-detect chose the
    # Docker path because of a host/target glibc mismatch. Only warn about
    # missing cargo if we genuinely tried to use it (not when Docker was the
    # explicit choice all along).
    if [ "${_IORA_BUILD_BACKEND}" != "docker" ]; then
        log_warn "cargo STILL not found after auto-install attempt."
        log_warn "Install the Rust toolchain manually (https://rustup.rs) and re-run the build,"
        log_warn "or set IORA_AUTO_INSTALL_RUST=1 and ensure curl is available."
    fi

    # ── Strategy 2: legacy Docker builder image ─────────────────────────────
    if [ ! -f "${BACKEND_DIR}/Dockerfile" ]; then
        log_warn "backend/Dockerfile not found at ${BACKEND_DIR}; cannot use Docker fallback."
        log_warn "Install rustc + cargo on the build host (e.g. 'sudo apt install cargo' or rustup),"
        log_warn "OR install docker, then re-run ./build.sh."
        log_warn "Without binaries, native IORA services will NOT start on boot."
        return 0
    fi

    if ! command -v docker >/dev/null 2>&1; then
        log_warn "Neither cargo nor docker available on build host."
        log_warn "Install the Rust toolchain (https://rustup.rs) and re-run the build."
        log_warn "Without binaries, native IORA services will NOT start on boot."
        return 0
    fi

    log_info "Pre-compiling IORA service binaries via Docker builder image..."
    log_info "Backend source: ${BACKEND_DIR}"

    local BUILDER_TAG="iora-builder-tmp:$(date +%s)"

    # Optional cache-busting flags. Set IORA_DOCKER_NOCACHE=1 if a previous
    # build cached an older Dockerfile/source layout and you want to force
    # rebuild everything from scratch. IORA_DOCKER_PULL=1 also re-pulls the
    # base image (rust:1.77-alpine) in case the registry has updates.
    local _docker_extra=""
    if [ "${IORA_DOCKER_NOCACHE:-0}" = "1" ]; then
        _docker_extra="${_docker_extra} --no-cache"
        log_info "  IORA_DOCKER_NOCACHE=1 → using --no-cache"
    fi
    if [ "${IORA_DOCKER_PULL:-0}" = "1" ]; then
        _docker_extra="${_docker_extra} --pull"
        log_info "  IORA_DOCKER_PULL=1 → using --pull"
    fi

    # Build the compilation stage only (--target builder) — avoids running
    # the runtime stages and is much faster on repeat builds if layer cache hits.
    # --progress=plain forces BuildKit to stream RUN stdout/stderr inline,
    # so cargo errors are visible (otherwise BuildKit hides them on success).
    log_info "docker build --target builder ${_docker_extra}..."
    # shellcheck disable=SC2086
    if ! docker build \
            --progress=plain \
            ${_docker_extra} \
            --target builder \
            --tag "${BUILDER_TAG}" \
            --file "${BACKEND_DIR}/Dockerfile" \
            "${BACKEND_DIR}"; then
        log_warn "Failed to build iora-builder image; skipping binary embedding."
        return 0
    fi

    # Diagnostic: list what actually got produced in the builder image so a
    # path mismatch (target/release/ vs target/<triple>/release/) or a
    # silently-failed cargo build is immediately visible instead of showing
    # up as 20 generic "binary not found" warnings further down.
    log_info "Builder image artefacts:"
    docker run --rm "${BUILDER_TAG}" sh -c '
        if [ -d /out ]; then
            echo "  /out:"
            ls -la /out 2>/dev/null | sed "s/^/    /" | head -n 40
        fi
        for d in /app/backend/target/release /app/backend/target/*/release; do
            [ -d "$d" ] || continue
            echo "  $d:"
            find "$d" -maxdepth 1 -type f -executable -printf "    %f (%s bytes)\n" 2>/dev/null \
                | head -n 40
        done' 2>&1 | sed 's/^/    /' || true

    local failed=0

    for svc in ${SERVICES}; do
        local dest="${OVERLAY}/${svc}/bin"
        mkdir -p "${dest}"

        log_info "  Extracting ${svc}..."
        # The builder Dockerfile copies all produced binaries to /out/ inside
        # the builder image (so they survive the cargo cache mount). Try /out
        # first, then fall back to the legacy target/ paths for older images.
        if docker run --rm "${BUILDER_TAG}" sh -c "\
                cat /out/${svc} 2>/dev/null \
             || cat /app/backend/target/x86_64-unknown-linux-musl/release/${svc} 2>/dev/null \
             || cat /app/backend/target/release/${svc} 2>/dev/null" \
                > "${dest}/${svc}" 2>/dev/null \
           && [ -s "${dest}/${svc}" ]; then
            chmod +x "${dest}/${svc}"
            log_success "  ${svc}: $(du -h "${dest}/${svc}" | cut -f1)"
        else
            log_warn "  ${svc}: binary not found in builder image (service may not be compiled yet)"
            rm -f "${dest}/${svc}"
            failed=$((failed + 1))
        fi
    done

    # Extract CLI tools to /usr/bin in the rootfs overlay.
    local cli_dest="${SCRIPT_DIR}/board/iora/rootfs-overlay/usr/bin"
    mkdir -p "${cli_dest}"
    for entry in ${CLI_TOOLS}; do
        local cli="${entry%%:*}"
        local bin="${entry##*:}"
        if docker run --rm "${BUILDER_TAG}" sh -c "\
                cat /out/${bin} 2>/dev/null \
             || cat /app/backend/target/x86_64-unknown-linux-musl/release/${bin} 2>/dev/null \
             || cat /app/backend/target/release/${bin} 2>/dev/null" \
                > "${cli_dest}/${bin}" 2>/dev/null \
           && [ -s "${cli_dest}/${bin}" ]; then
            chmod +x "${cli_dest}/${bin}"
            log_success "  ${cli} → /usr/bin/${bin}"
        else
            rm -f "${cli_dest}/${bin}"
            log_warn "  ${cli}: not extracted (CLI tool unavailable)"
        fi
    done

    # Clean up the temporary builder image
    docker rmi "${BUILDER_TAG}" >/dev/null 2>&1 || true

    if [ "${failed}" -gt 0 ]; then
        log_warn "${failed} service binary/binaries could not be extracted."
        log_warn "On-device first boot will fail for those services."
    else
        log_success "All IORA service binaries embedded in rootfs overlay."
    fi
}

# Build a specific subset of services in Docker (Alpine/musl) and extract the
# resulting binaries into the rootfs overlay. Used as auto-recovery when the
# native cargo build produces glibc-2.39 binaries that would crash at boot.
# Args: $1 = space-separated list of service names
iora_docker_rebuild_services() {
    local svcs="$1"
    [ -z "${svcs}" ] && return 0

    local BUILDER_TAG="iora-builder-recover:$(date +%s)"
    log_info "  docker build --target builder (recovery)…"
    if ! docker build --progress=plain --target builder \
            --tag "${BUILDER_TAG}" \
            --file "${BACKEND_DIR}/Dockerfile" \
            "${BACKEND_DIR}"; then
        log_warn "  Docker recovery build failed (image build error)."
        docker rmi "${BUILDER_TAG}" >/dev/null 2>&1 || true
        return 1
    fi

    local extracted=0
    for svc in ${svcs}; do
        local dest="${OVERLAY}/${svc}/bin"
        mkdir -p "${dest}"
        # Prefer /out/ (persisted past the cargo cache mount), fall back to
        # legacy target/ paths for older Dockerfile variants.
        if docker run --rm "${BUILDER_TAG}" sh -c "\
                cat /out/${svc} 2>/dev/null \
             || cat /app/backend/target/x86_64-unknown-linux-musl/release/${svc} 2>/dev/null \
             || cat /app/backend/target/release/${svc} 2>/dev/null" \
                > "${dest}/${svc}" 2>/dev/null \
           && [ -s "${dest}/${svc}" ]; then
            chmod +x "${dest}/${svc}"
            log_success "  ${svc}: rebuilt via Docker ($(du -h "${dest}/${svc}" | cut -f1))"
            extracted=$((extracted + 1))
        else
            log_warn "  ${svc}: Docker recovery produced no binary"
            rm -f "${dest}/${svc}"
        fi
    done
    docker rmi "${BUILDER_TAG}" >/dev/null 2>&1 || true
    [ "${extracted}" -gt 0 ]
}

create_iso_image() {
    log_info "Creating archive ISO image (not directly bootable)..."

    if [ ! -f "${RELEASE_DIR}/iora-os.img.xz" ]; then
        log_warn "iora-os.img.xz not found in release directory, skipping ISO"
        return
    fi

    local iso_tool=""
    if command -v xorriso &> /dev/null; then
        iso_tool="xorriso"
    elif command -v genisoimage &> /dev/null; then
        iso_tool="genisoimage"
    elif command -v mkisofs &> /dev/null; then
        iso_tool="mkisofs"
    else
        log_warn "No ISO creation tool available, skipping ISO"
        mark_skipped "iora-os-installer.iso (missing xorriso/genisoimage/mkisofs)"
        return
    fi

    local ISO_STAGE_DIR
    ISO_STAGE_DIR=$(mktemp -d)

    cp "${RELEASE_DIR}/iora-os.img.xz" "${ISO_STAGE_DIR}/"
    write_payload_metadata "${ISO_STAGE_DIR}"

    cat > "${ISO_STAGE_DIR}/INSTALL.txt" <<'EOF'
IORA OS installer/archive ISO

This ISO contains:
- iora-os.img.xz (compressed raw image)

Write image to disk:
  xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress
  sync

Replace /dev/sdX with your target device.
EOF

    if [ "${iso_tool}" = "xorriso" ]; then
        xorriso -as mkisofs -r -J -V "IORA_OS" -o "${RELEASE_DIR}/iora-os-installer.iso" "${ISO_STAGE_DIR}" >/dev/null 2>&1
    else
        "${iso_tool}" -r -J -V "IORA_OS" -o "${RELEASE_DIR}/iora-os-installer.iso" "${ISO_STAGE_DIR}" >/dev/null 2>&1
    fi

    rm -rf "${ISO_STAGE_DIR}"

    local size
    size=$(du -h "${RELEASE_DIR}/iora-os-installer.iso" | cut -f1)
    log_success "ISO created: iora-os-installer.iso (${size})"
    mark_created "iora-os-installer.iso"
}

resolve_installer_initrd() {
    if [ -f "${OUTPUT_DIR}/rootfs.cpio.gz" ]; then
        echo "${OUTPUT_DIR}/rootfs.cpio.gz"
        return 0
    fi

    if [ -f "${OUTPUT_DIR}/rootfs.cpio" ]; then
        if command -v gzip &> /dev/null; then
            local generated_cpio_gz="${OUTPUT_DIR}/rootfs.generated.cpio.gz"
            gzip -c "${OUTPUT_DIR}/rootfs.cpio" > "${generated_cpio_gz}"
            echo "${generated_cpio_gz}"
            return 0
        fi
    fi

    return 1
}

build_installer_runtime_initrd() {
    local source_initrd="$1"
    local runtime_initrd="$2"

    if ! command -v cpio &> /dev/null || ! command -v gzip &> /dev/null; then
        log_warn "cpio or gzip not available"
        return 1
    fi

    # Strategy: concatenate a tiny cpio containing /init AFTER the original
    # rootfs.cpio.gz. The Linux kernel initramfs loader processes multiple
    # concatenated cpio archives sequentially; later entries override earlier
    # ones. This means our /init replaces whatever init was in the original.
    #
    # This avoids extracting the original archive entirely, which fails on
    # non-root builds because cpio cannot mknod device nodes like /dev/console.
    # Concatenated gzip streams are valid gzip: cat a.gz b.gz | gunzip works.

    local work_dir
    work_dir=$(mktemp -d)

    cat > "${work_dir}/init" <<'INITEOF'
#!/bin/sh
export PATH=/sbin:/usr/sbin:/bin:/usr/bin
export TERM=linux
export NCURSES_NO_UTF8_ACS=1

# -- Mount virtual filesystems --------------------------------------
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t tmpfs tmpfs /tmp 2>/dev/null || true

if [ ! -e /dev/console ]; then
    mknod -m 600 /dev/console c 5 1 2>/dev/null || true
fi
if [ ! -e /dev/null ]; then
    mknod -m 666 /dev/null c 1 3 2>/dev/null || true
fi

mkdir -p /mnt/iso /mnt/target /tmp /run

# Load modules -- include both VirtIO (Proxmox/KVM) and VMware SCSI drivers.
# VMware Workstation/ESXi uses LSI Logic Parallel SCSI (mptspi) by default
# for virtual disks and CD-ROMs.  Without mptspi the SCSI CD-ROM never appears
# as /dev/sr0 and the installer silently fails to find the payload.
# mpt3sas covers LSI SAS adapters; vmw_pvscsi covers the VMware Paravirtual
# SCSI option; ata_piix handles VMware's emulated Intel IDE controller.
for mod in \
    scsi_mod cdrom sr_mod sd_mod \
    iso9660 isofs loop \
    ahci libahci libata \
    ata_piix \
    mptspi mpt3sas mpt2sas \
    vmw_pvscsi \
    virtio_blk virtio_pci virtio_scsi \
    vfat fat nls_cp437 nls_iso8859_1 nls_utf8; do
    modprobe "$mod" 2>/dev/null || true
done

# Give the kernel a moment to enumerate SCSI/SATA devices after loading
# the host-bus adapters above.  Without this brief pause the CD-ROM block
# device (/dev/sr0) may not yet be present when mount_iso() runs.
sleep 2
# Trigger a BusyBox mdev rescan if available (populates /dev from sysfs).
if command -v mdev >/dev/null 2>&1; then
    mdev -s 2>/dev/null || true
fi

# -- Configuration --------------------------------------------------
ISO_MOUNT="/mnt/iso"
ISO_IMAGE="iora-os.img.xz"
PAYLOAD_MODE="unknown"
PAYLOAD_BOOTABLE="unknown"
PAYLOAD_LAYOUT="unknown"
PAYLOAD_BOOT_MODE="unknown"
MIN_DISK_GB=8
if [ -f /etc/iora/os-dev-mode ]; then
    BACKTITLE="IORA OS Installer  *** DEV BUILD -- INTERNAL USE ONLY ***"
else
    BACKTITLE="IORA OS Installer  |  Use Tab/Arrow keys to navigate, Enter to confirm"
fi
IORA_HOSTNAME="iora"
IORA_TIMEZONE="Europe/Berlin"
IORA_NETWORK="dhcp"
IORA_LOCALE="en_US.UTF-8"
IORA_KEYBOARD="de"
IORA_INSTALL_MODE="guided"
IORA_USER=""
IORA_USER_PW=""
IORA_USER_FULLNAME=""
IORA_USER_SUDO=true
IORA_VIRT_TYPE="none"
IORA_VIRT_VENDOR=""
IORA_VIRT_CONTAINER="none"
IORA_VIRT_LABEL="Bare metal"

# Silence kernel log output that would pollute the UI
dmesg -n 1 2>/dev/null || echo 1 > /proc/sys/kernel/printk 2>/dev/null || true

# -- Dialog color theme (Ubuntu/Debian terminal-installer style) --
setup_dialog_theme() {
    cat > /tmp/.dialogrc <<'DLGRC'
# IORA OS installer -- clean Debian-installer style (red/white/blue)
aspect = 0
separate_widget = ""
tab_len = 4
visit_items = ON
use_shadow = ON
use_colors = ON
screen_color               = (WHITE,BLUE,ON)
shadow_color               = (BLACK,BLACK,ON)
dialog_color               = (BLACK,WHITE,OFF)
title_color                = (WHITE,RED,ON)
border_color               = (WHITE,WHITE,ON)
border2_color              = (WHITE,WHITE,ON)
button_active_color        = (WHITE,RED,ON)
button_inactive_color      = (BLACK,WHITE,OFF)
button_key_active_color    = (WHITE,RED,ON)
button_key_inactive_color  = (RED,WHITE,OFF)
button_label_active_color  = (WHITE,RED,ON)
button_label_inactive_color= (BLACK,WHITE,ON)
inputbox_color             = (BLACK,WHITE,OFF)
inputbox_border_color      = (WHITE,WHITE,ON)
searchbox_color            = (BLACK,WHITE,OFF)
searchbox_title_color      = (WHITE,RED,ON)
searchbox_border_color     = (WHITE,WHITE,ON)
position_indicator_color   = (WHITE,RED,ON)
menubox_color              = (BLACK,WHITE,OFF)
menubox_border_color       = (WHITE,WHITE,ON)
item_color                 = (BLACK,WHITE,OFF)
item_selected_color        = (WHITE,RED,ON)
tag_color                  = (RED,WHITE,ON)
tag_selected_color         = (WHITE,RED,ON)
tag_key_color              = (RED,WHITE,ON)
tag_key_selected_color     = (WHITE,RED,ON)
check_color                = (BLACK,WHITE,OFF)
check_selected_color       = (WHITE,RED,ON)
uarrow_color               = (WHITE,RED,ON)
darrow_color               = (WHITE,RED,ON)
itemhelp_color             = (WHITE,BLUE,OFF)
form_active_text_color     = (WHITE,RED,ON)
form_text_color            = (BLACK,WHITE,OFF)
form_item_readonly_color   = (WHITE,WHITE,ON)
gauge_color                = (WHITE,RED,ON)
DLGRC
    export DIALOGRC=/tmp/.dialogrc
}

# -- Dialog helpers -------------------------------------------------
DIALOG_BIN=""
if command -v dialog >/dev/null 2>&1; then
    DIALOG_BIN="dialog"
    setup_dialog_theme
elif command -v whiptail >/dev/null 2>&1; then
    DIALOG_BIN="whiptail"
fi

# Try to use the real terminal geometry; fall back to a roomy 24x80.
DLG_ROWS=24
DLG_COLS=80
if command -v stty >/dev/null 2>&1; then
    _sz=$(stty size 2>/dev/null)
    if [ -n "$_sz" ]; then
        DLG_ROWS=$(echo "$_sz" | awk '{print $1}')
        DLG_COLS=$(echo "$_sz" | awk '{print $2}')
        [ "$DLG_ROWS" -lt 20 ] 2>/dev/null && DLG_ROWS=24
        [ "$DLG_COLS" -lt 72 ] 2>/dev/null && DLG_COLS=80
    fi
fi

dlg() {
    if [ "$DIALOG_BIN" = "dialog" ]; then
        $DIALOG_BIN --ascii-lines --backtitle "$BACKTITLE" --colors "$@"
    else
        $DIALOG_BIN --backtitle "$BACKTITLE" "$@"
    fi
}

dlg_msg() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --msgbox "$1" 16 72
    else
        echo ""; echo "=== $title ==="; echo "$1"; echo ""
        echo "Press ENTER to continue..."; read _
    fi
}

dlg_yesno() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --defaultno --yesno "$1" 16 72
        return $?
    else
        echo ""; echo "=== $title ==="; echo "$1"
        printf "[y/n]: "; read ans
        case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
    fi
}

dlg_info() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --infobox "$1" 10 72
    else
        echo "$1"
    fi
}

dlg_input() {
    local title="$1"; local prompt="$2"; local default="$3"
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --inputbox "$prompt" 12 72 "$default" 3>&1 1>&2 2>&3
    else
        printf "  %s [%s]: " "$prompt" "$default"; read ans
        echo "${ans:-$default}"
    fi
}

is_uint() {
    case "$1" in
        ""|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

safe_uint() {
    if is_uint "$1"; then
        echo "$1"
    else
        echo "${2:-0}"
    fi
}

valid_hostname() {
    case "$1" in
        ""|*[!A-Za-z0-9-]*|-*|*-) return 1 ;;
        *) return 0 ;;
    esac
}

valid_ipv4() {
    local old_ifs octet
    old_ifs="$IFS"
    IFS=.
    set -- $1
    IFS="$old_ifs"

    [ $# -eq 4 ] || return 1
    for octet in "$@"; do
        is_uint "$octet" || return 1
        [ "$octet" -ge 0 ] && [ "$octet" -le 255 ] || return 1
    done
    return 0
}

valid_prefix_length() {
    is_uint "$1" || return 1
    [ "$1" -ge 1 ] && [ "$1" -le 32 ]
}

# -- System info helpers --------------------------------------------
get_cpu_info() {
    local model count
    model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')
    count=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "?")
    echo "${count}x ${model:-Unknown CPU}"
}

get_ram_info() {
    local total
    total=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "?")
    echo "${total} MB"
}

get_boot_mode() {
    if [ -d /sys/firmware/efi ]; then
        echo "UEFI"
    else
        echo "BIOS (Legacy)"
    fi
}

# -- Virtualization / container detection ---------------------------
# Detects hypervisor, VM platform, or container runtime without relying on
# systemd-detect-virt (which isn't present in the live installer initramfs).
# Sets global vars:
#   IORA_VIRT_TYPE   = none | kvm | qemu | vmware | virtualbox | hyperv |
#                      xen | bochs | parallels | microsoft | innotek
#   IORA_VIRT_VENDOR = human-friendly string (e.g. "Proxmox / KVM", "VMware")
#   IORA_VIRT_CONTAINER = none | lxc | docker | systemd-nspawn | openvz | wsl
#   IORA_VIRT_LABEL  = short label for UI ("Bare metal", "VM: VMware", ...)
detect_virtualization() {
    IORA_VIRT_TYPE="none"
    IORA_VIRT_VENDOR=""
    IORA_VIRT_CONTAINER="none"
    IORA_VIRT_LABEL="Bare metal"

    # -- Container detection first (containers can't run as VMs) --
    if [ -f /.dockerenv ] || grep -qa 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
        IORA_VIRT_CONTAINER="docker"
    elif [ -n "${container:-}" ]; then
        case "$container" in
            lxc|lxc-libvirt) IORA_VIRT_CONTAINER="lxc" ;;
            systemd-nspawn)  IORA_VIRT_CONTAINER="systemd-nspawn" ;;
            docker)          IORA_VIRT_CONTAINER="docker" ;;
            podman)          IORA_VIRT_CONTAINER="podman" ;;
            *)               IORA_VIRT_CONTAINER="$container" ;;
        esac
    elif grep -qa 'lxc\|lxcfs' /proc/1/cgroup 2>/dev/null; then
        IORA_VIRT_CONTAINER="lxc"
    elif [ -d /proc/vz ] && [ ! -d /proc/bc ]; then
        IORA_VIRT_CONTAINER="openvz"
    elif grep -qi 'microsoft\|wsl' /proc/sys/kernel/osrelease 2>/dev/null; then
        IORA_VIRT_CONTAINER="wsl"
    fi

    # -- Hypervisor detection via DMI (most reliable for x86 VMs) --
    local vendor="" product="" sys_vendor=""
    [ -r /sys/class/dmi/id/sys_vendor ]    && sys_vendor=$(tr -d '\0' < /sys/class/dmi/id/sys_vendor 2>/dev/null)
    [ -r /sys/class/dmi/id/product_name ]  && product=$(tr -d '\0' < /sys/class/dmi/id/product_name 2>/dev/null)
    [ -r /sys/class/dmi/id/bios_vendor ]   && vendor=$(tr -d '\0' < /sys/class/dmi/id/bios_vendor 2>/dev/null)

    case "${sys_vendor} ${product} ${vendor}" in
        *VMware*|*"VMware, Inc."*)
            IORA_VIRT_TYPE="vmware"
            IORA_VIRT_VENDOR="VMware (${product:-vSphere/Workstation})" ;;
        *VirtualBox*|*innotek*|*Oracle*VirtualBox*)
            IORA_VIRT_TYPE="virtualbox"
            IORA_VIRT_VENDOR="Oracle VirtualBox" ;;
        *QEMU*)
            IORA_VIRT_TYPE="qemu"
            IORA_VIRT_VENDOR="QEMU/KVM${product:+ (${product})}" ;;
        *Xen*)
            IORA_VIRT_TYPE="xen"
            IORA_VIRT_VENDOR="Xen${product:+ (${product})}" ;;
        *Microsoft*Hyper-V*|*"Microsoft Corporation Virtual Machine"*|*Hyper-V*)
            IORA_VIRT_TYPE="hyperv"
            IORA_VIRT_VENDOR="Microsoft Hyper-V" ;;
        *Parallels*)
            IORA_VIRT_TYPE="parallels"
            IORA_VIRT_VENDOR="Parallels" ;;
        *Bochs*)
            IORA_VIRT_TYPE="bochs"
            IORA_VIRT_VENDOR="Bochs/QEMU (TCG)" ;;
    esac

    # Proxmox VE heuristic: QEMU with ovmf/seabios + often product="Standard PC (Q35 + ICH9, 2009)"
    if [ "$IORA_VIRT_TYPE" = "qemu" ]; then
        if [ -r /sys/class/dmi/id/bios_version ]; then
            case "$(tr -d '\0' < /sys/class/dmi/id/bios_version 2>/dev/null)" in
                *pve*|*proxmox*|*Proxmox*)
                    IORA_VIRT_VENDOR="Proxmox VE (KVM)" ;;
            esac
        fi
    fi

    # -- Fallback: hypervisor CPUID flag in /proc/cpuinfo --
    if [ "$IORA_VIRT_TYPE" = "none" ] && grep -qa '^flags.*\bhypervisor\b' /proc/cpuinfo 2>/dev/null; then
        IORA_VIRT_TYPE="kvm"  # best-effort default when no DMI info is present
        IORA_VIRT_VENDOR="Unknown hypervisor (CPUID hypervisor flag set)"
    fi

    # -- Xen-specific: /sys/hypervisor/type --
    if [ -r /sys/hypervisor/type ]; then
        local hv; hv=$(tr -d '\0' < /sys/hypervisor/type 2>/dev/null)
        case "$hv" in
            xen) IORA_VIRT_TYPE="xen"; IORA_VIRT_VENDOR="Xen" ;;
        esac
    fi

    # -- Build label --
    if [ "$IORA_VIRT_CONTAINER" != "none" ]; then
        IORA_VIRT_LABEL="Container: ${IORA_VIRT_CONTAINER}"
    elif [ "$IORA_VIRT_TYPE" != "none" ]; then
        IORA_VIRT_LABEL="VM: ${IORA_VIRT_VENDOR:-$IORA_VIRT_TYPE}"
    else
        IORA_VIRT_LABEL="Bare metal"
    fi

    export IORA_VIRT_TYPE IORA_VIRT_VENDOR IORA_VIRT_CONTAINER IORA_VIRT_LABEL
}

get_network_interfaces() {
    local ifaces=""
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        local state=$(cat "$iface/operstate" 2>/dev/null || echo "unknown")
        local mac=$(cat "$iface/address" 2>/dev/null || echo "??:??:??:??:??:??")
        ifaces="${ifaces}  ${name}: ${state} (${mac})\n"
    done
    echo "${ifaces:-  No network interfaces found}"
}

# -- Mount the installation media -----------------------------------
mount_iso() {
    for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
        [ -b "$dev" ] || continue
        mount -t iso9660 -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || \
            mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    # Whole-disk block devices: when the installer ISO is written to a USB
    # stick with `dd`, the ISO9660 filesystem sits directly on the whole
    # disk (e.g. /dev/sda), not on a partition.  The pattern /dev/sd*[0-9]
    # below requires a trailing digit and would miss /dev/sda.  Try all
    # whole-disk SCSI/USB and VirtIO devices with iso9660 first.
    for dev in /dev/sd[a-z] /dev/sd[a-z][a-z] /dev/vd[a-z] /dev/vd[a-z][a-z]; do
        [ -b "$dev" ] || continue
        mount -t iso9660 -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    for dev in /dev/sd*[0-9] /dev/vd*[0-9] /dev/nvme*p[0-9]*; do
        [ -b "$dev" ] || continue
        mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    return 1
}

load_payload_metadata() {
    local metadata_file="${ISO_MOUNT}/PAYLOAD-METADATA"
    [ -f "$metadata_file" ] || return 1

    PAYLOAD_MODE=$(sed -n 's/^PAYLOAD_MODE=//p' "$metadata_file" 2>/dev/null | head -1)
    PAYLOAD_BOOTABLE=$(sed -n 's/^PAYLOAD_BOOTABLE=//p' "$metadata_file" 2>/dev/null | head -1)
    PAYLOAD_LAYOUT=$(sed -n 's/^PAYLOAD_LAYOUT=//p' "$metadata_file" 2>/dev/null | head -1)
    PAYLOAD_BOOT_MODE=$(sed -n 's/^PAYLOAD_BOOT_MODE=//p' "$metadata_file" 2>/dev/null | head -1)
    [ -n "$PAYLOAD_MODE" ] || PAYLOAD_MODE="unknown"
    [ -n "$PAYLOAD_BOOTABLE" ] || PAYLOAD_BOOTABLE="unknown"
    [ -n "$PAYLOAD_LAYOUT" ] || PAYLOAD_LAYOUT="unknown"
    [ -n "$PAYLOAD_BOOT_MODE" ] || PAYLOAD_BOOT_MODE="unknown"
    return 0
}

get_iso_parent_disk() {
    local iso_dev=""
    iso_dev=$(grep " ${ISO_MOUNT} " /proc/mounts 2>/dev/null | awk '{print $1}' | head -1)
    [ -z "$iso_dev" ] && return
    iso_dev=$(basename "$iso_dev")
    echo "$iso_dev" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//'
}

# -- Disk helpers ---------------------------------------------------
get_disks() {
    local iso_parent
    iso_parent=$(get_iso_parent_disk)
    for disk_path in /sys/block/sd* /sys/block/vd* /sys/block/nvme*; do
        [ -e "$disk_path" ] || continue
        local name=$(basename "$disk_path")
        case "$name" in sr*|loop*|ram*|zram*|dm-*|md*) continue ;; esac
        [ -n "$iso_parent" ] && [ "$name" = "$iso_parent" ] && continue
        local size_sectors=$(cat "${disk_path}/size" 2>/dev/null || echo 0)
        size_sectors=$(safe_uint "$size_sectors" 0)
        local size_gb=$(( size_sectors / 2097152 ))
        [ "$size_gb" -lt "$MIN_DISK_GB" ] && continue
        echo "$name"
    done
}

get_disk_size_gb() {
    local sz=$(cat "/sys/block/$1/size" 2>/dev/null || echo 0)
    sz=$(safe_uint "$sz" 0)
    echo $(( sz / 2097152 ))
}

get_disk_model() {
    cat "/sys/block/$1/device/model" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_vendor() {
    cat "/sys/block/$1/device/vendor" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_partitions() {
    local parts=0
    for p in /sys/block/$1/$1*; do [ -e "$p" ] && parts=$((parts + 1)); done
    echo "$parts"
}

get_disk_transport() {
    local link=$(readlink -f "/sys/block/$1" 2>/dev/null || true)
    case "$link" in
        *usb*)   echo "USB" ;;
        *ata*)   echo "SATA" ;;
        *nvme*)  echo "NVMe" ;;
        *virtio*) echo "VirtIO" ;;
        *scsi*)  echo "SCSI" ;;
        *)       echo "Unknown" ;;
    esac
}

disk_part_name() {
    case "$1" in
        nvme*|mmcblk*|loop*) echo "/dev/${1}p$2" ;;
        *) echo "/dev/${1}$2" ;;
    esac
}

has_mbr_boot_signature() {
    local sig=""
    sig=$(dd if="/dev/$1" bs=1 skip=510 count=2 2>/dev/null | od -An -tx1 | tr -d ' \n' || true)
    [ "$sig" = "55aa" ]
}

is_gpt_disk() {
    local disk="$1"
    if command -v sgdisk >/dev/null 2>&1; then
        sgdisk -p "/dev/${disk}" 2>/dev/null | grep -qi "GPT:" && return 0
    fi
    parted -s "/dev/${disk}" print 2>/dev/null | grep -qi "Partition Table: gpt"
}

find_installer_grub_install() {
    local candidate=""

    for candidate in /usr/sbin/grub-install /usr/bin/grub-install /sbin/grub-install /bin/grub-install; do
        [ -x "$candidate" ] && echo "$candidate" && return 0
    done

    candidate=$(command -v grub-install 2>/dev/null || true)
    [ -x "$candidate" ] && echo "$candidate" && return 0

    return 1
}

disk_has_existing_data() {
    local disk="$1"
    local parts=0
    parts=$(get_disk_partitions "$disk")
    parts=$(safe_uint "$parts" 0)
    [ "$parts" -gt 0 ] && return 0

    if command -v blkid >/dev/null 2>&1; then
        blkid "/dev/${disk}" >/dev/null 2>&1 && return 0
    fi

    if command -v wipefs >/dev/null 2>&1; then
        [ -n "$(wipefs -n "/dev/${disk}" 2>/dev/null)" ] && return 0
    fi

    return 1
}

target_has_bootloader() {
    local target="$1"
    [ -f "${target}/boot/grub/grub.cfg" ] && return 0
    [ -f "${target}/boot/grub2/grub.cfg" ] && return 0
    [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ] && return 0
    [ -f "${target}/boot/efi/EFI/ubuntu/grubx64.efi" ] && return 0
    [ -f "${target}/boot/efi/EFI/debian/grubx64.efi" ] && return 0
    [ -f "${target}/boot/extlinux/extlinux.conf" ] && return 0
    return 1
}

detect_target_root_partition() {
    local disk="$1"
    local p target_probe
    target_probe="/mnt/target-probe"
    mkdir -p "$target_probe"

    for p in $(seq 1 16); do
        local part fstype
        part=$(disk_part_name "$disk" "$p")
        [ -b "$part" ] || continue

        # Skip partitions that are almost certainly not root filesystems.
        if command -v blkid >/dev/null 2>&1; then
            fstype=$(blkid -s TYPE -o value "$part" 2>/dev/null || true)
            case "$fstype" in
                vfat|fat|msdos|iso9660|squashfs|swap)
                    continue
                    ;;
            esac
        fi

        mount "$part" "$target_probe" 2>/dev/null || continue
        if [ -f "${target_probe}/etc/os-release" ] || [ -x "${target_probe}/sbin/init" ] || [ -x "${target_probe}/bin/sh" ] || [ -f "${target_probe}/etc/passwd" ]; then
            umount "$target_probe" 2>/dev/null || true
            echo "$part"
            return 0
        fi
        umount "$target_probe" 2>/dev/null || true
    done

    return 1
}

# -- Disk repair & bootloader auto-repair -----------------------------------
# Called unconditionally after every dd-write.
# Mirrors what Ubuntu/Debian installers do post-write:
#   1. GPT header repair (sgdisk -e / gdisk / parted fix)
#   2. Kernel partition table reload
#   3. EFI partition filesystem repair (dosfsck)
#   4. GRUB reinstall with freshly-read PARTUUIDs
#   5. grub.cfg rewrite with real PARTUUIDs from the target disk
#   6. UEFI fallback loader copy (EFI/BOOT/BOOTX64.EFI)
#   7. Log every step to /tmp/boot-repair.log
repair_disk_and_bootloader() {
    local disk="$1"
    local logfile="/tmp/boot-repair.log"
    : > "$logfile"

    log_r() { echo "[$(date '+%H:%M:%S')] $*" >> "$logfile"; }

    log_r "=== IORA Boot Repair ==="
    log_r "Target: /dev/${disk}"

    # -- Step 1: GPT header repair -----------------------------------
    # When an 8 GB image is written to a larger disk the GPT backup
    # header is at the wrong offset. sgdisk -e relocates it to the
    # real disk end. Fall back to gdisk 'v' + 'w' if sgdisk missing.
    echo "  [1/7] GPT header repair..." >> "$logfile"
    if command -v sgdisk >/dev/null 2>&1; then
        sgdisk -e "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "sgdisk -e OK" \
            || log_r "sgdisk -e returned non-zero (may be ignorable)"
        sgdisk --verify "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "sgdisk verify OK" \
            || log_r "sgdisk verify: problems remain"
    elif command -v gdisk >/dev/null 2>&1; then
        # gdisk fallback: enter experts menu, relocate backup GPT header, write.
        printf 'x\ne\nm\nw\nY\n' | gdisk "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "gdisk expert fix OK" \
            || log_r "gdisk expert fix returned non-zero"
    else
        # parted can also rewrite GPT without questions
        parted -s "/dev/${disk}" print fix >> "$logfile" 2>&1 \
            && log_r "parted fix OK" \
            || log_r "parted fix returned non-zero"
        log_r "WARN: sgdisk not available; GPT backup-header may still be wrong"
    fi

    # -- Step 2: Re-read partition table ----------------------------
    echo "  [2/7] Refresh partition table..." >> "$logfile"
    sync
    blockdev --rereadpt "/dev/${disk}" >> "$logfile" 2>&1 || true
    partprobe "/dev/${disk}" >> "$logfile" 2>&1 || true
    sleep 2
    # Wait until expected partitions appear (up to 10 s)
    local waited=0
    while [ "$waited" -lt 10 ]; do
        local p2; p2=$(disk_part_name "$disk" 2)
        [ -b "$p2" ] && break
        sleep 1; waited=$((waited + 1))
    done
    log_r "Partition nodes present: $(ls /dev/${disk}* 2>/dev/null | tr '\n' ' ')"

    # -- Step 3: EFI filesystem repair ------------------------------
    local efi_part; efi_part=$(disk_part_name "$disk" 2)
    echo "  [3/7] EFI partition fsck..." >> "$logfile"
    if [ -b "$efi_part" ]; then
        if command -v dosfsck >/dev/null 2>&1; then
            dosfsck -a -r "$efi_part" >> "$logfile" 2>&1 \
                && log_r "dosfsck OK" \
                || log_r "dosfsck: errors found (attempted auto-fix)"
        elif command -v fsck.vfat >/dev/null 2>&1; then
            fsck.vfat -a "$efi_part" >> "$logfile" 2>&1 \
                && log_r "fsck.vfat OK" \
                || log_r "fsck.vfat: errors found (attempted auto-fix)"
        else
            log_r "No vfat fsck available - skipping"
        fi
    else
        log_r "EFI partition ${efi_part} not found - skipping"
    fi

    # -- Step 4: Mount EFI + root ------------------------------------
    echo "  [4/7] Mounting partitions..." >> "$logfile"
    local target="/mnt/repair-target"
    local efi_mounted=false
    local root_part=""
    root_part=$(detect_target_root_partition "$disk" 2>/dev/null || true)
    [ -z "$root_part" ] && root_part=$(disk_part_name "$disk" 3)

    # Ensure vfat driver is available for EFI partition
    modprobe vfat 2>/dev/null || true
    modprobe fat 2>/dev/null || true
    modprobe nls_cp437 2>/dev/null || true
    modprobe nls_iso8859_1 2>/dev/null || true
    modprobe nls_utf8 2>/dev/null || true

    mkdir -p "$target"

    if ! mount "$root_part" "$target" 2>>"$logfile"; then
        log_r "ERROR: cannot mount root partition ${root_part}"
        return 1
    fi
    log_r "Root mounted: ${root_part} -> ${target}"

    mkdir -p "${target}/boot/efi" 2>/dev/null || true

    if [ -b "$efi_part" ]; then
        # Load vfat driver - may be a module or built-in
        modprobe vfat      2>/dev/null || true
        modprobe fat       2>/dev/null || true
        modprobe nls_cp437 2>/dev/null || true
        modprobe nls_utf8  2>/dev/null || true

        if mount -t vfat "$efi_part" "${target}/boot/efi" 2>>"$logfile" || \
           mount          "$efi_part" "${target}/boot/efi" 2>>"$logfile"; then
            efi_mounted=true
            log_r "EFI mounted: ${efi_part} -> ${target}/boot/efi"
        else
            log_r "WARN: vfat mount failed - reformatting EFI partition to fix corrupted/unreadable filesystem"
            # If the vfat FS is unreadable (e.g. wrong offsets after image resize),
            # re-create it and reinstall GRUB from scratch.
            if command -v mkfs.vfat >/dev/null 2>&1 || command -v mkdosfs >/dev/null 2>&1; then
                local mkfscmd="mkdosfs"
                command -v mkfs.vfat >/dev/null 2>&1 && mkfscmd="mkfs.vfat"
                if ${mkfscmd} -F 32 -n EFI "$efi_part" >> "$logfile" 2>&1; then
                    log_r "EFI partition reformatted (FAT32)"
                    if mount -t vfat "$efi_part" "${target}/boot/efi" 2>>"$logfile"; then
                        efi_mounted=true
                        log_r "EFI mounted after reformat"
                    else
                        log_r "WARN: EFI mount still failing after reformat - UEFI boot may not work"
                    fi
                else
                    log_r "WARN: mkfs.vfat failed - EFI partition not accessible"
                fi
            else
                log_r "WARN: mkfs.vfat not available - cannot repair EFI partition"
                log_r "      Install dosfstools in the installer initramfs"
            fi
        fi
    fi

    # -- Step 5: Rewrite grub.cfg with real UUIDs --------------------
    echo "  [5/7] grub.cfg with real UUIDs..." >> "$logfile"
    local puuid_a="" puuid_b="" fsuuid_a="" fsuuid_b=""
    local pa pb
    pa=$(disk_part_name "$disk" 3)
    pb=$(disk_part_name "$disk" 4)
    if [ -b "$pa" ]; then
        puuid_a=$(blkid -s PARTUUID -o value "$pa" 2>/dev/null || true)
        fsuuid_a=$(blkid -s UUID     -o value "$pa" 2>/dev/null || true)
    fi
    if [ -b "$pb" ]; then
        puuid_b=$(blkid -s PARTUUID -o value "$pb" 2>/dev/null || true)
        fsuuid_b=$(blkid -s UUID     -o value "$pb" 2>/dev/null || true)
    fi

    local root_a_ref="/dev/sda3"
    local root_b_ref="/dev/sda4"
    [ -n "$puuid_a" ] && root_a_ref="PARTUUID=${puuid_a}"
    [ -n "$puuid_b" ] && root_b_ref="PARTUUID=${puuid_b}"

    log_r "Root-A: ${root_a_ref}  Root-B: ${root_b_ref}"

    # Prefer kernel under rootfs /boot; keep /vmlinuz fallback for legacy layouts.
    local kernel_path="/boot/vmlinuz"
    if [ ! -f "${target}/boot/vmlinuz" ] && [ -f "${target}/vmlinuz" ]; then
        kernel_path="/vmlinuz"
    elif [ ! -f "${target}/boot/vmlinuz" ] && [ -f "${target}/boot/bzImage" ]; then
        kernel_path="/boot/bzImage"
    fi
    log_r "Kernel: ${kernel_path}"

    # If the rootfs we just installed is a DEV build, surface that in
    # the GRUB menu titles so a quick reboot shows it loud and clear.
    local _menu_suffix=""
    if [ -f "${target}/etc/iora/os-dev-mode" ]; then
        _menu_suffix=" -- DEV BUILD (INTERNAL)"
        log_r "DEV build detected -- GRUB titles will be marked"
    fi

    # NOTE: grub.cfg is NOT shell. GRUB's `search` command does NOT
    # support --partuuid, and tokens like `2>/dev/null` or `|| true`
    # cause "syntax error / Incorrect command". Use --fs-uuid and the
    # `if search ...; then` conditional pattern instead.
    mkdir -p "${target}/boot/grub"
    cat > "${target}/boot/grub/grub.cfg" <<GRUBCFG
set default=0
set timeout=5

insmod part_gpt
insmod part_msdos
insmod ext2
insmod fat
insmod search
insmod search_fs_uuid
insmod search_fs_file
insmod linux
insmod echo
insmod all_video

menuentry "IORA OS${_menu_suffix}" {
    search --no-floppy --set=root --fs-uuid ${fsuuid_a:-00000000-0000-0000-0000-000000000000}
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${root_a_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${root_a_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    elif [ -f /boot/bzImage ]; then
        linux /boot/bzImage root=${root_a_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    fi
}

menuentry "IORA OS (second slot)${_menu_suffix}" {
    search --no-floppy --set=root --fs-uuid ${fsuuid_b:-00000000-0000-0000-0000-000000000000}
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${root_b_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${root_b_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    elif [ -f /boot/bzImage ]; then
        linux /boot/bzImage root=${root_b_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    fi
}

menuentry "IORA OS Recovery${_menu_suffix}" {
    search --no-floppy --set=root --fs-uuid ${fsuuid_a:-00000000-0000-0000-0000-000000000000}
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${root_a_ref} rootwait rw rootfstype=ext4 init=/bin/sh
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${root_a_ref} rootwait rw rootfstype=ext4 init=/bin/sh
    elif [ -f /boot/bzImage ]; then
        linux /boot/bzImage root=${root_a_ref} rootwait rw rootfstype=ext4 init=/bin/sh
    fi
}
GRUBCFG
    log_r "grub.cfg written"

    # Mirror grub.cfg + kernel to the ESP. The originally-shipped core.img
    # (from post-image.sh) has its prefix pointing at (,gpt2)/boot/grub -- if
    # the ESP was reformatted in Step 3 we must restore a working config
    # there, otherwise BIOS boot drops to a bare `grub>` prompt.
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/boot/grub" "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
        cp -f "${target}/boot/grub/grub.cfg" "${target}/boot/efi/boot/grub/grub.cfg" 2>/dev/null || true
        # Also provide a small redirect for any UEFI loader whose prefix is /EFI/BOOT.
        local _root_fsuuid
        _root_fsuuid=$(blkid -s UUID -o value "$root_part" 2>/dev/null || true)
        cat > "${target}/boot/efi/EFI/BOOT/grub.cfg" <<EFIREDIR
search --no-floppy --set=root --fs-uuid ${_root_fsuuid:-0}
set prefix=(\$root)/boot/grub
configfile \$prefix/grub.cfg
EFIREDIR
        # Restore kernel at /vmlinuz on the ESP (matches post-image.sh layout).
        if [ -s "${target}/boot/vmlinuz" ]; then
            cp -f "${target}/boot/vmlinuz" "${target}/boot/efi/vmlinuz" 2>/dev/null || true
        elif [ -s "${target}/vmlinuz" ]; then
            cp -f "${target}/vmlinuz" "${target}/boot/efi/vmlinuz" 2>/dev/null || true
        fi
        log_r "grub.cfg + vmlinuz mirrored to ESP"
    fi

    # -- Step 6: bind-mount proc/dev/sys and (re)install GRUB -------
    echo "  [6/7] GRUB reinstall..." >> "$logfile"
    local did_bind=false
    local bios_ok=false uefi_ok=false

    mkdir -p "${target}/dev" "${target}/proc" "${target}/sys" "${target}/run"
    if mount --bind /dev  "${target}/dev"  2>/dev/null && \
       mount --bind /proc "${target}/proc" 2>/dev/null && \
       mount --bind /sys  "${target}/sys"  2>/dev/null && \
       mount --bind /run  "${target}/run"  2>/dev/null; then
        did_bind=true
    fi

    local installer_grub_install=""
    installer_grub_install=$(find_installer_grub_install || true)

    if chroot "$target" /bin/sh -c "command -v grub-install >/dev/null 2>&1" 2>/dev/null; then
        # BIOS (i386-pc)
        if chroot "$target" /bin/sh -c \
            "grub-install --target=i386-pc --recheck --no-floppy /dev/${disk}" \
            >> "$logfile" 2>&1; then
            bios_ok=true; log_r "grub-install i386-pc OK"
        else
            log_r "grub-install i386-pc failed (may be UEFI-only system)"
        fi
        # UEFI (x86_64-efi)
        if [ "$efi_mounted" = true ] && [ -d /sys/firmware/efi ]; then
            if chroot "$target" /bin/sh -c \
                "grub-install --target=x86_64-efi --efi-directory=/boot/efi --boot-directory=/boot --removable --recheck /dev/${disk}" \
                >> "$logfile" 2>&1; then
                uefi_ok=true; log_r "grub-install x86_64-efi OK"
            else
                log_r "grub-install x86_64-efi failed"
            fi
        fi
        # grub-mkconfig
        chroot "$target" /bin/sh -c \
            "command -v grub-mkconfig >/dev/null 2>&1 && grub-mkconfig -o /boot/grub/grub.cfg" \
            >> "$logfile" 2>&1 || true
        log_r "grub-mkconfig done"
    elif [ -n "$installer_grub_install" ]; then
        log_r "grub-install not found in target; using installer copy: ${installer_grub_install}"
        if "$installer_grub_install" --target=i386-pc --boot-directory="${target}/boot" --recheck --no-floppy "/dev/${disk}" >> "$logfile" 2>&1; then
            bios_ok=true; log_r "installer grub-install i386-pc OK"
        else
            log_r "installer grub-install i386-pc failed"
        fi

        if [ "$efi_mounted" = true ] && [ -d /sys/firmware/efi ]; then
            if "$installer_grub_install" --target=x86_64-efi --efi-directory="${target}/boot/efi" --boot-directory="${target}/boot" --removable --recheck "/dev/${disk}" >> "$logfile" 2>&1; then
                uefi_ok=true; log_r "installer grub-install x86_64-efi OK"
            else
                log_r "installer grub-install x86_64-efi failed"
            fi
        fi
    else
        log_r "WARN: grub-install not found in target or installer - using pre-written grub.cfg only"

        # Last-resort fallback: grub-bios-setup + grub-mkimage from modules.
        # This can rebuild BIOS boot (MBR stage1 + BIOS boot partition core.img)
        # entirely from bundled grub modules, without needing grub-install.
        if [ -d /usr/lib/grub/i386-pc ] && command -v grub-mkimage >/dev/null 2>&1 \
           && command -v grub-bios-setup >/dev/null 2>&1; then
            log_r "Attempting BIOS install via grub-mkimage + grub-bios-setup"
            local core_img="/tmp/iora-core.img"
            if grub-mkimage -O i386-pc -o "${core_img}" -p /boot/grub \
                 biosdisk part_gpt part_msdos ext2 fat normal configfile \
                 linux search search_label search_fs_uuid search_fs_file echo \
                 boot chain ls help terminal >> "$logfile" 2>&1; then
                if grub-bios-setup --boot-image=boot.img --core-image="${core_img}" \
                     --directory=/usr/lib/grub/i386-pc \
                     --device-map=/dev/null "/dev/${disk}" >> "$logfile" 2>&1; then
                    bios_ok=true
                    log_r "grub-bios-setup OK (fallback core.img)"
                    mkdir -p "${target}/boot/grub/i386-pc" 2>/dev/null || true
                    cp -a /usr/lib/grub/i386-pc/*.mod "${target}/boot/grub/i386-pc/" 2>/dev/null || true
                    cp -a /usr/lib/grub/i386-pc/*.lst "${target}/boot/grub/i386-pc/" 2>/dev/null || true
                else
                    log_r "grub-bios-setup failed"
                fi
            else
                log_r "grub-mkimage failed"
            fi
        fi

        # UEFI fallback: build grubx64.efi from modules and drop it on the ESP.
        if [ "$efi_mounted" = true ] && [ -d /sys/firmware/efi ] \
           && [ -d /usr/lib/grub/x86_64-efi ] && command -v grub-mkimage >/dev/null 2>&1; then
            log_r "Attempting UEFI install via grub-mkimage"
            mkdir -p "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
            if grub-mkimage -O x86_64-efi -o "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" \
                 -p /boot/grub \
                 part_gpt part_msdos fat ext2 normal configfile linux \
                 search search_label search_fs_uuid search_fs_file echo \
                 boot chain efi_gop efi_uga gfxterm gfxmenu all_video \
                 ls help terminal >> "$logfile" 2>&1; then
                uefi_ok=true
                log_r "grub-mkimage BOOTX64.EFI OK (fallback)"
                mkdir -p "${target}/boot/grub/x86_64-efi" 2>/dev/null || true
                cp -a /usr/lib/grub/x86_64-efi/*.mod "${target}/boot/grub/x86_64-efi/" 2>/dev/null || true
            else
                log_r "grub-mkimage x86_64-efi failed"
            fi
        fi
    fi

    # -- Step 7: UEFI fallback loader --------------------------------
    echo "  [7/7] UEFI fallback loader..." >> "$logfile"
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
        local efi_src=""
        for _candidate in \
            "${target}/boot/efi/EFI/ubuntu/grubx64.efi" \
            "${target}/boot/efi/EFI/debian/grubx64.efi" \
            "${target}/boot/efi/EFI/grub/grubx64.efi" \
            "${target}/boot/efi/EFI/GRUB/grubx64.efi"; do
            [ -f "$_candidate" ] && efi_src="$_candidate" && break
        done
        if [ -n "$efi_src" ] && [ ! -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            cp -f "$efi_src" "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" 2>>"$logfile" \
                && log_r "BOOTX64.EFI copied from ${efi_src}" \
                || log_r "WARN: BOOTX64.EFI copy failed"
        elif [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            log_r "BOOTX64.EFI already present"
        else
            log_r "WARN: No grubx64.efi source found for UEFI fallback"
        fi

        # Presence of a removable UEFI loader is sufficient for UEFI boot attempt.
        if [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ] && [ -d /sys/firmware/efi ]; then
            uefi_ok=true
        fi

        # efibootmgr: register IORA OS boot entry if running in UEFI installer
        if command -v efibootmgr >/dev/null 2>&1 && [ -d /sys/firmware/efi ]; then
            local efi_disk_part; efi_disk_part=$(basename "$efi_part")
            local efi_part_num; efi_part_num=$(echo "$efi_disk_part" | grep -o '[0-9]*$')
            efibootmgr --create --disk "/dev/${disk}" \
                --part "$efi_part_num" \
                --label "IORA OS" \
                --loader "\\EFI\\BOOT\\BOOTX64.EFI" \
                >> "$logfile" 2>&1 \
                && log_r "efibootmgr entry created" \
                || log_r "efibootmgr failed (non-fatal)"
        fi
    fi

    # -- Cleanup -----------------------------------------------------
    [ "$efi_mounted" = true ] && umount "${target}/boot/efi" 2>/dev/null || true
    if [ "$did_bind" = true ]; then
        umount "${target}/run"  2>/dev/null || true
        umount "${target}/sys"  2>/dev/null || true
        umount "${target}/proc" 2>/dev/null || true
        umount "${target}/dev"  2>/dev/null || true
    fi
    sync
    umount "$target" 2>/dev/null || true

    # Only toggle active flag on DOS/MBR disks. Doing this on GPT mutates the PMBR
    # and creates warnings that can break EFI implementations.
    if ! is_gpt_disk "$disk"; then
        sfdisk --activate "/dev/${disk}" 1 >> "$logfile" 2>&1 \
            || parted -s "/dev/${disk}" set 1 boot on >> "$logfile" 2>&1 \
            || true
    else
        log_r "Skipping active-flag changes on GPT disk"
    fi

    # Final GPT verify
    if command -v sgdisk >/dev/null 2>&1; then
        sgdisk --verify "/dev/${disk}" >> "$logfile" 2>&1 \
            && log_r "Final GPT verify: OK" \
            || log_r "Final GPT verify: issues remain (check log)"
    fi

    # -- Final bootability assessment -------------------------------------
    # Our base image is built with working MBR + BIOS core.img + UEFI
    # BOOTX64.EFI at post-image time. After dd these remain bootable as long
    # as the GPT header and the MBR boot code are intact.
    #
    # BIOS: considered OK if
    #   (a) grub-install just succeeded, OR
    #   (b) MBR 0x55AA signature present AND either GPT has bios_grub partition
    #       OR MBR boot code region is non-zero (pre-installed stage1).
    if [ "$bios_ok" = false ]; then
        if has_mbr_boot_signature "$disk"; then
            local bios_reason=""
            if is_gpt_disk "$disk"; then
                # Check for bios_grub flag via sgdisk or parted.
                if command -v sgdisk >/dev/null 2>&1; then
                    if sgdisk -p "/dev/${disk}" 2>/dev/null | grep -qiE "EF02|BIOS[[:space:]]*boot"; then
                        bios_reason="bios_grub partition present"
                    fi
                fi
                if [ -z "$bios_reason" ] && command -v parted >/dev/null 2>&1; then
                    if parted -s "/dev/${disk}" print 2>/dev/null | grep -qi "bios_grub"; then
                        bios_reason="bios_grub flag set"
                    fi
                fi
            fi
            # Fallback: check MBR bootstrap code area (first 440 bytes) is non-zero.
            if [ -z "$bios_reason" ]; then
                local mbr_nonzero
                mbr_nonzero=$(dd if="/dev/${disk}" bs=1 count=440 2>/dev/null | tr -d '\0' | wc -c 2>/dev/null || echo 0)
                mbr_nonzero=$(safe_uint "$mbr_nonzero" 0)
                if [ "$mbr_nonzero" -gt 32 ]; then
                    bios_reason="pre-installed MBR boot code (${mbr_nonzero} non-zero bytes)"
                fi
            fi
            if [ -n "$bios_reason" ]; then
                bios_ok=true
                log_r "BIOS boot accepted: ${bios_reason}"
            fi
        fi
    fi

    # UEFI: OK if BOOTX64.EFI (removable fallback) exists on the ESP. We also
    # accept a distro-path grubx64.efi because firmware with NVRAM entries
    # uses those instead of the removable path.
    if [ "$uefi_ok" = false ]; then
        if [ -b "$efi_part" ]; then
            local esp_probe; esp_probe=$(mktemp -d 2>/dev/null || echo /tmp/esp-probe.$$)
            mkdir -p "$esp_probe" 2>/dev/null || true
            if mount -t vfat "$efi_part" "$esp_probe" 2>/dev/null; then
                for _efi in \
                    "$esp_probe/EFI/BOOT/BOOTX64.EFI" \
                    "$esp_probe/EFI/boot/bootx64.efi" \
                    "$esp_probe/EFI/ubuntu/grubx64.efi" \
                    "$esp_probe/EFI/debian/grubx64.efi" \
                    "$esp_probe/EFI/GRUB/grubx64.efi" \
                    "$esp_probe/EFI/grub/grubx64.efi"; do
                    if [ -f "$_efi" ]; then
                        uefi_ok=true
                        log_r "UEFI boot accepted: $(basename "$_efi") present on ESP"
                        break
                    fi
                done
                umount "$esp_probe" 2>/dev/null || true
            fi
            rmdir "$esp_probe" 2>/dev/null || true
        fi
    fi

    log_r "=== Boot repair complete ==="
    log_r "BIOS-boot: ${bios_ok}  UEFI-boot: ${uefi_ok}"

    # Expose result for callers that want to surface it in the UI.
    echo "${bios_ok}:${uefi_ok}" > /tmp/boot-repair.status 2>/dev/null || true

    # Final outcome: fail only when BOTH are not bootable.
    if [ "$bios_ok" = false ] && [ "$uefi_ok" = false ]; then
        log_r "ERROR: neither BIOS nor UEFI boot path is viable"
        return 2
    fi
    return 0
}

install_bootloader_fallback() {
    local disk="$1"
    local target="$2"
    local did_bind=false
    local efi_part=""
    local efi_mounted=false
    local bios_install_ok=false
    local uefi_install_ok=false
    local efi_has_loader=false
    local target_has_grub_install=false
    local installer_grub_install=""
    local boot_ok=1
    efi_part=$(disk_part_name "$disk" 2)
    installer_grub_install=$(find_installer_grub_install || true)

    mkdir -p "${target}/dev" "${target}/proc" "${target}/sys" "${target}/run" "${target}/boot/efi"
    mount --bind /dev "${target}/dev" 2>/dev/null || true
    mount --bind /proc "${target}/proc" 2>/dev/null || true
    mount --bind /sys "${target}/sys" 2>/dev/null || true
    mount --bind /run "${target}/run" 2>/dev/null || true
    did_bind=true

    if [ -b "$efi_part" ]; then
        modprobe vfat 2>/dev/null || true
        modprobe fat  2>/dev/null || true
        mount -t vfat "$efi_part" "${target}/boot/efi" 2>/dev/null && efi_mounted=true || \
        mount          "$efi_part" "${target}/boot/efi" 2>/dev/null && efi_mounted=true || true
    fi

    # -- Tier 1: target has grub-install (preferred, uses target's modules) --
    if chroot "$target" /bin/sh -c "command -v grub-install >/dev/null 2>&1" >/dev/null 2>&1; then
        target_has_grub_install=true

        if chroot "$target" /bin/sh -c "grub-install --target=i386-pc --recheck --no-floppy /dev/${disk}" >/dev/null 2>&1; then
            bios_install_ok=true
        fi

        if [ "$efi_mounted" = true ]; then
            if chroot "$target" /bin/sh -c \
                "grub-install --target=x86_64-efi --efi-directory=/boot/efi --boot-directory=/boot --removable --recheck /dev/${disk}" \
                >/dev/null 2>&1; then
                uefi_install_ok=true
            fi
            # Also register a distro path entry if we're running under UEFI.
            if [ -d /sys/firmware/efi ]; then
                chroot "$target" /bin/sh -c \
                    "grub-install --target=x86_64-efi --efi-directory=/boot/efi --boot-directory=/boot --bootloader-id=IORA --recheck /dev/${disk}" \
                    >/dev/null 2>&1 || true
            fi
        fi

        chroot "$target" /bin/sh -c \
            "command -v grub-mkconfig >/dev/null 2>&1 && grub-mkconfig -o /boot/grub/grub.cfg >/dev/null 2>&1 || true" \
            >/dev/null 2>&1 || true
    fi

    # -- Tier 2: installer-bundled grub-install (from HOST_DIR) --
    if [ "$target_has_grub_install" = false ] && [ -n "$installer_grub_install" ]; then
        if "$installer_grub_install" --target=i386-pc --boot-directory="${target}/boot" \
             --recheck --no-floppy "/dev/${disk}" >/dev/null 2>&1; then
            bios_install_ok=true
        fi
        if [ "$efi_mounted" = true ]; then
            if "$installer_grub_install" --target=x86_64-efi \
                 --efi-directory="${target}/boot/efi" --boot-directory="${target}/boot" \
                 --removable --recheck "/dev/${disk}" >/dev/null 2>&1; then
                uefi_install_ok=true
            fi
        fi
    fi

    # -- Tier 3: grub-mkimage + grub-bios-setup fallback (no grub-install) --
    if [ "$bios_install_ok" = false ] \
       && command -v grub-mkimage >/dev/null 2>&1 \
       && command -v grub-bios-setup >/dev/null 2>&1 \
       && [ -d /usr/lib/grub/i386-pc ]; then
        local core_img="/tmp/iora-core.img"
        if grub-mkimage -O i386-pc -o "${core_img}" -p /boot/grub \
             biosdisk part_gpt part_msdos ext2 fat normal configfile \
             linux search search_label search_fs_uuid search_fs_file echo \
             boot chain ls help terminal >/dev/null 2>&1; then
            mkdir -p "${target}/boot/grub/i386-pc" 2>/dev/null || true
            cp -a /usr/lib/grub/i386-pc/*.mod "${target}/boot/grub/i386-pc/" 2>/dev/null || true
            cp -a /usr/lib/grub/i386-pc/*.lst "${target}/boot/grub/i386-pc/" 2>/dev/null || true
            cp -f "${core_img}" "${target}/boot/grub/i386-pc/core.img" 2>/dev/null || true
            if grub-bios-setup --boot-image=boot.img --core-image="${core_img}" \
                 --directory=/usr/lib/grub/i386-pc \
                 --device-map=/dev/null "/dev/${disk}" >/dev/null 2>&1; then
                bios_install_ok=true
            fi
        fi
    fi

    # -- Tier 4: grub-mkimage UEFI BOOTX64.EFI fallback --
    if [ "$uefi_install_ok" = false ] && [ "$efi_mounted" = true ] \
       && command -v grub-mkimage >/dev/null 2>&1 \
       && [ -d /usr/lib/grub/x86_64-efi ]; then
        mkdir -p "${target}/boot/efi/EFI/BOOT" "${target}/boot/efi/EFI/IORA" 2>/dev/null || true
        if grub-mkimage -O x86_64-efi -o "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" \
             -p /boot/grub \
             part_gpt part_msdos fat ext2 normal configfile linux \
             search search_label search_fs_uuid search_fs_file echo \
             boot chain efi_gop efi_uga gfxterm gfxmenu all_video \
             ls help terminal >/dev/null 2>&1; then
            uefi_install_ok=true
            cp -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" \
                  "${target}/boot/efi/EFI/IORA/grubx64.efi" 2>/dev/null || true
            mkdir -p "${target}/boot/grub/x86_64-efi" 2>/dev/null || true
            cp -a /usr/lib/grub/x86_64-efi/*.mod "${target}/boot/grub/x86_64-efi/" 2>/dev/null || true
        fi
    fi

    # BIOS fallback: only set active flag on DOS/MBR disks. GPT uses bios_grub/ESP instead.
    if ! is_gpt_disk "$disk"; then
        sfdisk --activate "/dev/${disk}" 1 2>/dev/null || parted -s "/dev/${disk}" set 1 boot on 2>/dev/null || true
    fi

    # Keep removable-path fallback for UEFI firmware lookups (copy distro loader).
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
        if [ ! -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ]; then
            for _src in \
                "${target}/boot/efi/EFI/IORA/grubx64.efi" \
                "${target}/boot/efi/EFI/ubuntu/grubx64.efi" \
                "${target}/boot/efi/EFI/debian/grubx64.efi" \
                "${target}/boot/efi/EFI/grub/grubx64.efi" \
                "${target}/boot/efi/EFI/GRUB/grubx64.efi"; do
                if [ -f "$_src" ]; then
                    cp -f "$_src" "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" 2>/dev/null || true
                    break
                fi
            done
        fi

        if [ -f "${target}/boot/efi/EFI/BOOT/BOOTX64.EFI" ] \
           || [ -f "${target}/boot/efi/EFI/IORA/grubx64.efi" ] \
           || [ -f "${target}/boot/efi/EFI/ubuntu/grubx64.efi" ] \
           || [ -f "${target}/boot/efi/EFI/debian/grubx64.efi" ]; then
            efi_has_loader=true
        fi

        # Register an IORA OS NVRAM entry when running on UEFI firmware.
        if [ "$efi_has_loader" = true ] && [ -d /sys/firmware/efi ] \
           && command -v efibootmgr >/dev/null 2>&1; then
            local efi_part_num
            efi_part_num=$(echo "$(basename "$efi_part")" | grep -oE '[0-9]+$')
            if [ -n "$efi_part_num" ]; then
                efibootmgr --create --disk "/dev/${disk}" --part "$efi_part_num" \
                    --label "IORA OS" --loader '\EFI\BOOT\BOOTX64.EFI' \
                    >/dev/null 2>&1 || true
            fi
        fi
    fi

    # -- ALWAYS (re-)generate grub.cfg on the root partition and mirror it to
    # the ESP.  This is critical because:
    #   - post-image.sh originally wrote grub.cfg only on the ESP at
    #     /boot/grub/grub.cfg, expecting core.img's prefix to point there.
    #   - When we reinstall BIOS grub with --boot-directory="${target}/boot"
    #     the new core.img's prefix becomes (hd0,gpt3)/boot/grub/grub.cfg
    #     on the ROOT partition -- a path that didn't exist yet.
    #   - The resulting symptom is a bare "grub>" shell on boot.
    # We therefore write the same grub.cfg to every plausible search path.
    local _rootpart _part_a _part_b _partuuid_a _partuuid_b _root_a _root_b _fsuuid_a _fsuuid_b
    _rootpart=$(detect_target_root_partition "$disk" 2>/dev/null || true)
    _part_a=$(disk_part_name "$disk" 3)
    _part_b=$(disk_part_name "$disk" 4)
    _partuuid_a=$(blkid -s PARTUUID -o value "$_part_a" 2>/dev/null || true)
    _partuuid_b=$(blkid -s PARTUUID -o value "$_part_b" 2>/dev/null || true)
    _fsuuid_a=$(blkid -s UUID     -o value "$_part_a" 2>/dev/null || true)
    _fsuuid_b=$(blkid -s UUID     -o value "$_part_b" 2>/dev/null || true)
    if [ -n "$_partuuid_a" ]; then
        _root_a="PARTUUID=${_partuuid_a}"
    else
        _root_a="$_part_a"
    fi
    if [ -n "$_partuuid_b" ]; then
        _root_b="PARTUUID=${_partuuid_b}"
    else
        _root_b="$_part_b"
    fi

    # Mirror the DEV-build suffix from the primary grub.cfg writer above.
    local _menu_suffix2=""
    if [ -f "${target}/etc/iora/os-dev-mode" ]; then
        _menu_suffix2=" -- DEV BUILD (INTERNAL)"
    fi

    # Respect any LUKS-specific grub.cfg the encryption path already wrote.
    # NOTE: GRUB's `search` accepts --fs-uuid, NOT --partuuid. Shell tokens
    # like `2>/dev/null` or `|| true` are syntax errors in grub.cfg, and
    # there is no `search_part_uuid` module (that caused "Incorrect
    # command" on boot). Only use constructs grub actually understands.
    if [ ! -s "${target}/boot/grub/grub.cfg" ] \
       || ! grep -q 'iora_slot=' "${target}/boot/grub/grub.cfg" 2>/dev/null; then
        mkdir -p "${target}/boot/grub" 2>/dev/null || true
        cat > "${target}/boot/grub/grub.cfg" <<GRUBCFG
set default=0
set timeout=3

insmod part_gpt
insmod part_msdos
insmod ext2
insmod fat
insmod search
insmod search_fs_uuid
insmod search_fs_file
insmod linux
insmod echo
insmod all_video

menuentry "IORA OS${_menu_suffix2}" {
    search --no-floppy --set=root --fs-uuid ${_fsuuid_a:-00000000-0000-0000-0000-000000000000}
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${_root_a} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${_root_a} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    fi
}

menuentry "IORA OS (Partition B)${_menu_suffix2}" {
    search --no-floppy --set=root --fs-uuid ${_fsuuid_b:-00000000-0000-0000-0000-000000000000}
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${_root_b} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${_root_b} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
    fi
}

menuentry "IORA OS Recovery${_menu_suffix2}" {
    search --no-floppy --set=root --fs-uuid ${_fsuuid_a:-00000000-0000-0000-0000-000000000000}
    if [ -f /boot/vmlinuz ]; then
        linux /boot/vmlinuz root=${_root_a} rootwait rw rootfstype=ext4 init=/bin/bash
    elif [ -f /vmlinuz ]; then
        linux /vmlinuz root=${_root_a} rootwait rw rootfstype=ext4 init=/bin/bash
    fi
}
GRUBCFG
    fi

    # Mirror grub.cfg + kernel onto the ESP so UEFI loaders (prefix on ESP)
    # and any stage2 that searches ESP first also find a valid config.
    if [ "$efi_mounted" = true ]; then
        mkdir -p "${target}/boot/efi/boot/grub" "${target}/boot/efi/EFI/BOOT" 2>/dev/null || true
        cp -f "${target}/boot/grub/grub.cfg" \
              "${target}/boot/efi/boot/grub/grub.cfg" 2>/dev/null || true
        # Minimal redirect so a UEFI loader with prefix=/EFI/BOOT still works.
        cat > "${target}/boot/efi/EFI/BOOT/grub.cfg" <<EFIREDIR
search --no-floppy --set=root --fs-uuid $(blkid -s UUID -o value "$_rootpart" 2>/dev/null)
set prefix=(\$root)/boot/grub
configfile \$prefix/grub.cfg
EFIREDIR
        # Ensure a kernel exists at /vmlinuz on the ESP (post-image.sh's layout).
        if [ ! -s "${target}/boot/efi/vmlinuz" ] && [ -s "${target}/boot/vmlinuz" ]; then
            cp -f "${target}/boot/vmlinuz" "${target}/boot/efi/vmlinuz" 2>/dev/null || true
        fi
    fi

    if [ "$efi_mounted" = true ]; then
        umount "${target}/boot/efi" 2>/dev/null || true
    fi
    if [ "$did_bind" = true ]; then
        umount "${target}/run" 2>/dev/null || true
        umount "${target}/sys" 2>/dev/null || true
        umount "${target}/proc" 2>/dev/null || true
        umount "${target}/dev" 2>/dev/null || true
    fi
    sync

    if target_has_bootloader "$target" \
       || [ "$bios_install_ok" = true ] \
       || [ "$uefi_install_ok" = true ] \
       || [ "$efi_has_loader" = true ]; then
        boot_ok=0
    fi

    return "$boot_ok"
}

# -- Password hashing helper ----------------------------------------
# Set $user's password in $target/etc/shadow using the first hashing
# backend that works in the current installer environment. Tries, in
# order: mkpasswd, openssl passwd, python3 crypt, busybox cryptpw,
# chroot+chpasswd, chroot+passwd via expect-less stdin. Returns 0
# only when /etc/shadow actually contains the new hashed entry.
iora_hash_password() {
    local pw="$1"
    local salt hash
    salt=$(head -c 16 /dev/urandom 2>/dev/null | od -A n -t x1 \
           | tr -d ' \n' | cut -c1-16)
    [ -z "$salt" ] && salt="iorainstaller"

    # 1) mkpasswd (whois package on Debian/Ubuntu installers)
    if command -v mkpasswd >/dev/null 2>&1; then
        hash=$(printf '%s' "$pw" | mkpasswd -m sha-512 -s -S "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi

    # 2) openssl passwd -6 (SHA-512)
    if command -v openssl >/dev/null 2>&1; then
        hash=$(printf '%s' "$pw" | openssl passwd -6 -stdin -salt "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
        # Older openssl: try -1 (MD5)
        hash=$(printf '%s' "$pw" | openssl passwd -1 -stdin -salt "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi

    # 3) python3 crypt
    if command -v python3 >/dev/null 2>&1; then
        hash=$(PW="$pw" SALT="$salt" python3 -c '
import crypt, os, sys
try:
    h = crypt.crypt(os.environ["PW"], crypt.mksalt(crypt.METHOD_SHA512))
except Exception:
    h = crypt.crypt(os.environ["PW"], "$6$" + os.environ["SALT"])
sys.stdout.write(h or "")
' 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi

    # 4) busybox cryptpw
    if command -v cryptpw >/dev/null 2>&1; then
        hash=$(printf '%s' "$pw" | cryptpw -m sha512 -S "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi

    return 1
}

iora_set_account_password() {
    local target="$1"
    local user="$2"
    local pw="$3"
    local shadow="${target}/etc/shadow"
    [ -f "$shadow" ] || return 1
    [ -z "$user" ] && return 1
    [ -z "$pw" ] && return 1

    local hash
    hash=$(iora_hash_password "$pw") || hash=""

    if [ -n "$hash" ]; then
        # Rewrite the user's shadow line atomically. Use awk+FS=: to
        # avoid sed quoting pitfalls with the '$6$...' hash content.
        local tmp="${shadow}.iora.tmp"
        USER="$user" HASH="$hash" awk -F: -v OFS=: '
            BEGIN { u=ENVIRON["USER"]; h=ENVIRON["HASH"] }
            $1==u { $2=h; if ($3=="" || $3=="0") $3=19000 }
            { print }
        ' "$shadow" > "$tmp" 2>/dev/null && mv "$tmp" "$shadow" 2>/dev/null
        chmod 0640 "$shadow" 2>/dev/null || true
        if grep -q "^${user}:\$" "$shadow" 2>/dev/null; then
            : # empty password still -- fall through to chroot attempt
        elif grep -q "^${user}:[!*]" "$shadow" 2>/dev/null; then
            : # locked -- fall through
        else
            # Verify the hash is actually there.
            if grep -q "^${user}:[^:]\{8,\}:" "$shadow" 2>/dev/null; then
                return 0
            fi
        fi
    fi

    # Last-resort fallback: chroot into target and use chpasswd/passwd.
    # Requires /bin/sh inside the target; the IORA rootfs always has it.
    if [ -x "${target}/usr/sbin/chpasswd" ] || [ -x "${target}/usr/bin/chpasswd" ]; then
        # Bind-mount /dev, /proc, /sys so PAM/chpasswd work.
        local did_dev=false did_proc=false did_sys=false
        [ ! -e "${target}/dev/null" ] && mount --bind /dev "${target}/dev" 2>/dev/null && did_dev=true
        [ ! -e "${target}/proc/self" ] && mount --bind /proc "${target}/proc" 2>/dev/null && did_proc=true
        [ ! -e "${target}/sys/class" ] && mount --bind /sys "${target}/sys" 2>/dev/null && did_sys=true
        printf '%s:%s\n' "$user" "$pw" \
            | chroot "$target" /bin/sh -c 'chpasswd 2>/dev/null || passwd' >/dev/null 2>&1
        local rc=$?
        $did_dev  && umount "${target}/dev"  2>/dev/null || true
        $did_proc && umount "${target}/proc" 2>/dev/null || true
        $did_sys  && umount "${target}/sys"  2>/dev/null || true
        [ $rc -eq 0 ] && grep -q "^${user}:[^:!*]\{8,\}:" "$shadow" 2>/dev/null && return 0
    fi

    return 1
}

# -- Post-install configuration -------------------------------------
apply_post_install_config() {
    local disk="$1"
    local target="/mnt/target"

    dlg_info " Configuring " "  Applying settings..."

    # Probe partitions to find the installed root filesystem.
    local root_part=""
    root_part=$(detect_target_root_partition "$disk" 2>/dev/null || true)
    [ -z "$root_part" ] && root_part=$(disk_part_name "$disk" 3)
    [ -b "$root_part" ] || root_part=""

    if [ -z "$root_part" ]; then
        return 0  # skip silently if partition layout differs
    fi

    mkdir -p "$target"
    if ! mount "$root_part" "$target" 2>/dev/null; then
        return 0
    fi

    # Set hostname
    if [ -n "$IORA_HOSTNAME" ] && [ "$IORA_HOSTNAME" != "iora" ]; then
        echo "$IORA_HOSTNAME" > "${target}/etc/hostname" 2>/dev/null || true
        if [ -f "${target}/etc/hosts" ]; then
            sed -i "s/iora/${IORA_HOSTNAME}/g" "${target}/etc/hosts" 2>/dev/null || true
        fi
    fi

    # Set timezone
    if [ -n "$IORA_TIMEZONE" ] && [ -f "${target}/usr/share/zoneinfo/${IORA_TIMEZONE}" ]; then
        ln -sf "/usr/share/zoneinfo/${IORA_TIMEZONE}" "${target}/etc/localtime" 2>/dev/null || true
        echo "$IORA_TIMEZONE" > "${target}/etc/timezone" 2>/dev/null || true
    fi

    # Set root password if changed.
    # openssl may be missing in minimal installer environments and
    # `sed -i` can silently fail if /etc/shadow has unusual line
    # endings -> account would stay with empty/locked password and
    # the user's chosen password wouldn't work at login. Use the
    # robust helper which tries mkpasswd / openssl / python3 / busybox
    # cryptpw / chroot+chpasswd and verifies the shadow update.
    if [ -n "$IORA_ROOT_PW" ]; then
        iora_set_account_password "$target" "root" "$IORA_ROOT_PW" \
            || dlg_msg " Password Warning " "\
 Could not set the root password on the target disk.\n\
 Login will fall back to the default password.\n\n\
 You can reset it later from the installer's\n\
 Repair menu (Reset root password)."
    fi

    # Create an additional user account (Ubuntu/Debian-style)
    if [ -n "$IORA_USER" ] && [ -f "${target}/etc/passwd" ]; then
        if ! grep -q "^${IORA_USER}:" "${target}/etc/passwd" 2>/dev/null; then
            local uid=1000
            while grep -q ":${uid}:" "${target}/etc/passwd" 2>/dev/null; do
                uid=$((uid + 1))
            done
            local gid="$uid"
            echo "${IORA_USER}:x:${uid}:${gid}:${IORA_USER_FULLNAME:-${IORA_USER}}:/home/${IORA_USER}:/bin/sh" \
                >> "${target}/etc/passwd"
            echo "${IORA_USER}:x:${gid}:" >> "${target}/etc/group" 2>/dev/null || true
            # Create the shadow entry with a locked placeholder; the
            # real hash (if any) is applied immediately after via the
            # shared helper which handles the hashing fallbacks and
            # verifies the result.
            echo "${IORA_USER}:!:19000:0:99999:7:::" >> "${target}/etc/shadow" 2>/dev/null || true
            if [ -n "$IORA_USER_PW" ]; then
                iora_set_account_password "$target" "$IORA_USER" "$IORA_USER_PW" \
                    || dlg_msg " Password Warning " "\
 Could not set the password for '${IORA_USER}'.\n\
 The account has been created but is LOCKED.\n\
 Use 'passwd ${IORA_USER}' after first boot to set it."
            fi
            mkdir -p "${target}/home/${IORA_USER}" 2>/dev/null || true
            if [ -d "${target}/etc/skel" ]; then
                cp -a "${target}/etc/skel/." "${target}/home/${IORA_USER}/" 2>/dev/null || true
            fi
            chown -R "${uid}:${gid}" "${target}/home/${IORA_USER}" 2>/dev/null || true
            chmod 750 "${target}/home/${IORA_USER}" 2>/dev/null || true
            if [ "$IORA_USER_SUDO" = true ]; then
                # Add to wheel and sudo groups if they exist; create sudoers.d entry
                for grp in wheel sudo; do
                    if grep -q "^${grp}:" "${target}/etc/group" 2>/dev/null; then
                        sed -i "s|^\(${grp}:[^:]*:[^:]*:\)\(.*\)$|\1\2${IORA_USER},|; s|,,|,|g; s|,$||" \
                            "${target}/etc/group" 2>/dev/null || true
                    fi
                done
                mkdir -p "${target}/etc/sudoers.d" 2>/dev/null || true
                echo "${IORA_USER} ALL=(ALL) ALL" > "${target}/etc/sudoers.d/10-iora-user"
                chmod 440 "${target}/etc/sudoers.d/10-iora-user" 2>/dev/null || true
            fi
        fi
    fi

    # Configure network (IPv4 + IPv6). Use 10-* so it wins over the
    # built-in 90-iora-wired-default.network fallback.
    if [ "$IORA_NETWORK" = "dhcp" ]; then
        mkdir -p "${target}/etc/systemd/network" 2>/dev/null || true
        rm -f "${target}/etc/systemd/network/eth0.network" 2>/dev/null || true
        {
            echo "[Match]"
            echo "Name=eth* en* eno* ens* enp* enx*"
            echo "Type=ether"
            echo ""
            echo "[Network]"
            echo "DHCP=yes"
            echo "IPv6AcceptRA=yes"
            echo "LLMNR=no"
            echo "MulticastDNS=no"
            echo ""
            echo "[DHCPv4]"
            echo "ClientIdentifier=mac"
            echo "UseDNS=yes"
            echo "UseNTP=yes"
            echo "UseHostname=no"
            echo "RouteMetric=100"
            echo ""
            echo "[DHCPv6]"
            echo "UseDNS=yes"
            echo "UseNTP=yes"
            echo ""
            echo "[Link]"
            echo "RequiredForOnline=degraded"
        } > "${target}/etc/systemd/network/10-dhcp.network"
    elif [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        mkdir -p "${target}/etc/systemd/network" 2>/dev/null || true
        rm -f "${target}/etc/systemd/network/eth0.network" 2>/dev/null || true
        {
            echo "[Match]"
            echo "Name=eth* en* eno* ens* enp* enx*"
            echo "Type=ether"
            echo ""
            echo "[Network]"
            echo "Address=${IORA_IP}/${IORA_NETMASK:-24}"
            [ -n "${IORA_GATEWAY:-}" ] && echo "Gateway=${IORA_GATEWAY}"
            echo "DNS=${IORA_DNS:-8.8.8.8}"
            [ -n "${IORA_DNS2:-}" ]    && echo "DNS=${IORA_DNS2}"
            if [ -n "${IORA_IP6:-}" ]; then
                echo "Address=${IORA_IP6}/${IORA_PREFIX6:-64}"
                [ -n "${IORA_GATEWAY6:-}" ] && echo "Gateway=${IORA_GATEWAY6}"
                [ -n "${IORA_DNS6:-}" ]     && echo "DNS=${IORA_DNS6}"
                echo "IPv6AcceptRA=no"
            else
                echo "IPv6AcceptRA=yes"
            fi
            echo ""
            echo "[Link]"
            echo "RequiredForOnline=degraded"
        } > "${target}/etc/systemd/network/10-static.network"
    fi

    # Locale / keyboard defaults similar to common installers
    if [ -n "$IORA_LOCALE" ]; then
        mkdir -p "${target}/etc" 2>/dev/null || true
        if [ -f "${target}/etc/locale.conf" ] || [ ! -f "${target}/etc/default/locale" ]; then
            echo "LANG=${IORA_LOCALE}" > "${target}/etc/locale.conf" 2>/dev/null || true
        fi
        mkdir -p "${target}/etc/default" 2>/dev/null || true
        echo "LANG=${IORA_LOCALE}" > "${target}/etc/default/locale" 2>/dev/null || true
    fi

    if [ -n "$IORA_KEYBOARD" ]; then
        mkdir -p "${target}/etc" 2>/dev/null || true
        echo "KEYMAP=${IORA_KEYBOARD}" > "${target}/etc/vconsole.conf" 2>/dev/null || true
        mkdir -p "${target}/etc/default" 2>/dev/null || true
        cat > "${target}/etc/default/keyboard" <<KBDCONF
XKBMODEL="pc105"
XKBLAYOUT="${IORA_KEYBOARD}"
XKBVARIANT=""
XKBOPTIONS=""
BACKSPACE="guess"
KBDCONF
    fi

    local efi_part=""
    local efi_mounted=false
    efi_part=$(disk_part_name "$disk" 2)
    if [ -b "$efi_part" ]; then
        modprobe vfat 2>/dev/null || true
        modprobe fat  2>/dev/null || true
        mkdir -p "${target}/boot/efi" 2>/dev/null || true
        if mount -t vfat "$efi_part" "${target}/boot/efi" 2>/dev/null || \
           mount "$efi_part" "${target}/boot/efi" 2>/dev/null; then
            efi_mounted=true
        fi
    fi

    # Detect existing bootloader in the installed system; install only if missing.
    if target_has_bootloader "$target"; then
        dlg_info " Boot " "  Bootloader found."
    else
        dlg_info " Boot " "  No bootloader found. Installing..."
        if install_bootloader_fallback "$disk" "$target"; then
            dlg_info " Boot " "  Bootloader installed."
        else
            dlg_info " Boot " "  Bootloader install could not be confirmed."
        fi
    fi

    # Always run the full disk+bootloader repair pass afterwards. It is
    # idempotent: if everything is already correct, it's a no-op logged to
    # /tmp/boot-repair.log. It guarantees GPT integrity, BIOS MBR code and a
    # UEFI removable-path BOOTX64.EFI exist, and registers the IORA NVRAM
    # entry on UEFI firmware.
    if [ "$efi_mounted" = true ]; then
        umount "${target}/boot/efi" 2>/dev/null || true
        efi_mounted=false
    fi
    sync
    umount "$target" 2>/dev/null || true
    local repair_rc=0
    repair_disk_and_bootloader "$disk" || repair_rc=$?
    if [ "$repair_rc" -eq 2 ]; then
        dlg_msg " Boot Repair " "\
 WARNING: The final boot-repair pass reports that neither BIOS\n\
 nor UEFI boot could be confirmed on /dev/${disk}.\n\n\
 Check /tmp/boot-repair.log for details. You can drop to the\n\
 rescue shell and inspect the disk manually."
    fi
    sync
    return 0
}

# -- Wizard screens -------------------------------------------------

INSTALLER_MODE="install"   # install | rescue | shell

# True iff the running installer ISO is itself an IORA OS Dev build.
# We use this to plaster a DEV warning on the welcome screen so a tester
# can never confuse the dev installer with the production one.
is_iora_dev_iso() {
    [ -f /etc/iora/os-dev-mode ]
}

screen_welcome() {
    local _dev_warn=""
    if is_iora_dev_iso; then
        # Pure 7-bit ASCII -- the kernel framebuffer console with the
        # default 8x16 VGA font cannot render UTF-8 box-drawing or em
        # dashes (they showed up as "~U~T~U~P" / "~@~T" mojibake).
        _dev_warn=$(cat <<'DEVWARN'
 +------------------------------------------------------------------+
 |   *** IORA OS DEV BUILD -- INTERNAL USE ONLY ***                 |
 |   This installer image is NOT for production use.                |
 |   Installed systems will run the OS-dev hot-reload bridge.       |
 +------------------------------------------------------------------+

DEVWARN
)
    fi
    if [ -n "$DIALOG_BIN" ]; then
        local choice
        choice=$(dlg --title " IORA OS Installer " --menu "\
${_dev_warn} Welcome to IORA OS.\n\n\
 Use the arrow keys to navigate, Tab to switch\n\
 between the menu and the buttons, and Enter\n\
 to confirm your selection.\n" 24 72 4 \
            "install" "Install IORA OS on this computer" \
            "rescue"  "Rescue or repair an existing installation" \
            "shell"   "Drop to a rescue shell" \
            "reboot"  "Reboot or shut down" \
            3>&1 1>&2 2>&3)

        case "$choice" in
            install)
                INSTALLER_MODE="install"
                dlg --title " IORA OS Setup " --msgbox "\
 The guided installation will walk you through:\n\n\
     1. System inspection (CPU, RAM, disks, firmware)\n\
     2. Hostname, timezone, keyboard and locale\n\
     3. Network configuration (DHCP or static IPv4)\n\
     4. Root password and optional user account\n\
     5. Disk and partitioning options\n\
     6. Image installation and bootloader setup\n\n\
 Select OK to continue." 18 72
                return 0
                ;;
            rescue)
                INSTALLER_MODE="rescue"
                run_rescue_mode
                # After rescue exits, re-run the main menu.
                screen_welcome
                return 1
                ;;
            shell)
                INSTALLER_MODE="shell"
                clear 2>/dev/null || true
                echo ""
                echo "  IORA Rescue Shell.  Type 'exit' to return to the installer."
                echo ""
                sh -i || true
                screen_welcome
                return 1
                ;;
            reboot)
                local act
                act=$(dlg --title " Reboot " --menu \
                    "\n Choose action:\n" 12 60 2 \
                    "reboot"   "Reboot the machine" \
                    "poweroff" "Power off the machine" \
                    3>&1 1>&2 2>&3)
                case "$act" in
                    reboot)   sync; reboot -f ;;
                    poweroff) sync; poweroff -f ;;
                esac
                screen_welcome
                return 1
                ;;
            *)
                INSTALLER_MODE="install"
                return 0
                ;;
        esac
    else
        clear 2>/dev/null || true
        echo ""
        if is_iora_dev_iso; then
            echo "  *** IORA OS DEV BUILD -- INTERNAL USE ONLY ***"
            echo "  ============================================"
            echo "  Not for production use."
            echo ""
        fi
        echo "  IORA OS Setup"
        echo "  ============="
        echo ""
        echo "    1) Install IORA OS"
        echo "    2) Rescue / repair existing installation"
        echo "    3) Drop to shell"
        echo ""
        printf "  Choice [1-3]: "
        read _ch
        case "$_ch" in
            2) INSTALLER_MODE="rescue"; run_rescue_mode; screen_welcome; return 1 ;;
            3) INSTALLER_MODE="shell"; sh -i || true; screen_welcome; return 1 ;;
            *) INSTALLER_MODE="install" ;;
        esac
    fi
}

# -- Rescue mode ---------------------------------------------------------
# Finds an existing IORA installation, re-runs repair_disk_and_bootloader
# on it, optionally resets the root password, and dumps diagnostics.
run_rescue_mode() {
    # 1) Pick a disk that contains a plausible IORA install
    local disk_list candidates
    disk_list=$(get_disks)

    candidates=""
    for disk in $disk_list; do
        # Consider the disk a candidate if its 3rd partition looks like a
        # rootfs (ext4 with /etc/os-release).
        local p3 p3_probe
        p3=$(disk_part_name "$disk" 3)
        [ -b "$p3" ] || continue
        p3_probe="/mnt/rescue-probe"
        mkdir -p "$p3_probe"
        if mount -o ro "$p3" "$p3_probe" 2>/dev/null; then
            if [ -f "$p3_probe/etc/os-release" ]; then
                candidates="${candidates}${disk} "
            fi
            umount "$p3_probe" 2>/dev/null || true
        fi
    done

    if [ -z "$candidates" ]; then
        dlg_msg " No Installation Found " "\
 Could not locate an existing IORA OS installation on\n\
 any connected drive.\n\n\
 Tip: use 'Drop to shell' and mount manually if you\n\
 know where the root filesystem lives."
        return 1
    fi

    # 2) Disk picker
    local target_disk=""
    if [ -n "$DIALOG_BIN" ]; then
        set --
        for d in $candidates; do
            local sz mdl
            sz=$(get_disk_size_gb "$d")
            mdl=$(get_disk_model "$d")
            set -- "$@" "$d" "${sz}GB ${mdl}"
        done
        target_disk=$(dlg --title " Rescue - Select Disk " \
            --menu "\n Select the disk with the IORA installation to repair.\n" \
            18 64 6 "$@" 3>&1 1>&2 2>&3)
        [ -z "$target_disk" ] && return 1
    else
        target_disk=$(echo "$candidates" | awk '{print $1}')
    fi

    # 3) Rescue action menu
    while true; do
        local action
        if [ -n "$DIALOG_BIN" ]; then
            action=$(dlg --title " Rescue /dev/${target_disk} " --menu "\
 Choose a repair action.\n" 20 68 8 \
                "boot"    "Reinstall bootloader (GRUB + grub.cfg)" \
                "gpt"     "Repair GPT partition table" \
                "fsck"    "Run fsck on root partitions" \
                "passwd"  "Reset root password" \
                "chroot"  "Enter chroot shell in the installation" \
                "logs"    "Show /var/log/iora-netinstall.log from target" \
                "status"  "Show boot repair status" \
                "back"    "Back to main menu" \
                3>&1 1>&2 2>&3)
        else
            echo ""
            echo "  Rescue actions for /dev/${target_disk}:"
            echo "    1) Reinstall bootloader"
            echo "    2) Repair GPT"
            echo "    3) fsck"
            echo "    4) Reset root password"
            echo "    5) chroot"
            echo "    6) Back"
            printf "  Choice: "
            read _ra
            case "$_ra" in
                1) action=boot ;; 2) action=gpt ;; 3) action=fsck ;;
                4) action=passwd ;; 5) action=chroot ;; *) action=back ;;
            esac
        fi

        case "$action" in
            boot)
                dlg_info " Rescue " "  Running full boot repair on /dev/${target_disk}..."
                repair_disk_and_bootloader "$target_disk" >/tmp/rescue-boot.log 2>&1 || true
                dlg --title " Boot Repair Log " --textbox /tmp/boot-repair.log 22 78 2>/dev/null || {
                    clear; cat /tmp/boot-repair.log 2>/dev/null; echo "Press ENTER..."; read _
                }
                ;;
            gpt)
                (
                    if command -v sgdisk >/dev/null 2>&1; then
                        sgdisk -e "/dev/${target_disk}" 2>&1
                        sgdisk --verify "/dev/${target_disk}" 2>&1
                    else
                        parted -s "/dev/${target_disk}" print fix 2>&1
                    fi
                    sync
                    blockdev --rereadpt "/dev/${target_disk}" 2>/dev/null || true
                ) > /tmp/rescue-gpt.log 2>&1
                dlg --title " GPT Repair " --textbox /tmp/rescue-gpt.log 18 72 2>/dev/null || {
                    clear; cat /tmp/rescue-gpt.log; echo "Press ENTER..."; read _
                }
                ;;
            fsck)
                (
                    local p
                    for p in 3 4; do
                        local part
                        part=$(disk_part_name "$target_disk" "$p")
                        [ -b "$part" ] || continue
                        echo ">>> fsck $part"
                        e2fsck -f -y "$part" 2>&1 || true
                    done
                ) > /tmp/rescue-fsck.log 2>&1
                dlg --title " fsck Output " --textbox /tmp/rescue-fsck.log 22 78 2>/dev/null || {
                    clear; cat /tmp/rescue-fsck.log; echo "Press ENTER..."; read _
                }
                ;;
            passwd)
                rescue_reset_password "$target_disk"
                ;;
            chroot)
                rescue_chroot "$target_disk"
                ;;
            logs)
                local p3 mnt log_path
                p3=$(disk_part_name "$target_disk" 3)
                mnt="/mnt/rescue-target"
                mkdir -p "$mnt"
                if mount -o ro "$p3" "$mnt" 2>/dev/null; then
                    log_path="$mnt/var/log/iora-netinstall.log"
                    if [ -f "$log_path" ]; then
                        dlg --title " Netinstall Log " --textbox "$log_path" 22 78 2>/dev/null || {
                            clear; cat "$log_path"; echo "Press ENTER..."; read _
                        }
                    else
                        dlg_msg " No Log " "No netinstall log present on /dev/${target_disk}."
                    fi
                    umount "$mnt" 2>/dev/null || true
                fi
                ;;
            status)
                if [ -f /tmp/boot-repair.status ]; then
                    dlg_msg " Boot Status " "\
 Last boot repair status (BIOS:UEFI):\n\n\
   $(cat /tmp/boot-repair.status)\n\n\
 See /tmp/boot-repair.log for details."
                else
                    dlg_msg " No Status " "No boot repair has been run yet."
                fi
                ;;
            back|"")
                return 0
                ;;
        esac
    done
}

rescue_reset_password() {
    local disk="$1"
    local p3 mnt
    p3=$(disk_part_name "$disk" 3)
    mnt="/mnt/rescue-target"
    mkdir -p "$mnt"
    if ! mount "$p3" "$mnt" 2>/dev/null; then
        dlg_msg " Error " "Could not mount ${p3}. Is the disk encrypted?"
        return 1
    fi

    local pw1 pw2
    if [ -n "$DIALOG_BIN" ]; then
        pw1=$(dlg --title " New Root Password " --insecure --passwordbox \
            "\n Enter the new root password.\n" 10 60 3>&1 1>&2 2>&3)
        pw2=$(dlg --title " Confirm Password " --insecure --passwordbox \
            "\n Enter the password again.\n" 10 60 3>&1 1>&2 2>&3)
    else
        printf "  New root password: "; stty -echo; read pw1; stty echo; echo
        printf "  Confirm:           "; stty -echo; read pw2; stty echo; echo
    fi

    if [ -z "$pw1" ] || [ "$pw1" != "$pw2" ]; then
        dlg_msg " Error " "Passwords empty or did not match."
        umount "$mnt" 2>/dev/null || true
        return 1
    fi

    # Write hashed password directly into /etc/shadow
    local hash
    if command -v openssl >/dev/null 2>&1; then
        hash=$(openssl passwd -6 "$pw1" 2>/dev/null || true)
    fi
    if [ -z "$hash" ] && command -v mkpasswd >/dev/null 2>&1; then
        hash=$(mkpasswd -m sha-512 "$pw1" 2>/dev/null || true)
    fi
    if [ -z "$hash" ]; then
        # Try chroot + passwd as last resort.
        mkdir -p "$mnt/dev" "$mnt/proc" "$mnt/sys"
        mount --bind /dev "$mnt/dev"  2>/dev/null || true
        mount --bind /proc "$mnt/proc" 2>/dev/null || true
        mount --bind /sys "$mnt/sys"  2>/dev/null || true
        printf '%s\n%s\n' "$pw1" "$pw1" | chroot "$mnt" passwd root >/dev/null 2>&1 || true
        umount "$mnt/sys" "$mnt/proc" "$mnt/dev" 2>/dev/null || true
        umount "$mnt" 2>/dev/null || true
        dlg_msg " Done " "Password reset attempted via chroot passwd."
        return 0
    fi

    if [ -f "$mnt/etc/shadow" ]; then
        # Escape / and & for sed replacement side
        local esc
        esc=$(printf '%s\n' "$hash" | sed -e 's/[\/&]/\\&/g')
        sed -i "s/^root:[^:]*:/root:${esc}:/" "$mnt/etc/shadow"
        sync
        dlg_msg " Done " "Root password reset on /dev/${disk}."
    else
        dlg_msg " Error " "/etc/shadow not found on ${p3}."
    fi
    umount "$mnt" 2>/dev/null || true
}

rescue_chroot() {
    local disk="$1"
    local p3 mnt
    p3=$(disk_part_name "$disk" 3)
    mnt="/mnt/rescue-target"
    mkdir -p "$mnt"
    if ! mount "$p3" "$mnt" 2>/dev/null; then
        dlg_msg " Error " "Could not mount ${p3}."
        return 1
    fi

    local p2
    p2=$(disk_part_name "$disk" 2)
    if [ -b "$p2" ]; then
        mkdir -p "$mnt/boot/efi"
        mount -t vfat "$p2" "$mnt/boot/efi" 2>/dev/null || true
    fi

    mkdir -p "$mnt/dev" "$mnt/proc" "$mnt/sys" "$mnt/run"
    mount --bind /dev  "$mnt/dev"  2>/dev/null || true
    mount --bind /proc "$mnt/proc" 2>/dev/null || true
    mount --bind /sys  "$mnt/sys"  2>/dev/null || true
    mount --bind /run  "$mnt/run"  2>/dev/null || true

    clear 2>/dev/null || true
    echo ""
    echo "  Entering chroot at ${mnt}."
    echo "  Type 'exit' to leave."
    echo ""
    chroot "$mnt" /bin/sh -l || chroot "$mnt" /bin/sh || true

    umount "$mnt/run"  2>/dev/null || true
    umount "$mnt/sys"  2>/dev/null || true
    umount "$mnt/proc" 2>/dev/null || true
    umount "$mnt/dev"  2>/dev/null || true
    umount "$mnt/boot/efi" 2>/dev/null || true
    umount "$mnt" 2>/dev/null || true
}

screen_sysinfo() {
    [ -z "$DIALOG_BIN" ] && return 0

    local cpu=$(get_cpu_info)
    local ram=$(get_ram_info)
    local boot=$(get_boot_mode)
    local net=$(get_network_interfaces)

    local ver_line=""
    if [ -f "${ISO_MOUNT}/VERSION" ]; then
        ver_line=$(head -3 "${ISO_MOUNT}/VERSION" 2>/dev/null | tr '\n' ' ')
    fi

    dlg --title " System Information " --msgbox "\
 Hardware
 --------
 CPU:       ${cpu}
 Memory:    ${ram}
 Boot:      ${boot}
 Platform:  ${IORA_VIRT_LABEL}

 Network Interfaces
 ------------------
${net}
 Image
 -----
 Package:   Installation payload (${img_size})
 Layout:    ${PAYLOAD_LAYOUT}
 ${ver_line}" 23 64
}

screen_hostname() {
    if [ -z "$DIALOG_BIN" ]; then
        while true; do
            printf "  Hostname [iora]: "; read ans
            ans="${ans:-iora}"
            if valid_hostname "$ans"; then
                IORA_HOSTNAME="$ans"
                return 0
            fi
            echo "  Invalid hostname. Use only letters, numbers, and hyphens."
        done
    fi

    while true; do
        local result
        result=$(dlg --title " Hostname " --inputbox \
            "\n Choose a hostname for this device.\n\n Allowed: letters, numbers, hyphens.\n" \
            12 60 "$IORA_HOSTNAME" 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 0

        if valid_hostname "$result"; then
            IORA_HOSTNAME="$result"
            return 0
        fi

        dlg_msg " Invalid Hostname " "Use only letters, numbers, and hyphens."
    done
}

screen_timezone() {
    [ -z "$DIALOG_BIN" ] && return 0

    local tz
    tz=$(dlg --title " Timezone " --menu \
        "\n Select the system timezone.\n" 20 60 10 \
        "Europe/Berlin"    "Germany" \
        "Europe/Vienna"    "Austria" \
        "Europe/Zurich"    "Switzerland" \
        "Europe/London"    "United Kingdom" \
        "Europe/Paris"     "France" \
        "Europe/Amsterdam" "Netherlands" \
        "Europe/Rome"      "Italy" \
        "Europe/Madrid"    "Spain" \
        "US/Eastern"       "US East Coast" \
        "US/Pacific"       "US West Coast" \
        "UTC"              "Coordinated Universal Time" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$tz" ] && IORA_TIMEZONE="$tz"
}

screen_locale() {
    [ -z "$DIALOG_BIN" ] && return 0

    local locale
    locale=$(dlg --title " Language " --menu \
        "\n Select the system language/locale.\n" 18 60 8 \
        "de_DE.UTF-8" "German" \
        "en_US.UTF-8" "English (US)" \
        "en_GB.UTF-8" "English (UK)" \
        "fr_FR.UTF-8" "French" \
        "es_ES.UTF-8" "Spanish" \
        "it_IT.UTF-8" "Italian" \
        "nl_NL.UTF-8" "Dutch" \
        "pl_PL.UTF-8" "Polish" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$locale" ] && IORA_LOCALE="$locale"
}

screen_keyboard() {
    [ -z "$DIALOG_BIN" ] && return 0

    local kb
    kb=$(dlg --title " Keyboard Layout " --menu \
        "\n Select the keyboard layout.\n" 16 60 7 \
        "de" "German" \
        "us" "English (US)" \
        "gb" "English (UK)" \
        "fr" "French" \
        "es" "Spanish" \
        "it" "Italian" \
        "nl" "Dutch" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$kb" ] && IORA_KEYBOARD="$kb"
}

screen_installation_type() {
    [ -z "$DIALOG_BIN" ] && return 0

    local mode
    mode=$(dlg --title " Installation Type " --menu \
        "\n Choose installation type.\n" 15 64 3 \
        "guided" "Guided - erase selected disk and install" \
        "guided-safe" "Guided - ask extra confirmation before erase" \
        "shell" "Manual - drop to shell for custom partitioning" \
        3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    IORA_INSTALL_MODE="$mode"
    if [ "$mode" = "shell" ]; then
        dlg_msg " Manual Mode " "\
 You selected manual mode.\n\n\
 The installer will return to shell now.\n\n\
 After preparing disks manually, run 'install' again."
        return 1
    fi
    return 0
}

screen_network() {
    [ -z "$DIALOG_BIN" ] && return 0

    local mode
    mode=$(dlg --title " Network " --menu \
        "\n Choose how IORA OS should configure networking.\n" 15 60 3 \
        "dhcp"   "Automatic via DHCP" \
        "static" "Manual IPv4 configuration" \
        "skip"   "Leave networking unchanged" \
        3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    IORA_NETWORK="$mode"

    if [ "$mode" = "dhcp" ]; then
        # Bring up the network and try to acquire a DHCP lease in the
        # installer environment so the user can see which IP was assigned
        # (and use it to reach the setup wizard after first boot).
        local dhcp_ip=""
        for _iface in /sys/class/net/*; do
            local _ifname
            _ifname=$(basename "$_iface")
            [ "$_ifname" = "lo" ] && continue
            ip link set "$_ifname" up 2>/dev/null || true
            if udhcpc -i "$_ifname" -n -q -t 4 2>/dev/null; then
                dhcp_ip=$(ip -4 addr show "$_ifname" 2>/dev/null \
                    | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
                [ -n "$dhcp_ip" ] && break
            fi
        done
                if [ -n "$dhcp_ip" ]; then
            dlg_msg " Network - DHCP " "\
 A temporary DHCP lease was obtained in the installer environment.\n\n\
 Installer IP now:  ${dhcp_ip}\n\n\
 IORA OS will request DHCP again after installation. It now uses a\n\
 MAC-based client identifier to improve lease stability, but the DHCP\n\
 server may still choose a different address after reboot.\n\n\
 After first boot, verify the final URL in the MOTD/login prompt:\n\
     http://<shown-ip>:8080"
        else
            dlg_msg " Network - DHCP " "\
 DHCP will be configured automatically on first boot.\n\n\
 The assigned IP address will be shown in the MOTD\n\
 when you log in, and at http://<IP>:8080."
        fi
    fi

    if [ "$mode" = "static" ]; then
        while true; do
            IORA_IP=$(dlg --title " Static IPv4 " --inputbox \
                "\n Enter the IPv4 address for this device.\n" \
                10 60 "${IORA_IP:-192.168.1.100}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_IP" && break
            dlg_msg " Invalid Address " "Enter a valid IPv4 address such as 192.168.1.100."
        done

        while true; do
            IORA_NETMASK=$(dlg --title " Prefix Length " --inputbox \
                "\n Enter the subnet prefix length.\n Example: 24\n" \
                10 60 "${IORA_NETMASK:-24}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_prefix_length "$IORA_NETMASK" && break
            dlg_msg " Invalid Prefix " "Enter a number between 1 and 32."
        done

        while true; do
            IORA_GATEWAY=$(dlg --title " Gateway " --inputbox \
                "\n Enter the default gateway IPv4 address.\n" \
                10 60 "${IORA_GATEWAY:-192.168.1.1}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_GATEWAY" && break
            dlg_msg " Invalid Gateway " "Enter a valid IPv4 address such as 192.168.1.1."
        done

        while true; do
            IORA_DNS=$(dlg --title " DNS Server " --inputbox \
                "\n Enter the preferred DNS server IPv4 address.\n" \
                10 60 "${IORA_DNS:-8.8.8.8}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_DNS" && break
            dlg_msg " Invalid DNS " "Enter a valid IPv4 address such as 8.8.8.8."
        done
    fi
}

screen_password() {
    [ -z "$DIALOG_BIN" ] && return 0

    local pw1 pw2 rc

    # Loop until the user either (a) enters two matching passwords,
    # (b) submits an empty password (keep default), or (c) cancels.
    # Cancel returns non-zero so the wizard's cancel menu shows up
    # (retry / back / jump / shell / reboot / abort) instead of
    # silently advancing to the next step.
    while true; do
        pw1=$(dlg --title " Root Password " --insecure --passwordbox \
            "\n Set a new root password.\n Leave this blank to keep the default.\n" \
            12 60 3>&1 1>&2 2>&3)
        rc=$?
        [ $rc -ne 0 ] && return 1
        [ -z "$pw1" ] && return 0

        pw2=$(dlg --title " Confirm Password " --insecure --passwordbox \
            "\n Enter the password again for verification.\n" \
            10 60 3>&1 1>&2 2>&3)
        rc=$?
        [ $rc -ne 0 ] && return 1

        if [ "$pw1" = "$pw2" ]; then
            IORA_ROOT_PW="$pw1"
            return 0
        fi

        dlg_msg " Password Mismatch " "\
 The passwords do not match.\n\n\
 Please enter the password and the confirmation again."
    done
}

screen_user() {
    [ -z "$DIALOG_BIN" ] && return 0

    local name full pw1 pw2 sudo_choice

    name=$(dlg --title " Create User " --inputbox \
        "\n Enter a username for a new login account.\n Leave empty to skip (root-only system).\n" \
        12 60 "" 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0
    [ -z "$name" ] && return 0

    # POSIX username validation
    if ! echo "$name" | grep -Eq '^[a-z_][a-z0-9_-]{0,31}$'; then
        dlg_msg " Invalid Username " "\
 Username must start with a lowercase letter or '_' and\n\
 contain only lowercase letters, digits, '_' or '-'.\n\n\
 User account creation skipped."
        return 0
    fi
    IORA_USER="$name"

    full=$(dlg --title " Full Name " --inputbox \
        "\n Full name (GECOS) for ${IORA_USER}.\n Leave empty to skip.\n" \
        10 60 "" 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && full=""
    IORA_USER_FULLNAME="$full"

    # Loop user password entry until matched, empty (lock), or cancelled.
    while true; do
        pw1=$(dlg --title " User Password " --insecure --passwordbox \
            "\n Password for ${IORA_USER} (min. 6 characters, empty = lock account).\n" \
            10 60 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 1
        if [ -z "$pw1" ]; then
            IORA_USER_PW=""
            break
        fi
        pw2=$(dlg --title " Confirm Password " --insecure --passwordbox \
            "\n Enter the password again.\n" \
            10 60 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 1
        if [ "$pw1" = "$pw2" ]; then
            IORA_USER_PW="$pw1"
            break
        fi
        dlg_msg " Password Mismatch " "\
 The passwords do not match.\n\n\
 Please enter the password and the confirmation again."
    done

    if dlg --title " Administrator " --yesno \
        "\n Grant ${IORA_USER} sudo (administrator) rights?\n" \
        8 60; then
        IORA_USER_SUDO=true
    else
        IORA_USER_SUDO=false
    fi
}

screen_select_disk() {
    local disk_list
    disk_list=$(get_disks)

    if [ -z "$disk_list" ]; then
        dlg_msg " Error " "\
 No suitable target disks found.\n\n\
 IORA OS requires at least ${MIN_DISK_GB} GB.\n\n\
 Connect a disk and type 'install' to retry."
        return 1
    fi

    if [ -n "$DIALOG_BIN" ]; then
        local disk_count=0
        set --
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            local bus=$(get_disk_transport "$disk")
            local health=""
            if command -v smartctl >/dev/null 2>&1; then
                local smart_out
                smart_out=$(smartctl -H "/dev/${disk}" 2>/dev/null | grep -i "health\|SMART overall" | head -1 || true)
                case "$smart_out" in
                    *PASSED*|*OK*)   health=" [SMART:OK]" ;;
                    *FAILED*|*FAIL*) health=" [SMART:FAIL]" ;;
                esac
            fi
            local label="${sz}GB ${bus}${health}"
            [ -n "$mdl" ] && label="${label} - ${mdl}"
            set -- "$@" "/dev/${disk}" "$label"
            disk_count=$((disk_count + 1))
        done

        local menu_h=$((disk_count + 12))
        [ "$menu_h" -gt 22 ] && menu_h=22

        SEL_DISK=$(dlg --title " Installation Target " \
            --menu "\n Payload size: ${img_size}\n\n Select the drive that should receive the system.\n All existing data on the selected drive will be erased.\n" \
            "$menu_h" 64 "$disk_count" \
            "$@" \
            3>&1 1>&2 2>&3)

        [ $? -ne 0 ] && return 1
        SEL_DISK=$(basename "$SEL_DISK")

        # SMART health warning
        if command -v smartctl >/dev/null 2>&1; then
            local smart_out
            smart_out=$(smartctl -H "/dev/${SEL_DISK}" 2>/dev/null || true)
            if echo "$smart_out" | grep -qi "FAILED\|FAILING"; then
                if ! dlg_yesno " Disk Health Warning " "\
 SMART reports that /dev/${SEL_DISK} is FAILING.\n\n\
 Installing onto a failing drive is not recommended.\n\n\
 Proceed anyway?"; then
                    return 1
                fi
            fi
        fi
    else
        echo ""
        echo "  === Select Target Disk ==="
        echo ""
        local i=1 disk_array=""
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            printf "    %d)  /dev/%-8s  %4d GB" "$i" "$disk" "$sz"
            [ -n "$mdl" ] && printf "  [%s]" "$mdl"
            echo ""
            disk_array="${disk_array}${disk} "
            i=$((i + 1))
        done
        local disk_count=$((i - 1))
        echo ""
        printf "  Select disk [1-%d]: " "$disk_count"
        read choice
        if ! is_uint "$choice" || [ "$choice" -lt 1 ] || [ "$choice" -gt "$disk_count" ]; then
            return 1
        fi
        SEL_DISK=$(printf '%s\n' $disk_array | sed -n "${choice}p")
        [ -z "$SEL_DISK" ] && return 1
    fi
    return 0
}

# -- Partitioning screen -------------------------------------------------
# Modes (similar to Calamares/Ubiquity/Anaconda):
#   auto      - Erase entire selected disk and lay out A/B + ESP + data
#               (classic IORA image via dd, this is the default)
#   keep      - Keep existing partition table; reuse existing ESP and install
#               rootfs into a user-picked free partition. Advanced/multi-boot.
#   manual    - Drop to cfdisk/parted for hand partitioning before continuing.
#   encrypted - Same as "auto" but LUKS-encrypts root partitions before copy.
PARTITION_MODE="auto"
KEEP_TARGET_ROOT=""
KEEP_TARGET_ESP=""
LUKS_ENABLED=false
LUKS_PASSPHRASE=""

screen_partitioning() {
    [ -z "$DIALOG_BIN" ] && return 0

    local has_cfdisk=false has_luks=false
    command -v cfdisk     >/dev/null 2>&1 && has_cfdisk=true
    command -v cryptsetup >/dev/null 2>&1 && has_luks=true

    # Build menu dynamically based on available tools.
    set --
    set -- "$@" "auto"     "Erase entire disk and install (recommended)"
    if [ "$has_luks" = true ]; then
        set -- "$@" "encrypted" "Erase disk, encrypt root with LUKS"
    fi
    set -- "$@" "keep"     "Keep existing partitions (advanced, multi-boot)"
    if [ "$has_cfdisk" = true ]; then
        set -- "$@" "manual"   "Manual (open cfdisk / parted now)"
    else
        set -- "$@" "manual"   "Manual (drop to shell for parted)"
    fi

    local mode
    mode=$(dlg --title " Disk Partitioning " --menu \
        "\n Choose how /dev/${SEL_DISK} should be partitioned.\n\n\
 'Erase entire disk' is safe for new installs. 'Keep existing'\n\
 preserves other OSes and re-uses the existing ESP. 'Manual'\n\
 gives you a partitioning tool.\n" \
        18 70 5 "$@" 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 1

    PARTITION_MODE="$mode"

    case "$mode" in
        encrypted)
            LUKS_ENABLED=true
            local p1 p2
            while true; do
                p1=$(dlg --title " LUKS Passphrase " --insecure --passwordbox \
                    "\n Enter a passphrase to encrypt the root filesystem.\n\
 You will be asked for it at every boot.\n\n\
 Minimum 8 characters recommended.\n" \
                    14 64 3>&1 1>&2 2>&3)
                [ $? -ne 0 ] && { PARTITION_MODE="auto"; LUKS_ENABLED=false; return 0; }
                if [ "${#p1}" -lt 6 ]; then
                    dlg_msg " Too Short " "Passphrase must be at least 6 characters."
                    continue
                fi
                p2=$(dlg --title " Confirm Passphrase " --insecure --passwordbox \
                    "\n Enter the passphrase again for verification.\n" \
                    10 64 3>&1 1>&2 2>&3)
                [ $? -ne 0 ] && { PARTITION_MODE="auto"; LUKS_ENABLED=false; return 0; }
                if [ "$p1" != "$p2" ]; then
                    dlg_msg " Mismatch " "The passphrases do not match. Try again."
                    continue
                fi
                LUKS_PASSPHRASE="$p1"
                break
            done
            if ! dlg_yesno " LUKS Notice " "\
 Root partitions will be encrypted with LUKS2 after the image\n\
 is written. Losing the passphrase means losing all data on\n\
 this device. Continue?"; then
                PARTITION_MODE="auto"
                LUKS_ENABLED=false
                LUKS_PASSPHRASE=""
            fi
            ;;
        keep)
            # Build list of existing partitions and let user choose root + ESP.
            local num sz fstype label part
            set --
            for num in $(seq 1 16); do
                part=$(disk_part_name "$SEL_DISK" "$num")
                [ -b "$part" ] || continue
                sz=$(blockdev --getsize64 "$part" 2>/dev/null || echo 0)
                sz=$(( sz / 1024 / 1024 ))
                fstype=$(blkid -s TYPE  -o value "$part" 2>/dev/null || echo "")
                label=$(blkid  -s LABEL -o value "$part" 2>/dev/null || echo "")
                set -- "$@" "$part" "${sz}MB ${fstype:-unknown} ${label}"
            done

            if [ "$#" -eq 0 ]; then
                dlg_msg " No Partitions " "\
 No existing partitions found on /dev/${SEL_DISK}.\n\
 Falling back to 'Erase entire disk'."
                PARTITION_MODE="auto"
                return 0
            fi

            KEEP_TARGET_ROOT=$(dlg --title " Pick Root Partition " \
                --menu "\n Select the partition to install IORA OS into.\n\
 WARNING: this partition will be reformatted.\n" \
                18 72 8 "$@" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 1

            KEEP_TARGET_ESP=$(dlg --title " Pick EFI System Partition " \
                --menu "\n Select the existing EFI System Partition (usually\n\
 FAT32 ~100-512MB). Pick SKIP for BIOS-only systems.\n" \
                18 72 8 "$@" "SKIP" "Do not touch an ESP (BIOS-only)" \
                3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 1
            [ "$KEEP_TARGET_ESP" = "SKIP" ] && KEEP_TARGET_ESP=""

            if ! dlg_yesno " Keep Partitions - Confirm " "\
 Root   : ${KEEP_TARGET_ROOT} (will be REFORMATTED)\n\
 ESP    : ${KEEP_TARGET_ESP:-<none>}\n\
 Other partitions on /dev/${SEL_DISK} stay intact.\n\n\
 Proceed?"; then
                return 1
            fi
            ;;
        manual)
            clear
            echo ""
            echo "  === Manual Partitioning ==="
            echo ""
            echo "  /dev/${SEL_DISK}: $(get_disk_size_gb "$SEL_DISK") GB"
            echo ""
            if [ "$has_cfdisk" = true ]; then
                echo "  Opening cfdisk. When done, write changes (W) and quit (Q)."
                echo "  Press ENTER to continue..."
                read _
                cfdisk "/dev/${SEL_DISK}" || true
            else
                echo "  cfdisk not available. Dropping to shell."
                echo "  Use parted/sgdisk/fdisk to prepare partitions, then"
                echo "  type 'exit' to return to the installer."
                echo ""
                sh -i || true
            fi
            sync
            partprobe "/dev/${SEL_DISK}" 2>/dev/null || true
            blockdev --rereadpt "/dev/${SEL_DISK}" 2>/dev/null || true
            sleep 2

            # After manual editing, user still needs to pick root/ESP -> treat as 'keep'.
            PARTITION_MODE="keep"
            # Re-run the keep branch to pick root+ESP.
            if ! screen_partitioning; then
                return 1
            fi
            ;;
        auto|*)
            PARTITION_MODE="auto"
            LUKS_ENABLED=false
            ;;
    esac
    return 0
}

screen_confirm() {
    local disk="$SEL_DISK"
    local sz=$(get_disk_size_gb "$disk")
    local mdl=$(get_disk_model "$disk")
    local vendor=$(get_disk_vendor "$disk")
    local parts=$(get_disk_partitions "$disk")
    local bus=$(get_disk_transport "$disk")
    parts=$(safe_uint "$parts" 0)

    local summary="Target Disk\n"
    summary="${summary}  Device:     /dev/${disk}\n"
    summary="${summary}  Size:       ${sz} GB\n"
    summary="${summary}  Bus:        ${bus}\n"
    [ -n "$mdl" ] && summary="${summary}  Model:      ${mdl}\n"
    [ -n "$vendor" ] && summary="${summary}  Vendor:     ${vendor}\n"
    [ "$parts" -gt 0 ] && summary="${summary}  Partitions: ${parts} (will be erased)\n"

    summary="${summary}\nSystem Settings\n"
    summary="${summary}  Hostname:   ${IORA_HOSTNAME}\n"
    summary="${summary}  Timezone:   ${IORA_TIMEZONE}\n"
    summary="${summary}  Locale:     ${IORA_LOCALE}\n"
    summary="${summary}  Keyboard:   ${IORA_KEYBOARD}\n"
    if [ "$IORA_NETWORK" = "static" ]; then
        summary="${summary}  Network:    Static (${IORA_IP}/${IORA_NETMASK})\n"
    else
        summary="${summary}  Network:    DHCP (automatic)\n"
    fi
    if [ -n "$IORA_ROOT_PW" ]; then
        summary="${summary}  Password:   (custom)\n"
    else
        summary="${summary}  Password:   (default)\n"
    fi

    summary="${summary}\nPartitioning\n"
    case "$PARTITION_MODE" in
        auto)
            summary="${summary}  Mode:       Erase entire disk (A/B layout)\n"
            summary="${summary}\n +------------------------------------+"
            summary="${summary}\n |  WARNING: ALL data on /dev/${disk}    |"
            summary="${summary}\n |  will be permanently ERASED!       |"
            summary="${summary}\n +------------------------------------+"
            ;;
        encrypted)
            summary="${summary}  Mode:       Erase disk + LUKS encryption\n"
            summary="${summary}  Cipher:     aes-xts-plain64, argon2id\n"
            summary="${summary}\n +------------------------------------+"
            summary="${summary}\n |  WARNING: ALL data on /dev/${disk}    |"
            summary="${summary}\n |  will be permanently ERASED AND    |"
            summary="${summary}\n |  encrypted with your passphrase.   |"
            summary="${summary}\n +------------------------------------+"
            ;;
        keep)
            summary="${summary}  Mode:       Keep existing partitions\n"
            summary="${summary}  Root:       ${KEEP_TARGET_ROOT} (will be reformatted)\n"
            summary="${summary}  ESP:        ${KEEP_TARGET_ESP:-<none, BIOS only>}\n"
            summary="${summary}\n +----------------------------------------+"
            summary="${summary}\n |  Only ${KEEP_TARGET_ROOT} will be reformatted.   |"
            summary="${summary}\n |  Other partitions on /dev/${disk} stay.   |"
            summary="${summary}\n +----------------------------------------+"
            ;;
        *)
            summary="${summary}  Mode:       ${PARTITION_MODE}\n"
            ;;
    esac
    summary="${summary}\n\n Proceed with installation?"

    if ! dlg_yesno " Confirm " "$summary"; then
        return 1
    fi
    return 0
}

# -- LUKS initramfs builder ----------------------------------------------
# Creates a minimal initramfs (cpio.gz) that:
#   1. Mounts /proc /sys /dev
#   2. Loads crypto + dm-crypt kernel modules
#   3. Reads /etc/iora-crypt.conf (baked into the initramfs) for the UUIDs
#   4. Runs `cryptsetup open` on the chosen slot (from kernel cmdline
#      root=/dev/mapper/iora_root_a | iora_root_b)
#   5. Pivots into the real rootfs with switch_root
#
# The initramfs is assembled from binaries that already live in THIS
# running system (the installer rootfs is the same Buildroot build as the
# target rootfs, so cryptsetup + deps are present).
build_luks_initramfs() {
    local output="$1"        # absolute output path (initrd.img)
    local uuid_a="$2"
    local uuid_b="$3"
    local work_dir

    work_dir=$(mktemp -d 2>/dev/null || echo "/tmp/iora-initrd.$$")
    mkdir -p "$work_dir" || return 1
    rm -rf "$work_dir"/*

    # Directory skeleton
    mkdir -p "$work_dir"/{bin,sbin,usr/bin,usr/sbin,etc,proc,sys,dev,run,tmp,mnt/root,lib,lib64,usr/lib,usr/lib64}

    # -- Copy binary + its shared libraries --------------------------
    _copy_with_deps() {
        local bin="$1"
        local dst_bin
        [ -x "$bin" ] || return 1
        dst_bin="$work_dir${bin}"
        mkdir -p "$(dirname "$dst_bin")"
        cp -f "$bin" "$dst_bin" 2>/dev/null || return 1

        # ldd -> copy every resolved shared-object path
        if command -v ldd >/dev/null 2>&1; then
            ldd "$bin" 2>/dev/null | awk '
                /=>/   { print $3 }
                /^\t\// { print $1 }
            ' | while read -r lib; do
                [ -z "$lib" ] && continue
                [ "$lib" = "not" ] && continue
                [ -f "$lib" ] || continue
                local ldst
                ldst="$work_dir${lib}"
                mkdir -p "$(dirname "$ldst")"
                [ -f "$ldst" ] || cp -f "$lib" "$ldst" 2>/dev/null || true
            done
        fi
    }

    # Shell + core utils via busybox if present, else individual tools.
    local have_busybox=false
    if [ -x /bin/busybox ]; then
        _copy_with_deps /bin/busybox
        have_busybox=true
        # Create common tool symlinks so our init script works regardless of
        # whether the installer's shell supports `command -v`.
        for t in sh ash mount umount mkdir cat echo sleep ls cp ln mknod \
                 switch_root modprobe insmod lsmod dd sync poweroff \
                 reboot blkid awk sed grep; do
            ln -sf busybox "$work_dir/bin/$t" 2>/dev/null || true
        done
    fi

    # Guarantee a working /bin/sh even if busybox is missing.
    if [ ! -e "$work_dir/bin/sh" ]; then
        if [ -x /bin/sh ]; then _copy_with_deps /bin/sh; fi
        if [ -x /bin/bash ]; then
            _copy_with_deps /bin/bash
            ln -sf bash "$work_dir/bin/sh" 2>/dev/null || true
        fi
    fi

    # cryptsetup + dependencies (libcryptsetup, libargon2, libjson-c, ...)
    local cs_bin=""
    for c in /sbin/cryptsetup /usr/sbin/cryptsetup /usr/bin/cryptsetup /bin/cryptsetup; do
        [ -x "$c" ] && cs_bin="$c" && break
    done
    if [ -z "$cs_bin" ]; then
        echo "build_luks_initramfs: cryptsetup binary not found" >&2
        rm -rf "$work_dir"
        return 1
    fi
    _copy_with_deps "$cs_bin"
    # cryptsetup expects to be at /sbin/cryptsetup inside initramfs
    [ -x "$work_dir/sbin/cryptsetup" ] || ln -sf "..${cs_bin}" "$work_dir/sbin/cryptsetup" 2>/dev/null || true

    # Copy blkid and findmnt for debugging/search (optional)
    for extra in /sbin/blkid /usr/sbin/blkid /sbin/findmnt /usr/bin/findmnt; do
        [ -x "$extra" ] && _copy_with_deps "$extra"
    done

    # Copy dynamic linker explicitly (glibc-ism) to canonical paths the binaries expect
    for ld in /lib64/ld-linux-x86-64.so.2 /lib/ld-linux-x86-64.so.2 /lib/ld-musl-x86_64.so.1; do
        if [ -f "$ld" ]; then
            mkdir -p "$work_dir$(dirname "$ld")"
            cp -f "$ld" "$work_dir$ld" 2>/dev/null || true
        fi
    done

    # -- Kernel modules needed for LUKS ------------------------------
    local kver
    kver=$(uname -r 2>/dev/null || true)
    if [ -n "$kver" ] && [ -d "/lib/modules/$kver" ]; then
        mkdir -p "$work_dir/lib/modules/$kver"
        # Copy minimal set + modules.* resolver files. depmod inside rootfs
        # has already written those during buildroot.
        for f in modules.dep modules.alias modules.builtin modules.symbols \
                 modules.dep.bin modules.alias.bin modules.symbols.bin \
                 modules.builtin.bin modules.builtin.modinfo; do
            [ -f "/lib/modules/$kver/$f" ] && \
                cp -f "/lib/modules/$kver/$f" "$work_dir/lib/modules/$kver/" 2>/dev/null || true
        done
        # Required crypto + block modules.
        for modname in dm-mod dm-crypt aes aes_generic aes-x86_64 aesni-intel \
                       xts sha256 sha256_generic cbc ecb cryptd gf128mul \
                       libaes libsha256 crypto_simd crc32 crc32c_generic \
                       crc32c-intel ext4 mbcache jbd2 crc16 loop virtio_blk \
                       ahci libahci sd_mod scsi_mod; do
            local modpath
            modpath=$(find "/lib/modules/$kver" -name "${modname}.ko*" 2>/dev/null | head -1)
            if [ -n "$modpath" ] && [ -f "$modpath" ]; then
                mkdir -p "$work_dir$(dirname "$modpath")"
                cp -f "$modpath" "$work_dir${modpath}" 2>/dev/null || true
            fi
        done
    fi

    # -- /etc/iora-crypt.conf inside initramfs -----------------------
    cat > "$work_dir/etc/iora-crypt.conf" <<CONF
LUKS_ROOT_A_UUID=${uuid_a}
LUKS_ROOT_B_UUID=${uuid_b}
LUKS_ROOT_A_NAME=iora_root_a
LUKS_ROOT_B_NAME=iora_root_b
CONF

    # -- /init script ------------------------------------------------
    cat > "$work_dir/init" <<'LUKSINIT'
#!/bin/sh
# IORA LUKS initramfs
export PATH=/sbin:/usr/sbin:/bin:/usr/bin

mount -t devtmpfs devtmpfs /dev 2>/dev/null || mount -t tmpfs tmpfs /dev 2>/dev/null
mount -t proc proc /proc 2>/dev/null
mount -t sysfs sysfs /sys 2>/dev/null
mount -t tmpfs tmpfs /run 2>/dev/null

[ -e /dev/console ] || mknod -m 600 /dev/console c 5 1 2>/dev/null
[ -e /dev/null    ] || mknod -m 666 /dev/null    c 1 3 2>/dev/null

# Load crypto + dm modules. depmod -n file must already exist.
for m in dm-mod dm-crypt xts aes sha256 aesni_intel ahci libahci sd_mod \
         virtio_blk ext4; do
    modprobe "$m" 2>/dev/null
done

# Parse kernel cmdline for iora_slot=a|b (set by grub entry) OR
# root=/dev/mapper/iora_root_X
slot="a"
for word in $(cat /proc/cmdline); do
    case "$word" in
        iora_slot=a) slot=a ;;
        iora_slot=b) slot=b ;;
        root=/dev/mapper/iora_root_a) slot=a ;;
        root=/dev/mapper/iora_root_b) slot=b ;;
    esac
done

# Load UUIDs
[ -r /etc/iora-crypt.conf ] && . /etc/iora-crypt.conf

if [ "$slot" = "b" ]; then
    uuid="$LUKS_ROOT_B_UUID"; name="${LUKS_ROOT_B_NAME:-iora_root_b}"
else
    uuid="$LUKS_ROOT_A_UUID"; name="${LUKS_ROOT_A_NAME:-iora_root_a}"
fi

if [ -z "$uuid" ]; then
    echo "IORA initramfs: missing LUKS UUID in /etc/iora-crypt.conf"
    exec sh
fi

# Wait for backing device
echo "IORA initramfs: waiting for /dev/disk/by-uuid/${uuid} ..."
i=0
while [ "$i" -lt 30 ] && [ ! -e "/dev/disk/by-uuid/${uuid}" ]; do
    sleep 1
    i=$((i+1))
done

if [ ! -e "/dev/disk/by-uuid/${uuid}" ]; then
    echo "IORA initramfs: device with UUID ${uuid} not found, dropping to shell"
    exec sh
fi

# Unlock loop (3 attempts)
attempts=0
while [ "$attempts" -lt 3 ]; do
    echo ""
    printf "Enter passphrase for IORA OS root (%s): " "$name"
    if cryptsetup open --type luks --tries 1 "/dev/disk/by-uuid/${uuid}" "$name"; then
        break
    fi
    attempts=$((attempts+1))
    echo "Wrong passphrase (attempt $attempts of 3)"
done

if [ ! -e "/dev/mapper/${name}" ]; then
    echo "IORA initramfs: unlock failed, dropping to shell"
    exec sh
fi

# Mount and pivot
mount -t ext4 -o ro "/dev/mapper/${name}" /mnt/root 2>/dev/null \
    || mount "/dev/mapper/${name}" /mnt/root 2>/dev/null

if [ ! -x /mnt/root/sbin/init ] && [ ! -x /mnt/root/lib/systemd/systemd ] \
   && [ ! -x /mnt/root/bin/sh ]; then
    echo "IORA initramfs: /mnt/root has no init, dropping to shell"
    exec sh
fi

# Hand off to real init
for initpath in /sbin/init /lib/systemd/systemd /bin/init /bin/sh; do
    if [ -x "/mnt/root${initpath}" ]; then
        exec switch_root /mnt/root "$initpath"
    fi
done

echo "IORA initramfs: switch_root failed"
exec sh
LUKSINIT
    chmod 755 "$work_dir/init"

    # -- Package into cpio.gz ----------------------------------------
    (
        cd "$work_dir" || exit 1
        find . | cpio -H newc -o 2>/dev/null | gzip -9
    ) > "$output" || {
        rm -rf "$work_dir"
        return 1
    }

    local sz
    sz=$(stat -c %s "$output" 2>/dev/null || echo 0)
    echo "LUKS initramfs written: $output (${sz} bytes)"

    rm -rf "$work_dir"
    return 0
}

# -- LUKS root encryption (in-place) -------------------------------------
# Encrypts both A and B root partitions using cryptsetup reencrypt --encrypt.
# The original rootfs stays intact; a LUKS2 header is added at the start of
# the partition, shifting data by the header size (default 16 MiB). After
# this we also rewrite grub.cfg to unlock and mount the encrypted rootfs.
# Requires cryptsetup 2.4+.
encrypt_root_partitions() {
    local disk="$1"
    local root_a root_b esp rootfs
    root_a=$(disk_part_name "$disk" 3)
    root_b=$(disk_part_name "$disk" 4)
    esp=$(disk_part_name "$disk" 2)

    if ! command -v cryptsetup >/dev/null 2>&1; then
        echo "cryptsetup not available"
        return 1
    fi
    if [ -z "$LUKS_PASSPHRASE" ]; then
        echo "LUKS passphrase not set"
        return 1
    fi

    # Check cryptsetup supports reencrypt --encrypt (cryptsetup 2.4+)
    if ! cryptsetup --help 2>&1 | grep -q "reencrypt"; then
        echo "cryptsetup lacks reencrypt support - cannot encrypt in place"
        return 1
    fi

    _encrypt_one() {
        local part="$1"
        local name="$2"
        [ -b "$part" ] || { echo "skip $part (not a block device)"; return 0; }

        echo "Encrypting $part as $name..."
        # Reduce device size by 32 MiB to make room for the LUKS header without
        # truncating filesystem data. The rootfs inside is smaller than the
        # partition so this is always safe for IORA's 2 GB root partitions.
        printf '%s' "$LUKS_PASSPHRASE" | cryptsetup reencrypt \
            --encrypt \
            --type luks2 \
            --reduce-device-size 32M \
            --cipher aes-xts-plain64 \
            --hash sha256 \
            --key-size 512 \
            --pbkdf argon2id \
            --batch-mode \
            "$part" 2>&1 || {
                echo "reencrypt failed for $part"
                return 1
            }
        echo "$part encrypted OK"
    }

    _encrypt_one "$root_a" "iora_root_a" || return 1
    _encrypt_one "$root_b" "iora_root_b" || return 1

    # Open A, rewrite /etc/crypttab + /etc/default/grub inside, close.
    if ! printf '%s' "$LUKS_PASSPHRASE" | cryptsetup open --batch-mode "$root_a" iora_root_a 2>&1; then
        echo "could not open encrypted root A"
        return 1
    fi

    local mnt="/mnt/luks-target"
    mkdir -p "$mnt"
    if ! mount /dev/mapper/iora_root_a "$mnt" 2>&1; then
        echo "cannot mount encrypted root A"
        cryptsetup close iora_root_a 2>/dev/null || true
        return 1
    fi

    local uuid_a uuid_b
    uuid_a=$(cryptsetup luksUUID "$root_a" 2>/dev/null || true)
    uuid_b=$(cryptsetup luksUUID "$root_b" 2>/dev/null || true)

    mkdir -p "$mnt/etc"
    cat > "$mnt/etc/crypttab" <<CRYPTTAB
# Generated by IORA installer
iora_root_a UUID=${uuid_a} none luks,discard
iora_root_b UUID=${uuid_b} none luks,discard
CRYPTTAB

    # Write /etc/iora-crypt.conf so the initramfs hook picks it up.
    cat > "$mnt/etc/iora-crypt.conf" <<CRYPTCONF
LUKS_ROOT_A_UUID=${uuid_a}
LUKS_ROOT_B_UUID=${uuid_b}
LUKS_ROOT_A_NAME=iora_root_a
LUKS_ROOT_B_NAME=iora_root_b
CRYPTCONF

    sync
    umount "$mnt" 2>/dev/null || true
    cryptsetup close iora_root_a 2>/dev/null || true

    # Rewrite grub.cfg on ESP to use cryptomount.
    local esp_mnt="/mnt/luks-esp"
    mkdir -p "$esp_mnt"
    if mount -t vfat "$esp" "$esp_mnt" 2>&1; then
        mkdir -p "$esp_mnt/boot/grub" 2>/dev/null || true

        # Build and install the LUKS initramfs onto the ESP.
        local initrd_ok=false
        if build_luks_initramfs "$esp_mnt/initrd-luks.img" "$uuid_a" "$uuid_b"; then
            initrd_ok=true
        fi

        local initrd_line=""
        if [ "$initrd_ok" = true ]; then
            initrd_line="    initrd /initrd-luks.img"
        fi

        cat > "$esp_mnt/boot/grub/grub.cfg" <<LUKSGRUB
# Generated by IORA installer (LUKS)
insmod cryptodisk
insmod luks
insmod gcry_rijndael
insmod gcry_sha256
insmod part_gpt
insmod ext2

set default=0
set timeout=5

menuentry "IORA OS (encrypted)" {
    cryptomount -u ${uuid_a}
    linux /boot/vmlinuz root=/dev/mapper/iora_root_a rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on iora_slot=a cryptdevice=UUID=${uuid_a}:iora_root_a
${initrd_line}
}

menuentry "IORA OS - second slot (encrypted)" {
    cryptomount -u ${uuid_b}
    linux /boot/vmlinuz root=/dev/mapper/iora_root_b rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on iora_slot=b cryptdevice=UUID=${uuid_b}:iora_root_b
${initrd_line}
}

menuentry "IORA OS Recovery (encrypted)" {
    cryptomount -u ${uuid_a}
    linux /boot/vmlinuz root=/dev/mapper/iora_root_a rootwait rw rootfstype=ext4 init=/bin/sh iora_slot=a cryptdevice=UUID=${uuid_a}:iora_root_a
${initrd_line}
}
LUKSGRUB
        sync
        umount "$esp_mnt" 2>/dev/null || true
    fi
    rmdir "$esp_mnt" 2>/dev/null || true
    rmdir "$mnt" 2>/dev/null || true

    echo "LUKS setup complete; A-UUID=${uuid_a} B-UUID=${uuid_b}"
    return 0
}

# -- Keep-mode installer -------------------------------------------------
# Installs IORA OS into an existing partition without touching other
# partitions on the disk. The user has already picked KEEP_TARGET_ROOT
# (always reformatted) and optionally KEEP_TARGET_ESP.
install_keep_mode() {
    local disk="$1"
    local root_part="$KEEP_TARGET_ROOT"
    local esp_part="$KEEP_TARGET_ESP"
    local target="/mnt/keep-target"
    local rc=0
    local progress="/tmp/keep-install.log"
    : > "$progress"

    if [ ! -b "$root_part" ]; then
        dlg_msg " Invalid Target " "Root partition ${root_part} is not a block device."
        return 1
    fi

    # Extract rootfs image from the compressed installer payload. The payload
    # is a disk image (iora-os.img.xz) containing the full A/B layout. We only
    # need the root partition (p3) contents. Easiest: decompress to a temp
    # file, loop-mount, then copy partition 3 to the target root partition.
    local tmp_img="/tmp/iora-payload.img"

    local steps_total=8
    _keep_gauge() {
        local pct="$1" msg="$2"
        echo "$pct"; echo "XXX"; echo "  $msg"; echo "XXX"
        echo "[$(date '+%H:%M:%S')] ${pct}% ${msg}" >> "$progress"
    }

    (
        _keep_gauge 2  "Preparing target partition ${root_part}..."
        umount "$root_part" 2>/dev/null || true
        [ -n "$esp_part" ] && umount "$esp_part" 2>/dev/null || true

        _keep_gauge 5  "Decompressing installer payload..."
        if ! xz -dk -c "${ISO_MOUNT}/${ISO_IMAGE}" > "${tmp_img}" 2>>"$progress"; then
            echo 1 > /tmp/install_result
            exit 1
        fi

        _keep_gauge 30 "Finding payload partitions..."
        local loop
        loop=$(losetup -fP --show "${tmp_img}" 2>>"$progress")
        if [ -z "$loop" ] || [ ! -b "${loop}p3" ]; then
            echo "[$(date '+%H:%M:%S')] ERROR: could not attach payload loop device" >> "$progress"
            [ -n "$loop" ] && losetup -d "$loop" 2>/dev/null || true
            echo 1 > /tmp/install_result
            exit 1
        fi

        _keep_gauge 35 "Formatting ${root_part} (ext4)..."
        mkfs.ext4 -F -L iora-root "$root_part" >>"$progress" 2>&1 || {
            losetup -d "$loop" 2>/dev/null || true
            echo 1 > /tmp/install_result
            exit 1
        }

        _keep_gauge 40 "Copying rootfs to ${root_part}..."
        # Use dd with progress for a predictable copy (partition-sized).
        local src_size dst_size
        src_size=$(blockdev --getsize64 "${loop}p3" 2>/dev/null || echo 0)
        dst_size=$(blockdev --getsize64 "${root_part}" 2>/dev/null || echo 0)
        if [ "$dst_size" -lt "$src_size" ]; then
            echo "[$(date '+%H:%M:%S')] ERROR: target ${root_part} (${dst_size} B) smaller than source (${src_size} B)" >> "$progress"
            losetup -d "$loop" 2>/dev/null || true
            echo 1 > /tmp/install_result
            exit 1
        fi

        # Mount source, target; copy with cp -a (preserves xattrs/perms/links).
        mkdir -p /mnt/keep-src /mnt/keep-dst
        mount -o ro "${loop}p3" /mnt/keep-src 2>>"$progress" || {
            losetup -d "$loop" 2>/dev/null || true
            echo 1 > /tmp/install_result
            exit 1
        }
        mount "$root_part" /mnt/keep-dst 2>>"$progress" || {
            umount /mnt/keep-src 2>/dev/null
            losetup -d "$loop" 2>/dev/null || true
            echo 1 > /tmp/install_result
            exit 1
        }
        cp -a /mnt/keep-src/. /mnt/keep-dst/ >>"$progress" 2>&1 || {
            umount /mnt/keep-dst /mnt/keep-src 2>/dev/null
            losetup -d "$loop" 2>/dev/null || true
            echo 1 > /tmp/install_result
            exit 1
        }

        _keep_gauge 75 "Copying kernel + bootloader files..."
        # Copy kernel from source payload's ESP (p2)
        if [ -b "${loop}p2" ] && [ -n "$esp_part" ]; then
            mkdir -p /mnt/keep-src-esp /mnt/keep-dst-esp
            if mount -o ro -t vfat "${loop}p2" /mnt/keep-src-esp 2>>"$progress" \
               && mount -t vfat "$esp_part" /mnt/keep-dst-esp 2>>"$progress"; then
                # Preserve existing ESP content (other OSes); add/overwrite only IORA files.
                [ -f /mnt/keep-src-esp/vmlinuz ] && cp -f /mnt/keep-src-esp/vmlinuz /mnt/keep-dst-esp/iora-vmlinuz 2>>"$progress" || true
                mkdir -p /mnt/keep-dst-esp/EFI/IORA 2>/dev/null || true
                if [ -d /mnt/keep-src-esp/EFI ]; then
                    cp -a /mnt/keep-src-esp/EFI/. /mnt/keep-dst-esp/EFI/ 2>>"$progress" || true
                fi
                umount /mnt/keep-dst-esp 2>/dev/null || true
                umount /mnt/keep-src-esp 2>/dev/null || true
            fi
        fi

        _keep_gauge 85 "Writing grub.cfg..."
        mkdir -p /mnt/keep-dst/boot/grub 2>/dev/null || true
        local root_uuid root_partuuid
        root_partuuid=$(blkid -s PARTUUID -o value "$root_part" 2>/dev/null || true)
        root_uuid=$(blkid -s UUID -o value "$root_part" 2>/dev/null || true)
        local root_ref="/dev/$(basename "$root_part")"
        [ -n "$root_partuuid" ] && root_ref="PARTUUID=${root_partuuid}"
        [ -n "$root_uuid" ] && root_ref="UUID=${root_uuid}"

        cat > /mnt/keep-dst/boot/grub/grub.cfg <<GRUBCFG
set default=0
set timeout=5

menuentry "IORA OS" {
    search --no-floppy --fs-uuid --set=root ${root_uuid:-0000}
    linux /boot/vmlinuz root=${root_ref} rootwait ro rootfstype=ext4 loglevel=4 systemd.show_status=true printk.devkmsg=on
}

menuentry "IORA OS Recovery" {
    search --no-floppy --fs-uuid --set=root ${root_uuid:-0000}
    linux /boot/vmlinuz root=${root_ref} rootwait rw rootfstype=ext4 init=/bin/sh
}
GRUBCFG

        _keep_gauge 90 "Installing bootloader..."
        local had_esp=false
        if [ -n "$esp_part" ] && [ -b "$esp_part" ]; then
            mkdir -p /mnt/keep-dst/boot/efi
            if mount -t vfat "$esp_part" /mnt/keep-dst/boot/efi 2>>"$progress"; then
                had_esp=true
            fi
        fi

        # Bind mount for grub-install chroot
        mkdir -p /mnt/keep-dst/dev /mnt/keep-dst/proc /mnt/keep-dst/sys /mnt/keep-dst/run
        mount --bind /dev  /mnt/keep-dst/dev  2>/dev/null || true
        mount --bind /proc /mnt/keep-dst/proc 2>/dev/null || true
        mount --bind /sys  /mnt/keep-dst/sys  2>/dev/null || true
        mount --bind /run  /mnt/keep-dst/run  2>/dev/null || true

        if chroot /mnt/keep-dst /bin/sh -c "command -v grub-install >/dev/null 2>&1" 2>/dev/null; then
            chroot /mnt/keep-dst /bin/sh -c "grub-install --target=i386-pc --recheck --no-floppy /dev/${disk}" >>"$progress" 2>&1 || true
            if [ "$had_esp" = true ] && [ -d /sys/firmware/efi ]; then
                chroot /mnt/keep-dst /bin/sh -c "grub-install --target=x86_64-efi --efi-directory=/boot/efi --boot-directory=/boot --removable --recheck /dev/${disk}" >>"$progress" 2>&1 || true
            fi
        elif command -v grub-install >/dev/null 2>&1; then
            grub-install --target=i386-pc --boot-directory=/mnt/keep-dst/boot --recheck --no-floppy "/dev/${disk}" >>"$progress" 2>&1 || true
            if [ "$had_esp" = true ] && [ -d /sys/firmware/efi ]; then
                grub-install --target=x86_64-efi --efi-directory=/mnt/keep-dst/boot/efi --boot-directory=/mnt/keep-dst/boot --removable --recheck "/dev/${disk}" >>"$progress" 2>&1 || true
            fi
        fi

        umount /mnt/keep-dst/run  2>/dev/null || true
        umount /mnt/keep-dst/sys  2>/dev/null || true
        umount /mnt/keep-dst/proc 2>/dev/null || true
        umount /mnt/keep-dst/dev  2>/dev/null || true
        [ "$had_esp" = true ] && umount /mnt/keep-dst/boot/efi 2>/dev/null || true

        _keep_gauge 97 "Finalizing..."
        sync
        umount /mnt/keep-dst 2>/dev/null || true
        umount /mnt/keep-src 2>/dev/null || true
        losetup -d "$loop" 2>/dev/null || true
        rm -f "${tmp_img}" 2>/dev/null || true

        _keep_gauge 100 "Installation complete."
        echo 0 > /tmp/install_result
    ) | dlg --title " Installing into existing partition " --gauge \
        "  Starting..." 12 72 0

    local result
    result=$(cat /tmp/install_result 2>/dev/null || echo 1)
    result=$(safe_uint "$result" 1)

    if [ "$result" -eq 0 ]; then
        apply_post_install_config "$disk"
        # Surface any warnings from the install log
        if [ -n "$DIALOG_BIN" ] && [ -f "$progress" ]; then
            if grep -qi "WARN\|ERROR\|failed" "$progress" 2>/dev/null; then
                dlg --title " Install Log " --textbox "$progress" 22 78 || true
            fi
        fi
        return 0
    else
        dlg_msg " Failed " "\
 Install into existing partition failed.\n See ${progress} for details."
        return 1
    fi
}

screen_install() {
    local disk="$SEL_DISK"

    # Unmount any partitions on target
    for part in /dev/${disk}*; do
        [ -b "$part" ] && umount "$part" 2>/dev/null || true
    done

    # -- Keep mode: install into an existing partition instead of dd-ing -----
    # This preserves other operating systems on the disk. The selected root
    # partition is reformatted, the rootfs is unpacked into it, and the
    # existing ESP (if any) gets grub + grub.cfg + kernel.
    if [ "$PARTITION_MODE" = "keep" ]; then
        install_keep_mode "$disk"
        return $?
    fi

    if [ -n "$DIALOG_BIN" ]; then
        (
            echo "2"
            echo "XXX"
            echo "  Preparing drive /dev/${disk}..."
            echo "XXX"
            dd if=/dev/zero of="/dev/${disk}" bs=1M count=1 >/dev/null 2>&1
            sleep 1

            echo "5"
            echo "XXX"
            echo "  Writing operating system to /dev/${disk}..."
            echo "  This may take a few minutes."
            echo "XXX"

            local img_bytes
            img_bytes=$(xz --robot --list "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '/^totals/{print $5}' || echo 0)
            img_bytes=$(safe_uint "$img_bytes" 0)
            [ "$img_bytes" -eq 0 ] && img_bytes=2000000000

            xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${disk}" bs=4M conv=fsync 2>/tmp/dd_progress &
            local dd_pid=$!

            local written=0 pct=5 ticks=0
            local start_written_sectors=0
            local now_written_sectors=0
            start_written_sectors=$(awk '{print $7}' "/sys/block/${disk}/stat" 2>/dev/null || echo 0)
            start_written_sectors=$(safe_uint "$start_written_sectors" 0)
            while kill -0 "$dd_pid" 2>/dev/null; do
                sleep 1
                # Read sector writes directly from kernel block stats for reliable progress.
                if [ -f "/sys/block/${disk}/stat" ]; then
                    now_written_sectors=$(awk '{print $7}' "/sys/block/${disk}/stat" 2>/dev/null || echo 0)
                    now_written_sectors=$(safe_uint "$now_written_sectors" 0)
                    if [ "$now_written_sectors" -gt "$start_written_sectors" ]; then
                        written=$(( (now_written_sectors - start_written_sectors) * 512 ))
                    fi
                fi

                # Fallback: parse dd stderr when no block stat progress is available.
                if [ "$written" -eq 0 ] && [ -f /tmp/dd_progress ]; then
                    local fb
                    fb=$(grep -o '[0-9][0-9]* bytes' /tmp/dd_progress 2>/dev/null | tail -1 | awk '{print $1}')
                    fb=$(safe_uint "$fb" 0)
                    [ "$fb" -gt 0 ] && written=$fb
                fi
                # Percentage; if bytes unknown, animate steadily forward
                if [ "$img_bytes" -gt 0 ] && [ "$written" -gt 0 ]; then
                    pct=$((5 + written * 74 / img_bytes))
                    [ "$pct" -gt 79 ] && pct=79
                else
                    ticks=$((ticks + 1))
                    pct=$((5 + ticks * 2))
                    [ "$pct" -gt 79 ] && pct=79
                fi
                echo "$pct"
            done
            wait "$dd_pid"
            local dd_rc=$?

            if [ "$dd_rc" -ne 0 ]; then
                echo "$dd_rc" > /tmp/install_result
                echo "100"; echo "XXX"; echo "  Write failed."; echo "XXX"
                exit 1
            fi

            echo "82"
            echo "XXX"
            echo "  Saving write buffer..."
            echo "XXX"
            sync
            sleep 1

            echo "84"
            echo "XXX"
            echo "  Repairing GPT partition header..."
            echo "  (required when image is smaller than target disk)"
            echo "XXX"
            # -- GPT backup-header repair ----------------------------------
            # After dd-writing an 8 GB image onto a larger disk the GPT
            # secondary header sits at the wrong offset. Move it.
            if command -v sgdisk >/dev/null 2>&1; then
                sgdisk -e "/dev/${disk}" >/dev/null 2>&1 || true
                sgdisk --verify "/dev/${disk}" >/dev/null 2>&1 || true
            elif command -v gdisk >/dev/null 2>&1; then
                printf 'v\nw\nY\n' | gdisk "/dev/${disk}" >/dev/null 2>&1 || true
            else
                parted -s "/dev/${disk}" print fix >/dev/null 2>&1 || true
            fi

            echo "87"
            echo "XXX"
            echo "  Refreshing partition table..."
            echo "XXX"
            sync
            blockdev --rereadpt "/dev/${disk}" >/dev/null 2>&1 || true
            partprobe "/dev/${disk}" >/dev/null 2>&1 || true
            sleep 3

            echo "90"
            echo "XXX"
            echo "  Applying system settings..."
            echo "XXX"
            echo "0" > /tmp/install_result

            if [ "$LUKS_ENABLED" = true ]; then
                echo "91"
                echo "XXX"
                echo "  Encrypting root partitions (LUKS)..."
                echo "  This may take a few minutes."
                echo "XXX"
                encrypt_root_partitions "${disk}" >/tmp/luks.log 2>&1 || {
                    echo "  LUKS encryption failed -- see /tmp/luks.log" >> /tmp/luks.log
                }
            fi

            echo "93"
            echo "XXX"
            echo "  Repairing bootloader..."
            echo "  This ensures the system can boot correctly."
            echo "XXX"
            repair_disk_and_bootloader "${disk}" >/dev/null 2>&1 || true

            echo "97"
            echo "XXX"
            echo "  Finalizing..."
            echo "XXX"
            sync
            sleep 1

            echo "100"
            echo "XXX"
            echo "  Installation complete."
            echo "XXX"
        ) | dlg --title " Writing to Drive " --gauge \
            "  Starting..." 10 64 0

        local result=$(cat /tmp/install_result 2>/dev/null || echo 1)
        result=$(safe_uint "$result" 1)

        if [ "$result" -eq 0 ]; then
            repair_disk_and_bootloader "$disk" || true
            apply_post_install_config "$disk"
            # Show repair log summary if there were warnings
            if [ -n "$DIALOG_BIN" ] && [ -f /tmp/boot-repair.log ]; then
                if grep -qi "WARN\|ERROR\|failed" /tmp/boot-repair.log 2>/dev/null; then
                    # Use textbox for proper scrollable log display (avoids text cramming)
                    dlg --title " Boot Repair Summary " --textbox /tmp/boot-repair.log 22 78 || true
                fi
            fi
            return 0
        else
            dlg_msg " Failed " "\
 The drive could not be written.\n\n Verify the drive is connected and retry."
            return 1
        fi
    else
        echo ""
        echo "  Writing image to /dev/${disk}..."
        echo ""
        if xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${disk}" bs=4M status=progress conv=fsync 2>&1; then
            sync
            echo "  Repairing GPT header..."
            if command -v sgdisk >/dev/null 2>&1; then
                sgdisk -e "/dev/${disk}" 2>/dev/null || true
            elif command -v gdisk >/dev/null 2>&1; then
                printf 'v\nw\nY\n' | gdisk "/dev/${disk}" 2>/dev/null || true
            else
                parted -s "/dev/${disk}" print fix 2>/dev/null || true
            fi
            blockdev --rereadpt "/dev/${disk}" 2>/dev/null || true
            partprobe "/dev/${disk}" 2>/dev/null || true
            sleep 3
            echo "  Repairing bootloader..."
            repair_disk_and_bootloader "$disk"
            apply_post_install_config "$disk"
            return 0
        else
            echo "  ERROR: Installation failed!"
            return 1
        fi
    fi
}

screen_complete() {
    # Determine expected IP address
    local iora_ip=""
    local ip_note=""
    if [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        iora_ip="$IORA_IP"
    else
        # Try to read current DHCP lease from any active interface
        for iface in /sys/class/net/*; do
            local name=$(basename "$iface")
            [ "$name" = "lo" ] && continue
            local addr=$(ip -4 addr show "$name" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
            if [ -n "$addr" ]; then
                iora_ip="$addr"
                break
            fi
        done
        if [ -z "$iora_ip" ]; then
            iora_ip="${IORA_HOSTNAME}.local"
            ip_note="  (IP not yet known -- check MOTD after login)"
        else
            ip_note="  (DHCP -- may differ after reboot)"
        fi
    fi

    if [ -n "$DIALOG_BIN" ]; then
        local action
        action=$(dlg --title " Setup Complete " --menu "\
 IORA OS has been written to /dev/${SEL_DISK}.

 Setup wizard URL after reboot:
     http://${iora_ip}:8080
${ip_note}

 First-boot settings:
     Hostname: ${IORA_HOSTNAME}
     Timezone: ${IORA_TIMEZONE}

 Remove the installation media before continuing.\n" \
                    20 66 3 \
            "reboot"   "Reboot now (recommended)" \
            "shell"    "Drop to shell" \
            "poweroff" "Shut down" \
            3>&1 1>&2 2>&3)

        case "$action" in
            reboot)   umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f ;;
            poweroff) umount "${ISO_MOUNT}" 2>/dev/null; sync; poweroff -f ;;
            shell)    return 0 ;;
            *)        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f ;;
        esac
    else
        echo ""
        echo "  IORA OS installed successfully!"
        echo ""
        echo "  After rebooting, open a browser:"
        echo "    http://${iora_ip}:8080"
        [ -n "$ip_note" ] && echo "  ${ip_note}"
        echo ""
        echo "  Remove the media and press ENTER to reboot..."
        read _
        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f
    fi
}

# -- Cancel / Interrupt handler -------------------------------------
# Called whenever a wizard step returns non-zero (user pressed Cancel or
# Esc). Instead of aborting the installer straight away, show a menu:
#   - Retry current step
#   - Jump to a specific step
#   - Start the wizard over
#   - Reboot / Power off
#   - Drop to a rescue shell
#   - Confirm abort
#
# Communicates back via the global WIZARD_NEXT_STEP:
#   <N>  = jump to step N (1 = start)
#   0    = current step (retry)
#   -1   = abort confirmed
wizard_cancel_menu() {
    local current_step="$1"
    local current_name="${2:-current step}"
    local choice

    if [ -z "$DIALOG_BIN" ]; then
        # Fallback for raw TTYs without dialog: keep legacy behavior.
        WIZARD_NEXT_STEP=-1
        return 0
    fi

    choice=$(dlg --title " Cancelled -- what next? " \
        --cancel-label "Back" \
        --menu "\n You cancelled '${current_name}'.\n\n What would you like to do?\n" \
        20 72 10 \
        "retry"    "Stay on this step and try again" \
        "back"     "Go back one step" \
        "jump"     "Jump to a specific step..." \
        "restart"  "Start the wizard from the beginning" \
        "shell"    "Drop to a rescue shell (/bin/sh)" \
        "reboot"   "Cancel installation and reboot" \
        "poweroff" "Cancel installation and power off" \
        "abort"    "Exit the installer (return to main menu)" \
        3>&1 1>&2 2>&3) || {
        # User pressed Cancel/Back in the cancel menu itself -> retry.
        WIZARD_NEXT_STEP=0
        return 0
    }

    case "$choice" in
        retry)
            WIZARD_NEXT_STEP=0
            ;;
        back)
            if [ "$current_step" -gt 1 ]; then
                WIZARD_NEXT_STEP=$((current_step - 1))
            else
                WIZARD_NEXT_STEP=1
            fi
            ;;
        jump)
            local target
            target=$(dlg --title " Jump to step " \
                --cancel-label "Back" \
                --menu "\n Select which step to jump to:\n" 22 72 14 \
                "1"  "System information" \
                "2"  "Hostname" \
                "3"  "Timezone" \
                "4"  "Language / locale" \
                "5"  "Keyboard layout" \
                "6"  "Network configuration" \
                "7"  "Root password" \
                "8"  "User account" \
                "9"  "Installation type" \
                "10" "Disk selection" \
                "11" "Partitioning strategy" \
                "12" "Final confirmation" \
                3>&1 1>&2 2>&3) || {
                # Cancel inside jump submenu -> retry.
                WIZARD_NEXT_STEP=0
                return 0
            }
            WIZARD_NEXT_STEP="$target"
            ;;
        restart)
            WIZARD_NEXT_STEP=1
            ;;
        shell)
            dlg_msg " Rescue shell " "\
 You will now be dropped into /bin/sh.\n\n\
 Type 'exit' to return to the installer."
            clear 2>/dev/null || true
            /bin/sh || true
            WIZARD_NEXT_STEP=0
            ;;
        reboot)
            if dlg_yesno " Reboot " "\
 Cancel the installation and reboot now?"; then
                umount "${ISO_MOUNT}" 2>/dev/null || true
                sync
                reboot -f
                exit 0
            fi
            WIZARD_NEXT_STEP=0
            ;;
        poweroff)
            if dlg_yesno " Power off " "\
 Cancel the installation and power off now?"; then
                umount "${ISO_MOUNT}" 2>/dev/null || true
                sync
                poweroff -f
                exit 0
            fi
            WIZARD_NEXT_STEP=0
            ;;
        abort)
            if dlg_yesno " Abort installation " "\
 Exit the installer back to the main menu?\n\n\
 No changes have been made to the disk."; then
                WIZARD_NEXT_STEP=-1
            else
                WIZARD_NEXT_STEP=0
            fi
            ;;
        *)
            WIZARD_NEXT_STEP=0
            ;;
    esac
    return 0
}

# Wrap a wizard step so that cancel opens the cancel menu. Sets
# WIZARD_NEXT_STEP either to the current step number (advance on
# success) or to whatever the cancel menu decided.
#
# Usage:  wizard_step <step_number> <step_name> <function_to_call>
wizard_step() {
    local step_num="$1"
    local step_name="$2"
    local step_func="$3"
    if "$step_func"; then
        WIZARD_NEXT_STEP=$((step_num + 1))
        return 0
    fi
    wizard_cancel_menu "$step_num" "$step_name"
    return 1
}

# -- Main wizard flow -----------------------------------------------
run_wizard() {
    # Detect virtualization/container environment early so every screen
    # (welcome, sysinfo, summary) can display it.
    detect_virtualization
    if [ "$IORA_VIRT_TYPE" != "none" ] || [ "$IORA_VIRT_CONTAINER" != "none" ]; then
        BACKTITLE="IORA OS Installer  |  ${IORA_VIRT_LABEL}  |  Tab/Arrows navigate, Enter confirms"
    fi

    # Step 0: Welcome / main menu. Returns non-zero if user picked a side
    # action (rescue/shell/reboot); main dispatch has already handled it.
    if ! screen_welcome; then
        return 0
    fi

    # Mount media with retries
    dlg_info " Scanning " "  Searching for installation media..."
    sleep 1

    local mounted=false attempt=0
    while [ "$attempt" -lt 5 ]; do
        if mount_iso; then mounted=true; break; fi
        attempt=$((attempt + 1))
        dlg_info " Scanning " "  Scanning for devices... attempt ${attempt} of 5"
        sleep 2
    done

    if [ "$mounted" = false ]; then
        # Collect visible block devices to aid diagnostics.
        local _blkdevs=""
        for _d in /dev/sr0 /dev/sr1 /dev/cdrom /dev/sd[a-z] /dev/vd[a-z] /dev/nvme0n1; do
            [ -b "$_d" ] && _blkdevs="${_blkdevs} $_d"
        done
        [ -z "$_blkdevs" ] && _blkdevs=" (none detected -- VMware SCSI driver may be missing)"
        dlg_msg " Error " "\
 Could not find the IORA OS image.\n\n\
 Make sure the installer ISO or USB\n\
 is connected and contains the installer payload.\n\n\
 Detected block devices:${_blkdevs}\n\n\
 If running under VMware, ensure the VM SCSI adapter\n\
 is set to LSI Logic or SATA (not BusLogic).\n\n\
 Type 'install' to retry."
        return 1
    fi

    img_size=$(ls -lh "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '{print $5}')
    load_payload_metadata || true

    if [ "$PAYLOAD_BOOTABLE" = "no" ] || [ "$PAYLOAD_MODE" = "fallback" ]; then
        dlg_msg " Unsupported Payload " "\
 This installer media contains a fallback payload.\n\n\
 It can write data to the target disk, but it does not contain\n\
 the validated partition table and bootloader layout required\n\
 for a bootable installation.\n\n\
 Rebuild the image with full post-image flow:\n\
   sudo ./build.sh all --force-full-image --progress"
        return 1
    fi

        if [ ! -d /sys/firmware/efi ] && [ "$PAYLOAD_BOOT_MODE" = "uefi-only" ]; then
                dlg_msg " Firmware Mismatch " "\
 This installer was booted in Legacy BIOS mode,\n\
 but the payload supports UEFI boot only.\n\n\
 Result would be non-bootable on BIOS firmware.\n\n\
 Options:\n\
     1) Boot the installer in UEFI mode and install again\n\
     2) Rebuild with BIOS GRUB modules available (grub-pc-bin)"
                return 1
        fi

    # Integrity check
    if [ -f "${ISO_MOUNT}/${ISO_IMAGE}.sha256" ]; then
        dlg_info " Integrity Check " "  Verifying SHA256 checksum..."
        if (cd "${ISO_MOUNT}" && sha256sum -c "${ISO_IMAGE}.sha256" >/dev/null 2>&1); then
            dlg_info " Verified " "  Image integrity: OK  [${img_size}]"
            sleep 1
        else
            dlg_msg " Checksum Error " "\
 Image checksum verification FAILED!\n\n\
 The installation image may be corrupted.\n\
 Re-download or re-create the installer.\n\n\
 Installation will not continue."
            return 1
        fi
    fi

    # -- State-machine step dispatch --------------------------------
    # Each cancellable step is wrapped so that pressing Cancel opens the
    # cancel menu (retry / back / jump / restart / shell / reboot /
    # poweroff / abort) instead of aborting immediately.
    local step=1
    WIZARD_NEXT_STEP=1
    while [ "$step" -ge 1 ] && [ "$step" -le 12 ]; do
        case "$step" in
            1)  wizard_step 1  "System information" screen_sysinfo          || true ;;
            2)  wizard_step 2  "Hostname"           screen_hostname          || true ;;
            3)  wizard_step 3  "Timezone"           screen_timezone          || true ;;
            4)  wizard_step 4  "Language / locale"  screen_locale            || true ;;
            5)  wizard_step 5  "Keyboard layout"    screen_keyboard          || true ;;
            6)  wizard_step 6  "Network"            screen_network           || true ;;
            7)  wizard_step 7  "Root password"      screen_password          || true ;;
            8)  wizard_step 8  "User account"       screen_user              || true ;;
            9)  wizard_step 9  "Installation type"  screen_installation_type || true ;;
            10) wizard_step 10 "Disk selection"     screen_select_disk       || true ;;
            11) wizard_step 11 "Partitioning"       screen_partitioning      || true ;;
            12) wizard_step 12 "Final confirmation" _wizard_final_confirm    || true ;;
        esac

        if [ "$WIZARD_NEXT_STEP" = "-1" ]; then
            return 1
        fi
        if [ "$WIZARD_NEXT_STEP" = "0" ]; then
            # retry current step
            continue
        fi
        step="$WIZARD_NEXT_STEP"
    done

    # Step 13: Install (not cancellable from here on -- actual write).
    if ! screen_install; then
        return 1
    fi

    # Step 14: Done
    screen_complete
}

# Helper for the "final confirmation" step -- combines the existing
# post-partitioning safety prompts and screen_confirm into a single
# cancellable unit so the cancel menu can treat it as step 12.
_wizard_final_confirm() {
    if [ "$PARTITION_MODE" = "auto" ] || [ "$PARTITION_MODE" = "encrypted" ]; then
        if disk_has_existing_data "$SEL_DISK"; then
            if ! dlg_yesno " Existing Data Detected " "\
 Data or partitions were found on /dev/${SEL_DISK}.\n\n\
 Continuing will delete everything on this drive.\n\n\
 Do you want to erase the entire drive and continue?"; then
                return 1
            fi
        fi
    fi

    if [ "$IORA_INSTALL_MODE" = "guided-safe" ]; then
        if ! dlg_yesno " Final Erase Check " "\
 Final safety check for /dev/${SEL_DISK}.\n\n\
 Confirm again that all data on this drive\n\
 may be removed permanently."; then
            return 1
        fi
    fi

    screen_confirm
}

# -- Entry point ----------------------------------------------------

# Helper commands for the recovery shell
cat > /bin/install <<'SHEOF'
#!/bin/sh
exec /init
SHEOF
chmod +x /bin/install 2>/dev/null || true

cat > /bin/sysinfo <<'SHEOF'
#!/bin/sh
echo ""
echo "  === System Information ==="
echo "  CPU:     $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')"
echo "  Cores:   $(grep -c '^processor' /proc/cpuinfo 2>/dev/null)"
echo "  Memory:  $(awk '/MemTotal/{printf "%.0f MB", $2/1024}' /proc/meminfo 2>/dev/null)"
echo "  Boot:    $([ -d /sys/firmware/efi ] && echo UEFI || echo BIOS)"
echo ""
echo "  === Block Devices ==="
lsblk 2>/dev/null || ls -l /sys/block/
echo ""
echo "  === Network ==="
ip -brief addr 2>/dev/null || ifconfig 2>/dev/null || echo "  (no ip/ifconfig)"
echo ""
SHEOF
chmod +x /bin/sysinfo 2>/dev/null || true

cat > /bin/netsetup <<'SHEOF'
#!/bin/sh
echo "  Bringing up network interfaces..."
for iface in /sys/class/net/*; do
    name=$(basename "$iface")
    [ "$name" = "lo" ] && continue
    ip link set "$name" up 2>/dev/null
    udhcpc -i "$name" -n -q 2>/dev/null && echo "  $name: DHCP OK" && exit 0
    dhclient "$name" 2>/dev/null && echo "  $name: DHCP OK" && exit 0
done
echo "  No DHCP lease obtained."
SHEOF
chmod +x /bin/netsetup 2>/dev/null || true

run_wizard
rc=$?

echo ""
echo "  Available commands:"
echo "    install  - Restart the installation wizard"
echo "    sysinfo  - Show system information"
echo "    netsetup - Configure network via DHCP"
echo "    reboot   - Reboot the system"
echo "    poweroff - Shut down"
echo ""

if [ -x /bin/bash ]; then
    exec /bin/bash
elif [ -x /bin/sh ]; then
    exec /bin/sh
elif [ -x /bin/busybox ]; then
    exec /bin/busybox sh
else
    exec sh
fi
INITEOF
    chmod +x "${work_dir}/init"

    # Build a tiny cpio archive containing only our /init
    local supplement="${work_dir}/supplement.cpio.gz"
    if ! (cd "${work_dir}" && echo init | cpio -ov --format=newc 2>/dev/null | gzip -9 > "${supplement}"); then
        log_warn "Failed to create init supplement cpio"
        rm -rf "${work_dir}"
        return 1
    fi

    # Concatenate: original rootfs cpio + our init override
    cat "${source_initrd}" "${supplement}" > "${runtime_initrd}"

    rm -rf "${work_dir}"
    log_info "Installer runtime initrd created ($(du -h "${runtime_initrd}" | cut -f1)) via cpio concatenation"
    return 0
}

create_bootable_installer_iso() {
    log_info "Creating bootable installer ISO (UEFI/GRUB)..."

    if [ -f "${FALLBACK_MARKER}" ]; then
        log_error "Base image is in fallback mode and is not safe to ship inside the bootable installer ISO."
        log_error "The installer would write a non-partitioned/non-validated payload to disk."
        log_info "Rebuild with privileges and full post-image flow: sudo ./build.sh all --force-full-image --progress"
        mark_skipped "iora-os-installer-boot.iso (fallback payload not bootable)"
        return
    fi

    if ! command -v grub-mkrescue &> /dev/null; then
        log_warn "grub-mkrescue not available, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (missing grub-mkrescue)"
        return
    fi

    if [ ! -f "${OUTPUT_DIR}/bzImage" ]; then
        log_warn "bzImage missing, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (missing bzImage)"
        return
    fi

    local installer_initrd=""
    if ! installer_initrd=$(resolve_installer_initrd); then
        log_warn "No usable initrd source found (tried rootfs.cpio.gz/rootfs.cpio), skipping bootable installer ISO"
        log_warn "Run: ./build.sh resume --reconfigure --progress to regenerate Buildroot cpio initramfs outputs"
        mark_skipped "iora-os-installer-boot.iso (missing initrd source)"
        return
    fi

    local runtime_initrd="${OUTPUT_DIR}/installer-runtime.cpio.gz"
    if ! build_installer_runtime_initrd "${installer_initrd}" "${runtime_initrd}"; then
        log_warn "Failed to build installer runtime initrd, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (failed to create runtime initrd)"
        return
    fi

    if [ ! -f "${RELEASE_DIR}/iora-os.img.xz" ]; then
        log_warn "iora-os.img.xz missing in release directory, skipping bootable installer ISO"
        mark_skipped "iora-os-installer-boot.iso (missing iora-os.img.xz)"
        return
    fi

    local stage_dir
    stage_dir=$(mktemp -d)
    mkdir -p "${stage_dir}/boot/grub"

    cp "${OUTPUT_DIR}/bzImage" "${stage_dir}/boot/vmlinuz"
    cp "${runtime_initrd}" "${stage_dir}/boot/initrd.img"
    cp "${RELEASE_DIR}/iora-os.img.xz" "${stage_dir}/iora-os.img.xz"
    write_payload_metadata "${stage_dir}"

    # Generate SHA256 checksum for integrity verification
    log_info "Generating SHA256 checksum for iora-os.img.xz..."
    (cd "${stage_dir}" && sha256sum iora-os.img.xz > iora-os.img.xz.sha256)

    # Copy additional release artifacts if present
    for f in "${RELEASE_DIR}/iora-os.qcow2.xz" \
             "${RELEASE_DIR}/iora-os.vdi.xz" \
             "${RELEASE_DIR}/iora-os.vmdk.xz" \
             "${RELEASE_DIR}/iora-os-update.raucb"; do
        if [ -f "$f" ]; then
            log_info "Including $(basename "$f") in installer ISO"
            cp "$f" "${stage_dir}/"
            (cd "${stage_dir}" && sha256sum "$(basename "$f")" >> checksums.sha256)
        fi
    done

    # Append main image checksum to combined checksums file
    cat "${stage_dir}/iora-os.img.xz.sha256" >> "${stage_dir}/checksums.sha256" 2>/dev/null || true

    # Version & build metadata
    local kernel_ver=""
    kernel_ver=$(file "${OUTPUT_DIR}/bzImage" 2>/dev/null | grep -oP 'version \K[0-9.]+' || echo "unknown")
    cat > "${stage_dir}/VERSION" <<VEOF
IORA OS
Build:   $(date '+%Y-%m-%d %H:%M:%S')
Kernel:  ${kernel_ver}
Image:   iora-os.img.xz ($(du -h "${stage_dir}/iora-os.img.xz" | cut -f1))
VEOF

    cat > "${stage_dir}/README-INSTALLER.txt" <<'EOF'
IORA OS Bootable Installer ISO

This ISO boots into an interactive installation wizard.
Follow the on-screen prompts to select a target disk and install.

Included files:
- iora-os.img.xz           Compressed raw disk image
- iora-os.img.xz.sha256    SHA256 checksum
- checksums.sha256          All checksums
- VERSION                   Build information

If you need manual control, choose "Drop to shell" from the menu.
You can re-launch the wizard at any time by typing: install

Manual install from shell:
  mkdir -p /mnt/iso
  mount /dev/sr0 /mnt/iso
  sha256sum -c /mnt/iso/iora-os.img.xz.sha256
  xzcat /mnt/iso/iora-os.img.xz | dd of=/dev/sdX bs=4M status=progress
  sync && reboot
EOF

    cat > "${stage_dir}/boot/grub/grub.cfg" <<'EOF'
set timeout=10
set default=0

# Try to load a pretty font if available
if loadfont /boot/grub/fonts/unicode.pf2 ; then
    set gfxmode=auto
    insmod all_video
    insmod gfxterm
    terminal_output gfxterm
fi

menuentry "IORA OS Installer" {
    linux /boot/vmlinuz nomodeset
    initrd /boot/initrd.img
}

menuentry "IORA OS Installer (serial console)" {
    linux /boot/vmlinuz console=tty0 console=ttyS0,115200 nomodeset
    initrd /boot/initrd.img
}

menuentry "IORA OS Installer (safe mode)" {
    linux /boot/vmlinuz nomodeset noapic acpi=off
    initrd /boot/initrd.img
}
EOF

    local grub_log
    grub_log=$(mktemp)
    local grub_ok=0

    # Check whether grub-mkrescue can actually produce a UEFI-bootable ISO.
    # Its UEFI path needs mtools (mformat/mcopy) and xorriso. Without those,
    # grub-mkrescue silently produces a BIOS-only ISO that won't boot on UEFI
    # firmware. Warn loudly so the user knows what to install.
    local have_mtools=1 have_xorriso=1 have_grub_efi=1
    command -v mformat   >/dev/null 2>&1 || have_mtools=0
    command -v mcopy     >/dev/null 2>&1 || have_mtools=0
    command -v xorriso   >/dev/null 2>&1 || have_xorriso=0
    command -v grub-mkstandalone >/dev/null 2>&1 || have_grub_efi=0
    [ -d /usr/lib/grub/x86_64-efi ] || [ -d /usr/share/grub/x86_64-efi ] || have_grub_efi=0

    if [ "${have_mtools}" -eq 0 ] || [ "${have_xorriso}" -eq 0 ]; then
        log_warn "mtools and/or xorriso missing — grub-mkrescue may produce a BIOS-only ISO."
        log_warn "Install them for UEFI support:  sudo apt install mtools xorriso"
    fi

    # Primary path: grub-mkrescue (hybrid BIOS+UEFI ISO)
    if grub-mkrescue \
        --modules="part_gpt part_msdos fat ext2 normal configfile echo linux all_video" \
        -o "${RELEASE_DIR}/iora-os-installer-boot.iso" \
        "${stage_dir}" >"${grub_log}" 2>&1; then
        grub_ok=1
    fi

    # Verify the ISO is actually UEFI-bootable: it must contain an EFI boot
    # image (either as El Torito EFI boot catalog entry or an ESP partition).
    # xorriso's "-report_el_torito plain" output uses columns like:
    #   El Torito boot img : 1  BIOS  y   none ...
    #   El Torito boot img : 2  UEFI  y   none ...
    # or "platform id 0xEF" in older versions. Also accept a GPT/MBR partition
    # of type 0xEF (ESP) exposed by `-report_system_area plain`.
    local iso_uefi_ok=0
    if [ "${grub_ok}" -eq 1 ] && command -v xorriso >/dev/null 2>&1; then
        local _xorep
        _xorep=$(xorriso -indev "${RELEASE_DIR}/iora-os-installer-boot.iso" \
                         -report_el_torito plain 2>/dev/null)
        if echo "$_xorep" | grep -qiE 'UEFI|\bEFI\b|efi\.img|platform[[:space:]]+(id[[:space:]]+)?0xef|0xEF'; then
            iso_uefi_ok=1
        fi
        # Secondary check: a GPT partition of type EF00 (ESP) inside the ISO.
        if [ "${iso_uefi_ok}" -eq 0 ]; then
            if xorriso -indev "${RELEASE_DIR}/iora-os-installer-boot.iso" \
                       -report_system_area plain 2>/dev/null \
                 | grep -qiE 'ESP|efi|0xef'; then
                iso_uefi_ok=1
            fi
        fi
    fi

    if [ "${grub_ok}" -eq 1 ] && [ "${iso_uefi_ok}" -eq 0 ]; then
        log_warn "Generated ISO does not expose a UEFI boot entry; rebuilding with explicit ESP..."
        # Keep the BIOS-only ISO as a backup in case the manual rebuild fails.
        cp -f "${RELEASE_DIR}/iora-os-installer-boot.iso" \
              "${RELEASE_DIR}/iora-os-installer-boot.iso.bios-only" 2>/dev/null || true
        grub_ok=0
    fi

    # Fallback: build the hybrid ISO manually with an explicit ESP image.
    # Uses mtools (no loop mount -> works without root) + grub-mkstandalone.
    if [ "${grub_ok}" -eq 0 ] && [ "${have_xorriso}" -eq 1 ] && \
       [ "${have_mtools}" -eq 1 ] && [ "${have_grub_efi}" -eq 1 ]; then
        log_info "Building hybrid BIOS+UEFI ISO manually (grub-mkstandalone + mtools + xorriso)..."

        local efi_img="${stage_dir}/boot/efi.img"
        local efi_size_mb=10
        local bios_core="${stage_dir}/boot/eltorito.img"

        # 1. Build a standalone grub x86_64-efi image that embeds our grub.cfg.
        #    --locales="" and --fonts="" keep the binary small.
        if grub-mkstandalone --format=x86_64-efi \
             --output="${stage_dir}/BOOTX64.EFI" \
             --locales="" --fonts="" \
             --modules="part_gpt part_msdos fat ext2 iso9660 normal configfile linux echo search search_label search_fs_uuid chain multiboot2 video all_video efi_gop efi_uga" \
             "boot/grub/grub.cfg=${stage_dir}/boot/grub/grub.cfg" \
             >>"${grub_log}" 2>&1; then

            # 2. Create a FAT-formatted ESP image using mtools (no loop mount).
            dd if=/dev/zero of="${efi_img}" bs=1M count="${efi_size_mb}" status=none 2>/dev/null
            mformat -i "${efi_img}" -F -v "IORA_EFI" :: >>"${grub_log}" 2>&1 || true
            mmd -i "${efi_img}" ::/EFI >>"${grub_log}" 2>&1 || true
            mmd -i "${efi_img}" ::/EFI/BOOT >>"${grub_log}" 2>&1 || true
            mcopy -i "${efi_img}" "${stage_dir}/BOOTX64.EFI" ::/EFI/BOOT/BOOTX64.EFI >>"${grub_log}" 2>&1 || true
            rm -f "${stage_dir}/BOOTX64.EFI"

            # 3. Build a BIOS core.img as an El Torito boot image.
            #    grub-mkstandalone --format=i386-pc-eltorito emits a complete
            #    cdboot+core image that can be used directly by xorriso.
            #    NOTE: grub-mkstandalone does NOT accept --install-modules;
            #    only --modules. Including that flag silently fails on some
            #    grub versions and produces a non-bootable image.
            local bios_built=0
            if grub-mkstandalone --format=i386-pc-eltorito \
                 --output="${bios_core}" \
                 --locales="" --fonts="" \
                 --modules="biosdisk part_gpt part_msdos fat ext2 iso9660 normal configfile linux echo search search_label search_fs_uuid chain cat ls help" \
                 "boot/grub/grub.cfg=${stage_dir}/boot/grub/grub.cfg" \
                 >>"${grub_log}" 2>&1; then
                bios_built=1
            else
                # Last resort: concatenate cdboot.img + a separately-built core.img.
                if [ -f /usr/lib/grub/i386-pc/cdboot.img ] \
                   && command -v grub-mkimage >/dev/null 2>&1; then
                    local _core="${stage_dir}/boot/core-tmp.img"
                    if grub-mkimage -O i386-pc -o "${_core}" -p /boot/grub \
                         biosdisk part_gpt part_msdos fat ext2 iso9660 \
                         normal configfile linux echo search search_label \
                         search_fs_uuid chain cat ls help \
                         >>"${grub_log}" 2>&1; then
                        cat /usr/lib/grub/i386-pc/cdboot.img "${_core}" > "${bios_core}"
                        rm -f "${_core}"
                        bios_built=1
                    fi
                fi
            fi
            [ "${bios_built}" -eq 0 ] && log_warn "Could not build BIOS el-torito image"

            # 4. Look up an isohybrid MBR template (lets the ISO boot from USB
            #    as a hybrid BIOS disk image, not just as a CD).
            local iso_mbr=""
            for _mbr in /usr/lib/grub/i386-pc/boot_hybrid.img \
                        /usr/lib/grub/i386-pc/boot.img \
                        /usr/lib/ISOLINUX/isohdpfx.bin \
                        /usr/share/syslinux/isohdpfx.bin; do
                [ -f "$_mbr" ] && iso_mbr="$_mbr" && break
            done

            # 5. Pack everything into a hybrid ISO with xorriso.
            if [ "${bios_built}" -eq 1 ] && xorriso -as mkisofs \
                 -iso-level 3 -full-iso9660-filenames \
                 -volid "IORA_INSTALLER" \
                 ${iso_mbr:+-isohybrid-mbr "$iso_mbr"} \
                 -eltorito-boot boot/eltorito.img \
                   -no-emul-boot -boot-load-size 4 -boot-info-table \
                 -eltorito-alt-boot \
                   -e boot/efi.img -no-emul-boot \
                   -isohybrid-gpt-basdat \
                 -o "${RELEASE_DIR}/iora-os-installer-boot.iso" \
                 "${stage_dir}" >>"${grub_log}" 2>&1; then
                grub_ok=1
                log_info "Hybrid BIOS+UEFI ISO built manually."
            fi
        fi
    fi

    if [ "${grub_ok}" -eq 0 ]; then
        # Manual UEFI rebuild failed. If the original grub-mkrescue output
        # exists as .bios-only, fall back to it — a BIOS-bootable ISO is
        # still better than nothing, and many test VMs default to BIOS.
        if [ -f "${RELEASE_DIR}/iora-os-installer-boot.iso.bios-only" ]; then
            mv -f "${RELEASE_DIR}/iora-os-installer-boot.iso.bios-only" \
                  "${RELEASE_DIR}/iora-os-installer-boot.iso"
            log_warn "Restored BIOS-only ISO from grub-mkrescue (UEFI unavailable)."
            grub_ok=1
        else
            log_warn "All ISO generation attempts failed. Log:"
            tail -n 40 "${grub_log}" | while IFS= read -r line; do log_warn "  ${line}"; done
        fi
    else
        # Success: remove the .bios-only backup if it's still there.
        rm -f "${RELEASE_DIR}/iora-os-installer-boot.iso.bios-only" 2>/dev/null || true
    fi

    rm -f "${grub_log}"
    rm -rf "${stage_dir}"

    if [ "${grub_ok}" -eq 0 ]; then
        mark_skipped "iora-os-installer-boot.iso (grub-mkrescue and fallback both failed)"
        return
    fi

    # ── Verify that iora-os.img.xz is actually embedded in the ISO ────────────
    # Some versions of grub-mkrescue silently omit very large files or fail to
    # include them when underlying tools (genisoimage, mkisofs) have size or
    # filename restrictions.  A missing payload causes "Could not find the IORA
    # OS image" at install time.  Catch this at build time instead.
    local payload_ok=0
    if command -v xorriso >/dev/null 2>&1; then
        if xorriso -indev "${RELEASE_DIR}/iora-os-installer-boot.iso" \
                   -find / -name "iora-os.img.xz" 2>/dev/null | grep -q "iora-os.img.xz"; then
            payload_ok=1
        fi
    elif command -v isoinfo >/dev/null 2>&1; then
        if isoinfo -i "${RELEASE_DIR}/iora-os-installer-boot.iso" \
                   -l 2>/dev/null | grep -qi "iora-os.img"; then
            payload_ok=1
        fi
    else
        # No ISO inspection tool available; trust the build succeeded.
        log_warn "Neither xorriso nor isoinfo available; cannot verify ISO payload contents."
        payload_ok=1
    fi

    if [ "${payload_ok}" -eq 0 ]; then
        log_error "iora-os.img.xz is NOT embedded inside iora-os-installer-boot.iso!"
        log_error "The installer would fail with 'Could not find the IORA OS image'."
        log_error "This can happen with older versions of grub-mkrescue or genisoimage."
        log_error "Install xorriso and mtools, then rebuild: sudo apt install xorriso mtools"
        rm -f "${RELEASE_DIR}/iora-os-installer-boot.iso" 2>/dev/null || true
        mark_skipped "iora-os-installer-boot.iso (payload iora-os.img.xz missing from ISO)"
        return
    fi

    local size
    size=$(du -h "${RELEASE_DIR}/iora-os-installer-boot.iso" | cut -f1)
    log_success "Bootable installer ISO created: iora-os-installer-boot.iso (${size})"
    mark_created "iora-os-installer-boot.iso"
}

create_raw_image() {
    log_info "Creating raw disk image (img.xz)..."

    if [ ! -f "${OUTPUT_DIR}/iora-os.img" ]; then
        log_error "Base image not found at ${OUTPUT_DIR}/iora-os.img"
        return 1
    fi

    # Always regenerate compressed output to avoid stale artifacts.
    cd "${OUTPUT_DIR}"
    rm -f iora-os.img.xz
    log_info "Compressing raw image with xz..."
    xz_compress_file "iora-os.img" "iora-os.img.xz"

    cp iora-os.img.xz "${RELEASE_DIR}/"

    if [ -f "${FALLBACK_MARKER}" ]; then
        log_warn "Raw image was generated from fallback mode (rootfs.ext2-only)."
        log_warn "This artifact is not a validated bootable disk image."
        log_warn "Rebuild with: sudo ./build.sh all --force-full-image --progress"
    fi

    local size=$(du -h "${RELEASE_DIR}/iora-os.img.xz" | cut -f1)
    log_success "Raw image created: iora-os.img.xz (${size})"
    mark_created "iora-os.img.xz"
}

create_qcow2_image() {
    log_info "Creating QEMU qcow2 image..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.qcow2.xz (base image not validated bootable)"
        return
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping qcow2"
        mark_skipped "iora-os.qcow2.xz (missing qemu-img)"
        return
    fi

    cd "${OUTPUT_DIR}"
    rm -f iora-os.qcow2 iora-os.qcow2.xz

    # Convert to qcow2
    log_info "Converting to qcow2 format..."
    qemu-img convert -f raw -O qcow2 -c iora-os.img iora-os.qcow2

    # Compress with xz
    log_info "Compressing qcow2 with xz..."
    xz_compress_file "iora-os.qcow2" "iora-os.qcow2.xz"

    cp iora-os.qcow2.xz "${RELEASE_DIR}/"
    rm -f iora-os.qcow2  # Clean up uncompressed intermediate file

    local size=$(du -h "${RELEASE_DIR}/iora-os.qcow2.xz" | cut -f1)
    log_success "QEMU image created: iora-os.qcow2.xz (${size})"
    mark_created "iora-os.qcow2.xz"
}

create_vdi_image() {
    log_info "Creating VirtualBox VDI image..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.vdi.zip (base image not validated bootable)"
        return
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping VDI"
        mark_skipped "iora-os.vdi.zip (missing qemu-img)"
        return
    fi

    cd "${OUTPUT_DIR}"
    rm -f iora-os.vdi iora-os.vdi.zip

    # Convert to VDI
    log_info "Converting to VDI format..."
    qemu-img convert -f raw -O vdi iora-os.img iora-os.vdi

    # Create zip archive
    log_info "Creating VDI zip archive..."
    zip -9 iora-os.vdi.zip iora-os.vdi

    cp iora-os.vdi.zip "${RELEASE_DIR}/"
    rm -f iora-os.vdi  # Clean up intermediate file

    local size=$(du -h "${RELEASE_DIR}/iora-os.vdi.zip" | cut -f1)
    log_success "VirtualBox image created: iora-os.vdi.zip (${size})"
    mark_created "iora-os.vdi.zip"
}

create_vmdk_image() {
    log_info "Creating VMware VMDK image..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.vmdk.zip (base image not validated bootable)"
        return
    fi

    if ! command -v qemu-img &> /dev/null; then
        log_warn "qemu-img not available, skipping VMDK"
        mark_skipped "iora-os.vmdk.zip (missing qemu-img)"
        return
    fi

    cd "${OUTPUT_DIR}"
    rm -f iora-os.vmdk iora-os.vmdk.zip

    # Convert to VMDK
    log_info "Converting to VMDK format..."
    qemu-img convert -f raw -O vmdk iora-os.img iora-os.vmdk

    # Create zip archive
    log_info "Creating VMDK zip archive..."
    zip -9 iora-os.vmdk.zip iora-os.vmdk

    cp iora-os.vmdk.zip "${RELEASE_DIR}/"
    rm -f iora-os.vmdk  # Clean up intermediate file

    local size=$(du -h "${RELEASE_DIR}/iora-os.vmdk.zip" | cut -f1)
    log_success "VMware image created: iora-os.vmdk.zip (${size})"
    mark_created "iora-os.vmdk.zip"
}

create_ova_image() {
    log_info "Creating OVA (Open Virtualization Archive)..."

    if ! require_bootable_base_image; then
        mark_skipped "iora-os.ova (base image not validated bootable)"
        return
    fi

    if ! command -v VBoxManage &> /dev/null; then
        log_warn "VBoxManage not available, skipping OVA"
        mark_skipped "iora-os.ova (missing VBoxManage)"
        return
    fi

    cd "${OUTPUT_DIR}"

    # Create temporary VM
    local VM_UUID="${VM_NAME}-temp-$(date +%s)"

    log_info "Creating temporary VirtualBox VM..."
    VBoxManage createvm --name "${VM_UUID}" --ostype "Linux_64" --register

    # Configure VM
    VBoxManage modifyvm "${VM_UUID}" \
        --memory ${VM_MEMORY_MB} \
        --cpus ${VM_CPUS} \
        --nic1 nat \
        --boot1 disk \
        --acpi on \
        --ioapic on \
        --rtcuseutc on

    # Create and attach storage
    if [ ! -f "iora-os.vdi" ]; then
        qemu-img convert -f raw -O vdi iora-os.img iora-os.vdi
    fi

    VBoxManage storagectl "${VM_UUID}" --name "SATA" --add sata --controller IntelAhci
    VBoxManage storageattach "${VM_UUID}" \
        --storagectl "SATA" \
        --port 0 \
        --device 0 \
        --type hdd \
        --medium "$(pwd)/iora-os.vdi"

    # Export to OVA
    log_info "Exporting to OVA format..."
    VBoxManage export "${VM_UUID}" \
        --output "${RELEASE_DIR}/iora-os.ova" \
        --vsys 0 \
        --product "${VM_NAME}" \
        --producturl "https://github.com/your-org/iora" \
        --vendor "IORA Project" \
        --version "${VM_VERSION}" \
        --description "IORA - Interface for Optimized Residential Autonomy"

    # Cleanup
    log_info "Cleaning up temporary VM..."
    VBoxManage unregistervm "${VM_UUID}" --delete

    local size=$(du -h "${RELEASE_DIR}/iora-os.ova" | cut -f1)
    log_success "OVA created: iora-os.ova (${size})"
    mark_created "iora-os.ova"
}

create_rauc_bundle() {
    log_info "Creating RAUC update bundle..."

    if ! command -v rauc &> /dev/null; then
        log_warn "RAUC not available, skipping update bundle"
        mark_skipped "iora-os-YYYYMMDD.raucb (missing rauc)"
        return
    fi

    # Check for signing keys
    if [ ! -f "${RAUC_CERT}" ] || [ ! -f "${RAUC_KEY}" ]; then
        log_warn "RAUC signing keys not found"
        log_info "Generate with: openssl req -x509 -newkey rsa:4096 -nodes -keyout rauc/key.pem -out rauc/cert.pem -days 3650"
        log_warn "Skipping RAUC bundle creation"
        mark_skipped "iora-os-YYYYMMDD.raucb (missing signing keys)"
        return
    fi

    if [ ! -f "${OUTPUT_DIR}/rootfs.squashfs" ]; then
        log_error "rootfs.squashfs not found"
        return 1
    fi

    cd "${SCRIPT_DIR}/rauc"

    # Create bundle directory
    local BUNDLE_DIR=$(mktemp -d)

    # Copy files
    cp "${OUTPUT_DIR}/rootfs.squashfs" "${BUNDLE_DIR}/"
    cp manifest.raucm "${BUNDLE_DIR}/"
    cp hook.sh "${BUNDLE_DIR}/"
    chmod +x "${BUNDLE_DIR}/hook.sh"

    # Update SHA256 in manifest
    local SHA256=$(sha256sum "${BUNDLE_DIR}/rootfs.squashfs" | awk '{print $1}')
    sed -i "s/sha256=auto/sha256=${SHA256}/" "${BUNDLE_DIR}/manifest.raucm"

    # Create bundle
    log_info "Signing and creating RAUC bundle..."
    rauc bundle \
        --cert="${RAUC_CERT}" \
        --key="${RAUC_KEY}" \
        "${BUNDLE_DIR}" \
        "${RELEASE_DIR}/iora-os-$(date +%Y%m%d).raucb"

    # Cleanup
    rm -rf "${BUNDLE_DIR}"

    local size=$(du -h "${RELEASE_DIR}/iora-os-"*.raucb | cut -f1)
    log_success "RAUC bundle created: iora-os-$(date +%Y%m%d).raucb (${size})"
    mark_created "iora-os-$(date +%Y%m%d).raucb"
}

create_checksums() {
    log_info "Creating checksums file..."

    cd "${RELEASE_DIR}"
    sha256sum * > SHA256SUMS

    log_success "Checksums created: SHA256SUMS"
    mark_created "SHA256SUMS"
}

create_readme() {
    log_info "Creating release README..."

    cat > "${RELEASE_DIR}/README.txt" <<'EOF'
IORA OS - Release Images

This release includes multiple image formats for different deployment scenarios:

1. iora-os.img.xz
   - Raw disk image for USB/SD cards and physical hardware
   - Usage: xzcat iora-os.img.xz | sudo dd of=/dev/sdX bs=4M status=progress

2. iora-os-installer.iso
    - Archive ISO containing iora-os.img.xz and install notes
    - Not directly bootable as an installer medium
    - Usage: Mount/extract the ISO, then flash iora-os.img.xz to your target disk

3. iora-os-installer-boot.iso
    - Bootable installer ISO (GRUB/UEFI, hybrid BIOS+UEFI)
    - Includes kernel, initrd, and iora-os.img.xz payload
    - Boot menu with normal, serial console, and safe mode entries
    - From the installer shell: mount /dev/sr0, then dd the image to disk

4. iora-os.qcow2.xz
   - QEMU/KVM virtual machine image (UEFI boot required)
   - Usage:
     xz -d iora-os.qcow2.xz
     qemu-system-x86_64 -enable-kvm -m 2048 \\
       -bios /usr/share/ovmf/OVMF.fd \\
       -drive file=iora-os.qcow2,format=qcow2

5. iora-os.vdi.zip
   - VirtualBox virtual machine image
   - Usage:
     unzip iora-os.vdi.zip
     Import into VirtualBox using the .vdi file

6. iora-os.vmdk.zip
   - VMware virtual machine image
   - Usage:
     unzip iora-os.vmdk.zip
     Import into VMware using the .vmdk file

7. iora-os.ova
   - Open Virtualization Archive (VirtualBox/VMware)
   - Usage: Double-click to import into VirtualBox/VMware
   - Recommended: 2GB RAM, 2 CPUs

8. iora-os-YYYYMMDD.raucb
   - RAUC update bundle for existing IORA OS installations
   - Usage: rauc install iora-os-YYYYMMDD.raucb

Default Credentials:
- Username: root
- Password: iora
- CHANGE IMMEDIATELY AFTER FIRST BOOT!

Network Access:
- IORA Home: http://[device-ip]:8080
- IORA Control: http://[device-ip]:8091
- Supervisor API: http://[device-ip]:8097

System Requirements:
- CPU: x86_64 or ARM64
- RAM: 2GB minimum, 4GB recommended
- Storage: 16GB minimum, 32GB recommended
- Network: Ethernet recommended

Documentation:
- https://github.com/your-org/iora
- See ARCHITECTURE.md for system architecture
- See iora-os/README.md for detailed OS documentation

Verification:
- Check SHA256SUMS file for integrity verification
- sha256sum -c SHA256SUMS

Support:
- Issues: https://github.com/your-org/iora/issues
- Discussions: https://github.com/your-org/iora/discussions
EOF

    log_success "README created"
    mark_created "README.txt"
}

print_summary() {
    echo ""
    log_success "============================================"
    log_success "IORA OS Build Complete!"
    log_success "============================================"
    echo ""
    log_info "Release directory: ${RELEASE_DIR}"
    echo ""
    log_info "Generated images:"
    ls -lh "${RELEASE_DIR}" | grep -v "^total" | awk '{printf "  %-30s %10s\n", $9, $5}'

    if [ ${#SKIPPED_ARTIFACTS[@]} -gt 0 ]; then
        echo ""
        log_warn "Skipped artifacts:"
        for entry in "${SKIPPED_ARTIFACTS[@]}"; do
            echo "  - ${entry}"
        done
    fi

    echo ""
    log_info "Total release size: $(du -sh ${RELEASE_DIR} | cut -f1)"
    echo ""
    log_success "All images ready for deployment!"
    echo ""

    if [ "${REQUIRE_ALL_ARTIFACTS}" = true ] && [ ${#SKIPPED_ARTIFACTS[@]} -gt 0 ]; then
        log_error "--require-all-artifacts set and some artifacts were skipped."
        exit 1
    fi
}

# ── Publish to IORA Update Server ─────────────────────────────────────────────

publish_to_update_server() {
    if [ -z "${IORA_UPDATE_API_KEY:-}" ]; then
        log_info "Skipping update server publish (IORA_UPDATE_API_KEY not set)"
        log_info "  To publish, set: export IORA_UPDATE_API_KEY=<your-api-key>"
        return 0
    fi

    local update_server="${IORA_UPDATE_SERVER:-https://update.kaimdt.com}"
    local download_server="${IORA_DOWNLOAD_SERVER:-https://dist.kaimdt.com}"
    local version
    version=$(date +%Y%m%d)
    local channel="${IORA_RELEASE_CHANNEL:-stable}"

    log_info "Publishing to update server: ${update_server}"
    log_info "  Version: ${version}"
    log_info "  Channel: ${channel}"

    # Publish RAUC bundle if it exists
    local raucb_file="${RELEASE_DIR}/iora-os.raucb"
    if [ -f "$raucb_file" ]; then
        local raucb_size
        raucb_size=$(stat -c%s "$raucb_file" 2>/dev/null || stat -f%z "$raucb_file" 2>/dev/null)
        local raucb_sha256
        raucb_sha256=$(sha256sum "$raucb_file" | awk '{print $1}')

        log_info "  Publishing RAUC bundle (${raucb_size} bytes)..."

        # Upload artifact to download server
        local upload_resp
        upload_resp=$(curl -sSf -X POST "${download_server}/v1/admin/upload" \
            -H "Authorization: Bearer ${IORA_UPDATE_API_KEY}" \
            -F "file=@${raucb_file}" \
            -F "project=iora-os" \
            -F "version=${version}" \
            -F "platform=ioraos-x86_64" \
            2>/dev/null) || {
            log_warn "Failed to upload RAUC bundle to download server"
        }

        # Publish OS release metadata to update server
        curl -sSf -X POST "${update_server}/v1/admin/iora/os/publish" \
            -H "Authorization: Bearer ${IORA_UPDATE_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{
                \"version\": \"${version}\",
                \"channel\": \"${channel}\",
                \"platform\": \"ioraos-x86_64\",
                \"file_name\": \"iora-os.raucb\",
                \"file_size\": ${raucb_size},
                \"sha256_checksum\": \"${raucb_sha256}\",
                \"file_path\": \"iora-os/${version}/ioraos-x86_64/iora-os.raucb\",
                \"rauc_compatible\": \"iora-os\",
                \"rauc_version\": \"${version}\",
                \"bootloader_type\": \"grub\",
                \"uefi_capable\": true,
                \"rootfs_type\": \"squashfs\",
                \"compression\": \"lz4\"
            }" 2>/dev/null && log_success "  RAUC bundle published" || log_warn "  Failed to publish RAUC bundle metadata"
    fi

    # Publish installer manifest (for net installer)
    local img_xz="${RELEASE_DIR}/iora-os.img.xz"
    if [ -f "$img_xz" ]; then
        local img_size
        img_size=$(stat -c%s "$img_xz" 2>/dev/null || stat -f%z "$img_xz" 2>/dev/null)
        local img_sha256
        img_sha256=$(sha256sum "$img_xz" | awk '{print $1}')

        log_info "  Publishing installer manifest..."

        curl -sSf -X POST "${update_server}/v1/admin/iora/installer" \
            -H "Authorization: Bearer ${IORA_UPDATE_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{
                \"os_version\": \"${version}\",
                \"os_channel\": \"${channel}\",
                \"architecture\": \"x86_64\",
                \"image_url\": \"${download_server}/v1/iora-os/${version}/ioraos-x86_64\",
                \"image_sha256\": \"${img_sha256}\",
                \"image_size\": ${img_size},
                \"min_ram_mb\": 2048,
                \"min_disk_gb\": 8
            }" 2>/dev/null && log_success "  Installer manifest published" || log_warn "  Failed to publish installer manifest"
    fi

    log_success "Update server publish complete"
}

# Main build process
main() {
    parse_args "$@"
    normalize_shell_scripts

    log_info "Starting IORA OS complete image build..."
    log_info "Build time: $(date)"
    log_info "Unattended mode: ${UNATTENDED}"
    log_info "Images-only mode: ${IMAGES_ONLY}"
    log_info "Progress mode: ${PROGRESS}"
    log_info "Artifacts: ${ARTIFACT_FILTER}"
    log_info "xz preset: -${XZ_PRESET}"
    log_info "Require all artifacts: ${REQUIRE_ALL_ARTIFACTS}"
    echo ""

    # Create release directory
    mkdir -p "${RELEASE_DIR}"

    # Run build steps
    check_dependencies
    if [ "${IMAGES_ONLY}" = false ]; then
        # Build the React/Vite dashboard bundle and stage it in the rootfs overlay
        # so iora-home (port 8126) can serve it instead of the embedded fallback.
        build_frontend_bundle
        # Pre-compile IORA service binaries and embed them in the rootfs overlay
        # so the on-device self-build (iora-build-images.service) has binaries
        # available without needing a compiler on the device.
        build_service_binaries
        download_buildroot
        configure_buildroot
        build_base_image
    else
        log_info "Skipping Buildroot compile steps (images-only mode)."
        if [ ! -f "${OUTPUT_DIR}/iora-os.img" ]; then
            log_error "Missing base image: ${OUTPUT_DIR}/iora-os.img"
            log_info "Run a full build once: ./build.sh all"
            exit 1
        fi
    fi

    log_info ""
    log_info "Creating release images..."
    log_info ""

    if want_artifact raw; then create_raw_image; else mark_skipped "iora-os.img.xz (disabled by artifact selection)"; fi
    if want_artifact iso; then create_iso_image; else mark_skipped "iora-os-installer.iso (disabled by artifact selection)"; fi
    if want_artifact boot-iso; then create_bootable_installer_iso; else mark_skipped "iora-os-installer-boot.iso (disabled by artifact selection)"; fi
    if want_artifact qcow2; then create_qcow2_image; else mark_skipped "iora-os.qcow2.xz (disabled by artifact selection)"; fi
    if want_artifact vdi; then create_vdi_image; else mark_skipped "iora-os.vdi.zip (disabled by artifact selection)"; fi
    if want_artifact vmdk; then create_vmdk_image; else mark_skipped "iora-os.vmdk.zip (disabled by artifact selection)"; fi
    if want_artifact ova; then create_ova_image; else mark_skipped "iora-os.ova (disabled by artifact selection)"; fi
    if want_artifact rauc; then create_rauc_bundle; else mark_skipped "iora-os-YYYYMMDD.raucb (disabled by artifact selection)"; fi
    create_checksums
    create_readme

    if [ "${PUBLISH_RELEASE}" = true ]; then
        publish_to_update_server
    fi

    print_summary
}

# Run main function
main "$@"
