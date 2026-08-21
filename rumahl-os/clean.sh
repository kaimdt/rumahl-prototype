#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# rumahl OS – Build Cleaner
# Entfernt alle Dateien, die beim nächsten Build automatisch neu erstellt
# werden. Drei Stufen: per-package (Reparatur), build (normal), deep (alles).
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILDROOT_DIR="${SCRIPT_DIR}/buildroot-2024.02"
OUTPUT_DIR="${BUILDROOT_DIR}/output"
RELEASES_DIR="${SCRIPT_DIR}/releases"
OVERLAY_BIN_DIR="${SCRIPT_DIR}/board/rumahl/rootfs-overlay/opt/rumahl/build"
CARGO_CACHE="${HOME}/.rumahl-cache"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DRY_RUN=false
LEVEL=""

usage() {
    cat <<EOF
rumahl OS – Build Cleaner

Usage: $(basename "$0") [LEVEL] [--dry-run]

LEVEL (einer):
    per-package   Nur output/per-package/ löschen.
                  Repariert rsync --link-dest Fehler ohne kompletten Neuaufbau.
                  ~2-8 GB werden frei, Build-Zeit: +5-15 min.
    
    build         Vollständiger Build-Output + Releases + Service-Binaries.
                  (Entspricht "make clean" + bereinigte Overlay-Binaries.)
                  ~15-30 GB werden frei, Build-Zeit: 1-2 h.
    
    deep          Wie build + cargo cache (~/.rumahl-cache).
                  ~20-40 GB werden frei, Build-Zeit: 1,5-3 h.
    
    dist          Alles inkl. extrahiertem Buildroot-Verzeichnis.
                  ~25-45 GB werden frei, Build-Zeit: Download + 1-2 h.

Optionen:
    --dry-run     Nur anzeigen, was gelöscht würde (keine Änderungen).

Beispiele:
    $(basename "$0") per-package           # rsync-Fehler reparieren
    $(basename "$0") build                 # normaler Clean-Build
    $(basename "$0") deep --dry-run        # Vorschau, was deep löschen würde
EOF
    exit 0
}

# ── Farb-Helfer ─────────────────────────────────────────────────────────────
log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_del()   { echo -e "${RED}[DEL]${NC}  $1"; }
log_skip()  { echo -e "${YELLOW}[SKIP]${NC} $1"; }
log_done()  { echo -e "${GREEN}[OK]${NC}   $1"; }

# ── Argument-Parsing ────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
    case "$1" in
        per-package|build|deep|dist)
            LEVEL="$1"
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unbekannte Option: $1"
            usage
            ;;
    esac
    shift
done

if [ -z "${LEVEL}" ]; then
    log_info "Kein LEVEL angegeben. Mögliche Stufen:"
    echo "  per-package  – Nur per-package Verzeichnisse (rsync-Fehler beheben)"
    echo "  build        – output/ + releases/ + Service-Binaries"
    echo "  deep         – build + cargo cache (~/.rumahl-cache)"
    echo "  dist         – alles, inkl. Buildroot-Extraktion"
    echo ""
    read -r -p "LEVEL [per-package]: " LEVEL
    LEVEL="${LEVEL:-per-package}"
fi

case "${LEVEL}" in
    per-package|build|deep|dist) ;;
    *) echo "Ungültiger LEVEL: ${LEVEL}"; usage ;;
esac

# ── Trockenlauf-Modus-Anzeige ───────────────────────────────────────────────
if [ "${DRY_RUN}" = true ]; then
    echo ""
    echo -e "${YELLOW}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  DRY RUN – es wird NICHTS gelöscht              ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
fi

# ── Größe ermitteln ─────────────────────────────────────────────────────────
size_of() {
    local path="$1"
    if [ -e "${path}" ]; then
        du -sh "${path}" 2>/dev/null | cut -f1 || echo "?"
    else
        echo "–"
    fi
}

remove() {
    local path="$1"
    local label="${2:-$(basename "${path}")}"
    if [ ! -e "${path}" ] && [ ! -L "${path}" ]; then
        log_skip "${label} (existiert nicht)"
        return
    fi
    local sz
    sz=$(size_of "${path}")
    if [ "${DRY_RUN}" = true ]; then
        log_del "${label} (${sz}) [DRY RUN]"
    else
        log_del "${label} (${sz})"
        rm -rf "${path}"
    fi
}

# ── Per-Package Directories ─────────────────────────────────────────────────
clean_per_package() {
    echo ""
    echo -e "${BLUE}━━━ per-package clean ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -d "${OUTPUT_DIR}/per-package" ]; then
        remove "${OUTPUT_DIR}/per-package" "output/per-package/"
    else
        log_info "output/per-package/ existiert nicht – nichts zu tun."
    fi

    # Auch defekte .stamp_extracted-Dateien entfernen (die vom rsync-Fehler 23)
    if [ -d "${OUTPUT_DIR}/build" ]; then
        local broken_stamps
        broken_stamps=$(find "${OUTPUT_DIR}/build" -maxdepth 2 -name ".stamp_extracted" -newer "${OUTPUT_DIR}/build" 2>/dev/null || true)
        if [ -n "${broken_stamps}" ]; then
            log_info "Defekte .stamp_extracted gefunden – werden entfernt:"
            while IFS= read -r stamp; do
                remove "${stamp}" "  $(echo "${stamp}" | sed "s|${OUTPUT_DIR}/build/||")"
            done <<< "${broken_stamps}"
        fi
    fi
}

# ── Build Clean (output + releases + binaries) ──────────────────────────────
clean_build() {
    echo ""
    echo -e "${BLUE}━━━ build clean ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Buildroot output
    if [ -d "${OUTPUT_DIR}" ]; then
        remove "${OUTPUT_DIR}" "output/ (Buildroot build)"
    else
        log_info "output/ existiert nicht."
    fi

    # Releases
    if [ -d "${RELEASES_DIR}" ]; then
        remove "${RELEASES_DIR}" "releases/"
    else
        log_info "releases/ existiert nicht."
    fi

    # Precompiled service binaries im rootfs-overlay
    if [ -d "${OVERLAY_BIN_DIR}" ]; then
        local cleaned=0
        for svc_dir in "${OVERLAY_BIN_DIR}"/*/; do
            local bin_dir="${svc_dir}bin"
            if [ -d "${bin_dir}" ]; then
                remove "${bin_dir}" "overlay: $(basename "${svc_dir}")/bin/"
                cleaned=1
            fi
        done
        if [ "${cleaned}" -eq 0 ]; then
            log_info "Keine precompiled binaries im overlay."
        fi
    else
        log_info "Overlay build/ existiert nicht."
    fi

    # .stamp_* Marker (Buildroot Config-Key)
    local stamp_marker="${BUILDROOT_DIR}/.rumahl-config-key"
    remove "${stamp_marker}" "Buildroot config marker"
}

# ── Deep Clean (+ Cargo Cache) ──────────────────────────────────────────────
clean_deep() {
    clean_build

    echo ""
    echo -e "${BLUE}━━━ zusätzlich: cargo/sccache ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ -d "${CARGO_CACHE}" ]; then
        remove "${CARGO_CACHE}" "~/.rumahl-cache/ (cargo target + sccache)"
    else
        log_info "~/.rumahl-cache/ existiert nicht."
    fi
}

# ── Dist Clean (+ Buildroot extrahiertes Verzeichnis) ───────────────────────
clean_dist() {
    clean_deep

    echo ""
    echo -e "${BLUE}━━━ zusätzlich: Buildroot extrahiert + Tar ━━━━━━━━━━━━━━━━━━━${NC}"

    if [ -d "${BUILDROOT_DIR}" ]; then
        remove "${BUILDROOT_DIR}" "buildroot-2024.02/ (extrahiert)"
    else
        log_info "buildroot-2024.02/ existiert nicht."
    fi

    # Auch die .tar.gz (falls noch vorhanden, nicht mehr im Git)
    local tarball="${SCRIPT_DIR}/buildroot-2024.02.tar.gz"
    if [ -f "${tarball}" ]; then
        remove "${tarball}" "buildroot-2024.02.tar.gz"
    fi
}

# ── Ausführung ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  rumahl OS Cleaner – Level: ${LEVEL}${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"

case "${LEVEL}" in
    per-package)
        clean_per_package
        ;;
    build)
        clean_build
        ;;
    deep)
        clean_deep
        ;;
    dist)
        clean_dist
        ;;
esac

if [ "${DRY_RUN}" = false ]; then
    echo ""
    log_done "Fertig. Bereit für: cd buildroot-2024.02 && make -j\$(nproc)"
else
    echo ""
    log_info "Dry Run beendet – keine Dateien wurden verändert."
fi
