#!/usr/bin/env bash
# ============================================================================
# rumahl OS – Comprehensive Project Cleaner
# ============================================================================
# Entfernt ALLE Build-Artefakte, Caches und generierten Daten im gesamten
# Monorepo – Rust, Node.js, Buildroot, Frontend, Desktop, Caches.
#
# Stufen:
#   quick     node_modules + dist + /tmp-logs  (schnell, ~1-5 GB)
#   build     quick + Buildroot output + Rust target + Releases  (~20-40 GB)
#   deep      build + ALLE Caches (~/.rumahl-cache, .rumahl-dl-cache)  (~25-50 GB)
#   nuclear   deep + Buildroot-Extraktion + Tarball  (ALLES weg, ~30-55 GB)
#
# Nach nuclear muss setup.sh erneut ausgeführt werden (Buildroot wird neu
# heruntergeladen und extrahiert).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

DRY_RUN=false
ASSUME_YES=false
LEVEL=""

# ── Helpers ─────────────────────────────────────────────────────────────────
log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_del()   { echo -e "${RED}[DEL]${NC}  $*"; }
log_skip()  { echo -e "${YELLOW}[SKIP]${NC} $*"; }
section()   { echo ""; echo -e "${CYAN}${BOLD}━━━ $* ━━━${NC}"; }

size_of() {
    local path="$1"
    if [ -e "${path}" ] || [ -L "${path}" ]; then
        du -sh "${path}" 2>/dev/null | cut -f1 || echo "?"
    else
        echo "–"
    fi
}

remove() {
    local path="$1"
    local label="${2:-$(basename "${path}")}"
    if [ ! -e "${path}" ] && [ ! -L "${path}" ]; then
        log_skip "${label} (not found)"
        return
    fi
    local sz; sz=$(size_of "${path}")
    if [ "${DRY_RUN}" = true ]; then
        log_del "${label} (${sz}) [DRY RUN]"
    else
        log_del "${label} (${sz})"
        rm -rf "${path}"
    fi
}

confirm() {
    local prompt="$1"
    if [ "${ASSUME_YES}" = true ]; then
        return 0
    fi
    local ans
    read -r -p "$(echo -e "${BOLD}${prompt} [y/N]:${NC} ")" ans
    case "${ans}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

usage() {
    cat <<EOF
rumahl OS – Comprehensive Project Cleaner

Usage: $(basename "$0") [LEVEL] [OPTIONS]

LEVELS:
    quick     node_modules + dist + /tmp ora logs
              (~1-5 GB freed, rebuild: npm install + npm run build)
    
    build     quick + Buildroot output/ + Rust target/ + releases/ + binaries
              (~20-40 GB freed, rebuild: 1-2 h)
    
    deep      build + ALL caches (ccache, sccache, cargo-target, dl-cache)
              (~25-50 GB freed, rebuild: 1.5-3 h)
    
    nuclear   deep + Buildroot extraction + tarball → EVERYTHING
              (~30-55 GB freed, rebuild: download + 1-2 h)

OPTIONS:
    --dry-run     Show what would be deleted (no actual deletion)
    --yes, -y     Skip all confirmation prompts

EXAMPLES:
    $(basename "$0") quick
    $(basename "$0") build --dry-run
    $(basename "$0") nuclear --yes
EOF
    exit 0
}

# ── Args ────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        quick|build|deep|nuclear)
            LEVEL="$1"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --yes|-y)
            ASSUME_YES=true
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
    shift
done

if [ -z "${LEVEL}" ]; then
    echo ""
    echo -e "${BOLD}Choose cleanup level:${NC}"
    echo "  quick    – node_modules + dist + temp files                (~1-5 GB)"
    echo "  build    – quick + Buildroot output + Rust targets         (~20-40 GB)"
    echo "  deep     – build + ALL caches                              (~25-50 GB)"
    echo "  nuclear  – EVERYTHING including Buildroot source           (~30-55 GB)"
    echo ""
    read -r -p "Level [build]: " LEVEL
    LEVEL="${LEVEL:-build}"
fi

case "${LEVEL}" in
    quick|build|deep|nuclear) ;;
    *) echo "Invalid level: ${LEVEL}"; usage ;;
esac

# ── Header ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  rumahl OS – Comprehensive Cleaner  |  Level: ${LEVEL}${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"

if [ "${DRY_RUN}" = true ]; then
    echo -e "${YELLOW}  ⚠  DRY RUN MODE – nothing will be deleted${NC}"
fi

# ── Summary before deletion ─────────────────────────────────────────────────
echo ""
log_info "Scanning for artifacts..."

# Quick-scan sizes for summary
_total_mb=0
_scan() {
    local path="$1"
    if [ -e "${path}" ] || [ -L "${path}" ]; then
        du -sm "${path}" 2>/dev/null | cut -f1 || echo 0
    else
        echo 0
    fi
}

_add_mb() {
    local sz; sz=$(_scan "$1")
    _total_mb=$(( _total_mb + sz ))
}

# ── Level: quick ────────────────────────────────────────────────────────────
# These are always cleaned (included in every level)
_ITEMS_QUICK=()

# Node.js artifacts
for _dir in \
    "${REPO_ROOT}/frontend/node_modules" \
    "${REPO_ROOT}/frontend/dist" \
    "${REPO_ROOT}/desktop/node_modules" \
    "${REPO_ROOT}/desktop/dist" \
    "${REPO_ROOT}/store/node_modules" \
    "${REPO_ROOT}/store/.next" \
    "${REPO_ROOT}/node_modules"; do
    _add_mb "${_dir}"
    _ITEMS_QUICK+=("${_dir}|node_modules/dist")
done

# Desktop Rust artifacts
_add_mb "${REPO_ROOT}/desktop/src-tauri/target"
_ITEMS_QUICK+=("${REPO_ROOT}/desktop/src-tauri/target|Rust target (desktop)")

# /tmp logs
for _f in /tmp/rumahl-*.log /tmp/rumahl-cargo-*.log /tmp/rumahl-rustup-*.log; do
    [ -f "${_f}" ] && { _add_mb "${_f}"; _ITEMS_QUICK+=("${_f}|/tmp ora log"); }
done

# ── Level: build = quick + ──────────────────────────────────────────────────
_ITEMS_BUILD=("${_ITEMS_QUICK[@]}")

# Backend Rust target
_add_mb "${SCRIPT_DIR}/backend/target"
_ITEMS_BUILD+=("${SCRIPT_DIR}/backend/target|Rust target (backend)")

# Buildroot output (all build artifacts)
_br_output="${SCRIPT_DIR}/buildroot-2024.02/output"
_add_mb "${_br_output}"
_ITEMS_BUILD+=("${_br_output}|Buildroot output/")

# Buildroot RAM build leftovers
for _ram_leftover in \
    "${SCRIPT_DIR}/buildroot-2024.02/output.persistent" \
    "${SCRIPT_DIR}/buildroot-2024.02/output.disk-backup"; do
    _add_mb "${_ram_leftover}"
    _ITEMS_BUILD+=("${_ram_leftover}|RAM build leftover")
done

# Buildroot config marker
_add_mb "${SCRIPT_DIR}/buildroot-2024.02/.rumahl-config-key"
_ITEMS_BUILD+=("${SCRIPT_DIR}/buildroot-2024.02/.rumahl-config-key|Buildroot config marker")

# Precompiled service binaries in overlay
for _overlay_dir in "${SCRIPT_DIR}/board/rumahl/rootfs-overlay/opt/rumahl/build"/*/bin; do
    _add_mb "${_overlay_dir}"
    _ITEMS_BUILD+=("${_overlay_dir}|overlay binary")
done

# Releases
_add_mb "${SCRIPT_DIR}/releases"
_ITEMS_BUILD+=("${SCRIPT_DIR}/releases|releases/")

# Frontend staged in overlay
_add_mb "${SCRIPT_DIR}/board/rumahl/rootfs-overlay/opt/rumahl/rumahl-home/dist"
_ITEMS_BUILD+=("${SCRIPT_DIR}/board/rumahl/rootfs-overlay/opt/rumahl/rumahl-home/dist|frontend staged in overlay")

# .setup-target marker
_add_mb "${SCRIPT_DIR}/.setup-target"
_ITEMS_BUILD+=("${SCRIPT_DIR}/.setup-target|setup target marker")

# ── Level: deep = build + all caches ────────────────────────────────────────
_ITEMS_DEEP=("${_ITEMS_BUILD[@]}")

# ~/.rumahl-cache (ccache + sccache + cargo-target)
_add_mb "${HOME}/.rumahl-cache"
_ITEMS_DEEP+=("${HOME}/.rumahl-cache|~/.rumahl-cache/ (ccache+sccache+cargo)")

# Project dl-cache
_add_mb "${SCRIPT_DIR}/.rumahl-dl-cache"
_ITEMS_DEEP+=("${SCRIPT_DIR}/.rumahl-dl-cache|.rumahl-dl-cache/ (downloads)")

# ~/.buildroot-ccache (alternative ccache location)
_add_mb "${HOME}/.buildroot-ccache"
_ITEMS_DEEP+=("${HOME}/.buildroot-ccache|~/.buildroot-ccache")

# ── Level: nuclear = deep + Buildroot extraction ────────────────────────────
_ITEMS_NUCLEAR=("${_ITEMS_DEEP[@]}")

# Buildroot extracted directory
_add_mb "${SCRIPT_DIR}/buildroot-2024.02"
_ITEMS_NUCLEAR+=("${SCRIPT_DIR}/buildroot-2024.02|Buildroot extracted source")

# Buildroot tarball
_add_mb "${SCRIPT_DIR}/buildroot-2024.02.tar.gz"
_ITEMS_NUCLEAR+=("${SCRIPT_DIR}/buildroot-2024.02.tar.gz|Buildroot tarball")

# ── Select items for current level ──────────────────────────────────────────
case "${LEVEL}" in
    quick)   _ITEMS=("${_ITEMS_QUICK[@]}") ;;
    build)   _ITEMS=("${_ITEMS_BUILD[@]}") ;;
    deep)    _ITEMS=("${_ITEMS_DEEP[@]}") ;;
    nuclear) _ITEMS=("${_ITEMS_NUCLEAR[@]}") ;;
esac

# ── Show what will be deleted ───────────────────────────────────────────────
echo ""
section "Artifacts to clean (Level: ${LEVEL})"

_items_found=0
_real_total_mb=0
for _entry in "${_ITEMS[@]}"; do
    _path="${_entry%%|*}"
    _label="${_entry#*|}"
    if [ -e "${_path}" ] || [ -L "${_path}" ]; then
        _sz=$(size_of "${_path}")
        # Skip empty directories (0B) — they don't need cleaning
        if [ "${_sz}" = "0B" ] || [ "${_sz}" = "  0B" ]; then
            continue
        fi
        # Show path if it's not obvious from the label
        echo -e "  ${RED}✗${NC} ${_label} ${YELLOW}(${_sz})${NC}"
        echo -e "       ${CYAN}${_path}${NC}"
        _items_found=$(( _items_found + 1 ))
        _real_total_mb=$(( _real_total_mb + $(du -sm "${_path}" 2>/dev/null | cut -f1 || echo 0) ))
    fi
done

if [ "${_items_found}" -eq 0 ]; then
    echo "  ${GREEN}(nothing to clean – project is already pristine)${NC}"
    exit 0
fi

echo ""
_real_total_gb=$(awk "BEGIN { printf \"%.1f\", ${_real_total_mb} / 1024 }")
echo -e "  ${BOLD}Estimated space freed: ~${_real_total_gb} GB${NC}"

# ── Confirm ─────────────────────────────────────────────────────────────────
if [ "${LEVEL}" = "nuclear" ]; then
    echo ""
    log_warn "NUCLEAR level: Buildroot source will be DELETED."
    log_warn "You will need to re-run ./setup.sh and re-download Buildroot."
fi

if ! confirm "Proceed with cleanup?"; then
    echo ""
    log_info "Aborted."
    exit 0
fi

# ── Execute ─────────────────────────────────────────────────────────────────
echo ""
section "Cleaning..."

_deleted_count=0
_real_deleted_mb=0
for _entry in "${_ITEMS[@]}"; do
    _path="${_entry%%|*}"
    _label="${_entry#*|}"
    if [ -e "${_path}" ] || [ -L "${_path}" ]; then
        # Skip empty items
        _item_sz=$(du -sm "${_path}" 2>/dev/null | cut -f1 || echo 0)
        if [ "${_item_sz}" = "0" ]; then
            continue
        fi
        remove "${_path}" "${_label}"
        _deleted_count=$(( _deleted_count + 1 ))
        _real_deleted_mb=$(( _real_deleted_mb + _item_sz ))
    fi
done

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
section "Cleanup Complete"
_real_deleted_gb=$(awk "BEGIN { printf \"%.1f\", ${_real_deleted_mb} / 1024 }")
echo ""
log_ok "${_deleted_count} item(s) removed (~${_real_deleted_gb} GB freed)."
echo ""

if [ "${LEVEL}" = "nuclear" ]; then
    echo -e "  ${YELLOW}Next steps:${NC}"
    echo "    1. ./setup.sh --target pc    # re-download + extract Buildroot"
    echo "    2. ./build.sh all --progress  # rebuild everything"
elif [ "${LEVEL}" = "deep" ]; then
    echo -e "  ${GREEN}Next step:${NC}"
    echo "    ./build.sh all --progress"
elif [ "${LEVEL}" = "build" ]; then
    echo -e "  ${GREEN}Next step:${NC}"
    echo "    cd frontend && npm install && cd .."
    echo "    ./build.sh all --progress"
else
    echo -e "  ${GREEN}Next step:${NC}"
    echo "    cd frontend && npm install && npm run build"
    echo "    cd ../desktop && npm install"
fi
echo ""

if [ "${DRY_RUN}" = true ]; then
    log_info "Dry run – nothing was actually deleted."
fi
