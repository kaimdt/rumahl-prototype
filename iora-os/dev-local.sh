#!/usr/bin/env bash
# ============================================================================
# dev-local.sh – IORA OS Lokale Dev-Umgebung mit Hot Reload
# ============================================================================
# Plattformen: Linux (KVM), macOS (HVF), Windows/WSL2
#
# Startet IORA OS in einer lokalen QEMU-VM mit:
#   - Hardware-Beschleunigung (KVM/HVF/WHpx)
#   - Port-Forwarding für alle IORA-Dienste
#   - iora-dev-bridge für natives Hot Reload
#   - Automatische Rust → VM Hot-Deployment bei Code-Änderungen
#   - Vite Dev-Server für Frontend Hot Reload
#
# Verwendung:
#   ./dev-local.sh                  # Interaktiver Start
#   ./dev-local.sh --build-first    # Dev-Image zuerst bauen, dann starten
#   ./dev-local.sh --no-frontend    # Nur Backend-Hot-Reload
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
FRONTEND_DIR="${REPO_ROOT}/frontend"

# ── Platform detection ─────────────────────────────────────────────────────
detect_platform() {
    IS_LINUX=0; IS_MACOS=0; IS_WSL=0; IS_WINDOWS_NATIVE=0
    case "$(uname -s)" in
        Linux)
            IS_LINUX=1
            # WSL detection
            if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
                IS_WSL=1
            fi
            ;;
        Darwin)
            IS_MACOS=1
            ;;
        MINGW*|MSYS*|CYGWIN*)
            IS_WINDOWS_NATIVE=1
            ;;
        *)
            echo "WARNING: Unknown OS: $(uname -s). Assuming Linux-like."
            IS_LINUX=1
            ;;
    esac
}

detect_platform

# ── Konfiguration ───────────────────────────────────────────────────────────
VM_RAM="${IORA_DEV_RAM:-6G}"
VM_CPUS="${IORA_DEV_CPUS:-}"
VM_DISK="${IORA_DEV_DISK:-}"
VM_IMAGE_DIR="${SCRIPT_DIR}/releases"
VM_SSH_PORT="${IORA_DEV_SSH_PORT:-2222}"
DEV_BRIDGE_PORT=8101
IORA_HOME_PORT=8126

BUILD_FIRST=false
NO_FRONTEND=false
NO_BACKEND=false
HEADLESS=false
KEEP_VM=false
INSTALL_REQUIRED=false
DEV_MODE="native"  # "native" = Debian Cloud VM | "iora-os" = Buildroot IORA OS
_CLEAN_FIRST=false
QEMU_PID=""
WATCHER_PID=""
VITE_PID=""

# ── Platform-specific helpers ───────────────────────────────────────────────
_HOST_ARCH=$(uname -m)
if [ "${IS_MACOS}" = "1" ]; then
    _host_cpus() { sysctl -n hw.logicalcpu 2>/dev/null || echo 4; }
    _pkg_install_hint() { echo "brew install $1"; }
    _qemu_bin() {
        # macOS: qemu might be at different path
        for q in qemu-system-x86_64 /usr/local/bin/qemu-system-x86_64 /opt/homebrew/bin/qemu-system-x86_64; do
            command -v "$q" >/dev/null 2>&1 && { echo "$q"; return 0; }
        done
        echo "qemu-system-x86_64"
    }
else
    _host_cpus() { nproc 2>/dev/null || echo 4; }
    _pkg_install_hint() {
        if command -v apt-get >/dev/null 2>&1; then echo "sudo apt-get install -y $1"
        elif command -v dnf >/dev/null 2>&1; then echo "sudo dnf install -y $1"
        else echo "install $1"; fi
    }
    _qemu_bin() { echo "qemu-system-x86_64"; }
fi

# ── Farben ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'
  C='\033[0;36m'; W='\033[1;37m'; D='\033[2m'; N='\033[0m'; BOLD='\033[1m'
else
  R=''; G=''; Y=''; B=''; C=''; W=''; D=''; N=''; BOLD=''
fi

# ── Banner ──────────────────────────────────────────────────────────────────
banner() {
  local _plat="Linux/KVM"
  [ "${IS_MACOS}" = "1" ] && _plat="macOS/HVF"
  [ "${IS_WSL}" = "1" ] && _plat="WSL2"
  [ "${DEV_MODE}" = "iora-os" ] && _plat="${_plat} (IORA OS)"
  [ "${DEV_MODE}" = "native" ] && _plat="${_plat} (Debian)"
  echo -e "${C}${BOLD}"
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║     IORA OS – Local Dev Environment             ║"
  echo "  ║     Platform: ${_plat}                          ║"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo -e "${N}"
}

log()     { echo -e "${B}[dev-local]${N} $*"; }
success() { echo -e "${G}[  OK  ]${N} $*"; }
warn()    { echo -e "${Y}[ WARN ]${N} $*"; }
error()   { echo -e "${R}[ERROR ]${N} $*"; }
info()    { echo -e "${C}[ INFO ]${N} $*"; }

# ── Cleanup ─────────────────────────────────────────────────────────────────
cleanup() {
  # Skip cleanup for --help (no services were started)
  [ "${_DEV_STARTED:-0}" = "1" ] || return 0
  echo ""
  log "Shutting down dev environment..."
  [ -n "${VITE_PID:-}" ] && kill -0 "${VITE_PID}" 2>/dev/null && { kill "${VITE_PID}" 2>/dev/null || true; wait "${VITE_PID}" 2>/dev/null || true; }
  [ -n "${WATCHER_PID:-}" ] && kill -0 "${WATCHER_PID}" 2>/dev/null && { kill "${WATCHER_PID}" 2>/dev/null || true; wait "${WATCHER_PID}" 2>/dev/null || true; }
  if [ -n "${QEMU_PID:-}" ] && kill -0 "${QEMU_PID}" 2>/dev/null; then
    if [ "${KEEP_VM}" = false ]; then
      kill "${QEMU_PID}" 2>/dev/null || true
      wait "${QEMU_PID}" 2>/dev/null || true
    else
      info "VM running in background (PID ${QEMU_PID})."
    fi
  fi
  success "Dev environment shut down."
}
# ── Clean stale VMs from previous runs ──────────────────────────────────────
_kill_stale_vms() {
  local _killed=0
  # Find QEMU processes named "IORA OS Dev"
  local _pids
  _pids=$(ps aux 2>/dev/null | grep -i "qemu.*IORA.OS.Dev" | grep -v grep | awk '{print $2}' || true)
  if [ -z "${_pids}" ]; then
    # Fallback: find qemu processes listening on our ports
    for _port in ${VM_SSH_PORT} ${IORA_HOME_PORT} ${DEV_BRIDGE_PORT} 8090 8091 8092 8093 8094 8095 8096 8097 8098; do
      local _pid; _pid=$(lsof -ti :${_port} 2>/dev/null || true)
      [ -n "${_pid}" ] && _pids="${_pids} ${_pid}"
    done
  fi
  _pids=$(echo "${_pids}" | tr ' ' '\n' | sort -u | tr '\n' ' ')
  for _pid in ${_pids}; do
    [ -z "${_pid}" ] && continue
    if kill -0 "${_pid}" 2>/dev/null; then
      warn "Killing stale IORA VM (PID ${_pid})..."
      kill "${_pid}" 2>/dev/null || true
      _killed=$(( _killed + 1 ))
    fi
  done
  [ "${_killed}" -gt 0 ] && sleep 1
  return 0
}

trap cleanup EXIT INT TERM

# ── Usage ───────────────────────────────────────────────────────────────────
usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

OPTIONS:
    --build-first       Dev-Image bauen bevor die VM gestartet wird
    --no-frontend       Nur Backend-Hot-Reload (kein Vite Dev-Server)
    --no-backend        Nur Frontend-Hot-Reload (kein Rust-Watcher)
    --headless          Kein QEMU-Fenster (nur Serial-Konsole)
    --keep-vm           VM nach Script-Ende weiterlaufen lassen
    --ram SIZE          VM RAM (Default: 4G, macOS: 2G falls <8GB host)
    --cpus N            VM CPUs (Default: host-CPUs/2)
    --disk PATH         Pfad zum IORA OS Dev Image (.img oder .qcow2)
    --ssh-port PORT     SSH Port-Forwarding (Default: 2222)
    --mode MODE         Dev-Modus: "native" (Debian, ~2min) oder "iora-os" (Buildroot, ~90min)
    --clean             Cache + VM löschen und sauber neustarten
    -ir, --install-required  Fehlende Pakete automatisch installieren
    -h, --help          Diese Hilfe anzeigen

PLATFORM NOTES:
    Linux:   KVM acceleration (auto-detected)
    macOS:   HVF acceleration (auto-detected, requires QEMU from Homebrew)
    WSL2:    Runs inside WSL2 – ensure nested virtualization is enabled
    Windows: For native Hyper-V, use dev-local.ps1 instead

EXAMPLES:
    $(basename "$0")                              # Debian VM (schnell, default)
    $(basename "$0") --clean                      # Cache + VM löschen, frisch starten
    $(basename "$0") --mode iora-os               # Echtes IORA OS Image
    $(basename "$0") -ir                          # Auto-install + Debian VM
    $(basename "$0") --ram 8G --cpus 8
    $(basename "$0") --headless --keep-vm
EOF
  exit 0
}

# ── Args ────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --build-first)    BUILD_FIRST=true ;;
    --no-frontend)    NO_FRONTEND=true ;;
    --no-backend)     NO_BACKEND=true ;;
    --headless)       HEADLESS=true ;;
    --keep-vm)        KEEP_VM=true ;;
    --ram)            VM_RAM="$2"; shift ;;
    --cpus)           VM_CPUS="$2"; shift ;;
    --disk)           VM_DISK="$2"; shift ;;
    --ssh-port)       VM_SSH_PORT="$2"; shift ;;
    --mode)           DEV_MODE="$2"; shift ;;
    --clean)          _CLEAN_FIRST=true ;;
    -ir|--install-required) INSTALL_REQUIRED=true ;;
    -h|--help)        usage ;;
    *)                error "Unknown option: $1"; usage ;;
  esac
  shift
done

# ── Auto-adjust RAM for low-memory hosts ────────────────────────────────────
if [ "${IS_MACOS}" = "1" ]; then
    _host_ram_mb=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024)}' || echo 8192)
    if [ "${_host_ram_mb}" -lt 8192 ] && [ "${VM_RAM}" = "4G" ]; then
        VM_RAM="2G"
        warn "Host has <8GB RAM → VM RAM reduced to ${VM_RAM}."
    fi
fi

# ── Prerequisites ───────────────────────────────────────────────────────────
check_prereqs() {
  log "Checking prerequisites... ($([ "${IS_MACOS}" = "1" ] && echo "macOS")$([ "${IS_LINUX}" = "1" ] && echo "Linux")$([ "${IS_WSL}" = "1" ] && echo "WSL2"))"

  local missing=()

  # QEMU
  local _qemu; _qemu=$(_qemu_bin)
  if ! command -v "${_qemu}" >/dev/null 2>&1; then
    missing+=("qemu: $(_pkg_install_hint qemu)")
  fi

  # Acceleration check
  if [ "${IS_MACOS}" = "1" ]; then
    local _host_arch; _host_arch=$(uname -m)
    # HVF only accelerates same-architecture guests.
    # Apple Silicon (arm64) + x86_64 guest → no HVF, TCG emulation only.
    if [ "${_host_arch}" = "arm64" ]; then
      if [ "${DEV_MODE}" = "native" ]; then
        success "Apple Silicon + native aarch64 VM → HVF accelerated (full speed)"
      else
        warn "  Apple Silicon (arm64) + x86_64 guest = TCG emulation (~5-10x slower)"
        warn "  For full speed on Apple Silicon, use native mode (default):"
        warn "    $(basename "$0")                    # aarch64 Debian VM with HVF"
      fi
    else
      # Intel Mac – HVF should accelerate x86_64
      if command -v "${_qemu}" >/dev/null 2>&1 && "${_qemu}" -accel help 2>/dev/null | grep -q hvf; then
        success "HVF acceleration available (Apple Hypervisor)"
      else
        warn "HVF not available – QEMU x86_64 will be slow."
        warn "  Reinstall QEMU: brew reinstall qemu"
      fi
    fi
  elif [ "${IS_LINUX}" = "1" ]; then
    if [ -e /dev/kvm ] && [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
      success "KVM acceleration available"
    else
      if [ "${IS_WSL}" = "1" ]; then
        warn "KVM not available in WSL2 – enable nested virtualization in Windows:"
        warn "  PowerShell (Admin): Set-VMProcessor -VMName <WSL-VM> -ExposeVirtualizationExtensions \$true"
      else
        warn "KVM not available – QEMU will be slow. Enable KVM in BIOS."
      fi
    fi
  fi

  # Cargo
  if ! command -v cargo >/dev/null 2>&1 && [ "${NO_BACKEND}" = false ]; then
    warn "cargo not found – Rust watcher won't start."
    warn "  Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  fi

  # Node
  if ! command -v npm >/dev/null 2>&1 && [ "${NO_FRONTEND}" = false ]; then
    if [ "${IS_MACOS}" = "1" ]; then
      warn "npm not found. Install: brew install node"
    else
      warn "npm not found. Install: $(_pkg_install_hint nodejs)"
    fi
  fi

  # iora-dev-deploy
  if [ "${NO_BACKEND}" = false ]; then
    local deploy_bin="${SCRIPT_DIR}/tools/iora-dev-deploy/target/release/iora-dev-deploy"
    if [ ! -f "${deploy_bin}" ]; then
      warn "iora-dev-deploy not built – building now..."
      (cd "${SCRIPT_DIR}/tools/iora-dev-deploy" && cargo build --release 2>&1 | tail -3) || {
        warn "Could not build iora-dev-deploy. Backend watcher disabled."
        NO_BACKEND=true
      }
    fi
  fi

  # macOS specific: check for GNU du (for -h flag compatibility)
  if [ "${IS_MACOS}" = "1" ]; then
    if ! du -h . >/dev/null 2>&1; then
      warn "GNU du not found. Install: brew install coreutils"
    fi
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    if [ "${INSTALL_REQUIRED}" = true ]; then
      info "Missing ${#missing[@]} prerequisite(s) – auto-installing..."
      return 1  # signal: need install
    fi
    error "Missing prerequisites:"
    for m in "${missing[@]}"; do echo "  - $m"; done
    error "Run with --install-required to auto-install, or install manually."
    exit 1
  fi

  success "Prerequisites OK"
  return 0
}

# ── Auto-install missing packages ──────────────────────────────────────────
auto_install() {
  log "Auto-installing prerequisites for $([ "${IS_MACOS}" = "1" ] && echo "macOS")$([ "${IS_LINUX}" = "1" ] && echo "Linux")$([ "${IS_WSL}" = "1" ] && echo "WSL2")..."
  echo ""

  local _sudo=""
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
      _sudo="sudo"
    fi
  fi

  # ── Detect package manager ────────────────────────────────────────────
  local _pm="" _install="" _update=""
  if [ "${IS_MACOS}" = "1" ]; then
    if command -v brew >/dev/null 2>&1; then
      _pm="brew"; _install="brew install"; _update="brew update"
    else
      error "Homebrew not found. Install from: https://brew.sh"
      return 1
    fi
  elif command -v apt-get >/dev/null 2>&1; then
    _pm="apt"; _install="${_sudo} env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends"
    _update="${_sudo} apt-get update -qq"
  elif command -v dnf >/dev/null 2>&1; then
    _pm="dnf"; _install="${_sudo} dnf install -y"; _update=""
  elif command -v pacman >/dev/null 2>&1; then
    _pm="pacman"; _install="${_sudo} pacman -S --noconfirm --needed"; _update=""
  elif command -v zypper >/dev/null 2>&1; then
    _pm="zypper"; _install="${_sudo} zypper --non-interactive install"; _update=""
  else
    error "No supported package manager found."
    return 1
  fi
  info "Package manager: ${_pm}"

  # ── Update repos ─────────────────────────────────────────────────────
  if [ -n "${_update}" ]; then
    info "Updating package lists..."
    ${_update} 2>&1 | tail -1 || true
  fi

  # ── QEMU ──────────────────────────────────────────────────────────────
  local _qemu; _qemu=$(_qemu_bin)
  if ! command -v "${_qemu}" >/dev/null 2>&1; then
    info "Installing QEMU..."
    case "${_pm}" in
      brew) brew install qemu ;;
      apt)  ${_install} qemu-system-x86 qemu-utils qemu-system-gui ;;
      dnf)  ${_install} qemu-kvm qemu-img ;;
      pacman) ${_install} qemu-desktop ;;
      zypper) ${_install} qemu-x86 qemu-tools ;;
    esac || warn "QEMU install failed – install manually."
  fi

  # ── Platform: acceleration setup ─────────────────────────────────────
  if [ "${IS_LINUX}" = "1" ]; then
    # Install KVM packages
    case "${_pm}" in
      apt)  ${_install} qemu-kvm libvirt-daemon-system bridge-utils 2>/dev/null || true ;;
      dnf)  ${_install} qemu-kvm libvirt 2>/dev/null || true ;;
      pacman) ${_install} libvirt qemu-arch-extra 2>/dev/null || true ;;
    esac
    # Add user to kvm group
    if [ -n "${_sudo}" ] && getent group kvm >/dev/null 2>&1; then
      if ! groups "${USER}" 2>/dev/null | grep -q kvm; then
        info "Adding ${USER} to kvm group..."
        ${_sudo} usermod -aG kvm "${USER}" 2>/dev/null || true
        warn "Added to kvm group – log out and back in for this to take effect."
        warn "Or run: newgrp kvm"
      fi
    fi
    # Load KVM modules
    if [ -n "${_sudo}" ]; then
      ${_sudo} modprobe kvm 2>/dev/null || true
      ${_sudo} modprobe kvm_intel 2>/dev/null || ${_sudo} modprobe kvm_amd 2>/dev/null || true
    fi
  fi

  if [ "${IS_MACOS}" = "1" ] && [ "${_pm}" = "brew" ]; then
    # Ensure QEMU is built with HVF support
    if ! qemu-system-x86_64 -accel help 2>/dev/null | grep -q hvf; then
      warn "QEMU may not have HVF support. Reinstalling..."
      brew reinstall qemu 2>/dev/null || true
    fi
  fi

  # ── Node.js ───────────────────────────────────────────────────────────
  if ! command -v npm >/dev/null 2>&1 && [ "${NO_FRONTEND}" = false ]; then
    info "Installing Node.js + npm..."
    case "${_pm}" in
      brew) brew install node ;;
      apt)  ${_install} nodejs npm ;;
      dnf)  ${_install} nodejs npm ;;
      pacman) ${_install} nodejs npm ;;
      zypper) ${_install} nodejs npm ;;
    esac || warn "Node.js install failed – frontend will be disabled."
  fi

  # ── Rust toolchain ────────────────────────────────────────────────────
  if ! command -v cargo >/dev/null 2>&1; then
    if [ "${NO_BACKEND}" = false ]; then
      info "Installing Rust via rustup..."
      if command -v curl >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
        # Source cargo env
        if [ -f "${HOME}/.cargo/env" ]; then
          # shellcheck disable=SC1091
          . "${HOME}/.cargo/env"
        fi
      else
        warn "curl not found – install Rust manually: https://rustup.rs"
      fi
    fi
  fi

  # ── Verify ────────────────────────────────────────────────────────────
  echo ""
  log "Verifying installation..."

  local _ok=true

  # Docker (needed for building on non-Linux)
  if ! command -v docker >/dev/null 2>&1; then
    if [ "${IS_MACOS}" = "1" ]; then
      warn "Docker not found – needed for building IORA OS image on macOS."
      warn "  Install: brew install --cask docker"
      warn "  Or download: https://docs.docker.com/desktop/mac/install/"
    elif [ "${IS_LINUX}" != "1" ]; then
      warn "Docker not found – needed for building on this platform."
    fi
  else
    success "Docker: $(docker --version 2>/dev/null || echo installed)"
  fi
  if ! command -v "$(_qemu_bin)" >/dev/null 2>&1; then
    warn "QEMU still missing – install manually."; _ok=false
  else
    success "QEMU: $($(_qemu_bin) --version 2>/dev/null | head -1 || echo installed)"
  fi

  if ! command -v npm >/dev/null 2>&1 && [ "${NO_FRONTEND}" = false ]; then
    warn "npm still missing – frontend will be disabled."
    NO_FRONTEND=true
  else
    success "Node.js: $(node --version 2>/dev/null || echo installed)"
  fi

  if ! command -v cargo >/dev/null 2>&1 && [ "${NO_BACKEND}" = false ]; then
    warn "cargo still missing – backend watcher will be disabled."
    NO_BACKEND=true
  else
    success "Rust: $(rustc --version 2>/dev/null || cargo --version 2>/dev/null || echo installed)"
  fi

  # Build iora-dev-deploy
  if [ "${NO_BACKEND}" = false ] && command -v cargo >/dev/null 2>&1; then
    local deploy_bin="${SCRIPT_DIR}/tools/iora-dev-deploy/target/release/iora-dev-deploy"
    if [ ! -f "${deploy_bin}" ]; then
      info "Building iora-dev-deploy..."
      (cd "${SCRIPT_DIR}/tools/iora-dev-deploy" && cargo build --release 2>&1 | tail -3) || {
        warn "iora-dev-deploy build failed."; _ok=false
      }
    fi
  fi

  echo ""
  if [ "${_ok}" = true ]; then
    success "All prerequisites installed."
  else
    warn "Some prerequisites could not be auto-installed."
    warn "The dev environment will start with reduced functionality."
  fi

  return 0
}

# ── Build: Native Linux ────────────────────────────────────────────────────
_build_native() {
  log "Building IORA OS Dev image (native Linux)..."
  if [ -f "${SCRIPT_DIR}/build-fast-iso.sh" ]; then
    bash "${SCRIPT_DIR}/build-fast-iso.sh" --dev --jobs "$(_host_cpus)"
  else
    bash "${SCRIPT_DIR}/build.sh" all --dev --progress
  fi
  _find_built_image
}

# ── Build: Docker container (macOS / Windows / WSL2) ───────────────────────
_build_docker() {
  log "Building IORA OS Dev image via Docker (no native Linux required)..."

  if ! command -v docker >/dev/null 2>&1; then
    error "Docker is required for building on this platform."
    if [ "${IS_MACOS}" = "1" ]; then
      error "  Install Docker Desktop: https://docs.docker.com/desktop/mac/install/"
      error "  Or: brew install --cask docker"
    else
      error "  Install Docker: https://docs.docker.com/engine/install/"
    fi
    error "  Then re-run: $(basename "$0") --build-first"
    exit 1
  fi

  # Build the Docker build environment image (one-time, cached)
  local _dockerfile="${SCRIPT_DIR}/Dockerfile.build"
  if [ ! -f "${_dockerfile}" ]; then
    error "Dockerfile.build not found at ${_dockerfile}"
    exit 1
  fi

  log "Step 1/2: Building Docker build environment (cached after first run)..."
  docker build -t iora-build-env -f "${_dockerfile}" "${SCRIPT_DIR}" 2>&1 | tail -5

  log "Step 2/2: Running IORA OS build inside Docker..."
  log "  This will take 30-90 minutes on first run (cached ccache speeds up repeats)."
  echo ""

  # Run the full build inside Docker
  # Mount the repo root so build scripts can access everything
  # Mount ccache dir to persist compiler cache across runs
  mkdir -p "${HOME}/.iora-cache"
  docker run --rm \
    -v "${REPO_ROOT}:/work" \
    -v "${HOME}/.iora-cache:/root/.iora-cache" \
    -w /work/iora-os \
    iora-build-env \
    bash -c "
      set -e
      echo '[docker-build] Starting IORA OS Dev build...'
      echo '[docker-build] Target: pc (x86_64), Dev mode'
      echo ''
      ./setup.sh --target pc --deps-only --yes 2>&1 | tail -3
      echo ''
      ./build.sh all --dev --progress
    "

  _find_built_image
}

# ── Locate built image ──────────────────────────────────────────────────────
_find_built_image() {
  for _dir in "${SCRIPT_DIR}/buildroot-2024.02/output/images" "${VM_IMAGE_DIR}"; do
    for _img in "${_dir}"/iora-os.img; do
      if [ -f "${_img}" ]; then
        VM_DISK="${_img}"
        success "Dev image built: ${VM_DISK}"
        return 0
      fi
    done
  done
  error "Build completed but no iora-os.img found."
  return 1
}

# ── Find or build IORA OS dev image ─────────────────────────────────────────
find_or_build_image() {
  if [ -n "${VM_DISK}" ] && [ -f "${VM_DISK}" ]; then
    success "Using disk image: ${VM_DISK}"
    return 0
  fi

  local candidates=()
  for _dir in "${VM_IMAGE_DIR}" "${SCRIPT_DIR}/buildroot-2024.02/output/images"; do
    [ -d "${_dir}" ] || continue
    for _img in "${_dir}"/iora-os.img "${_dir}"/iora-os-dev.img; do
      [ -f "${_img}" ] && candidates+=("${_img}")
    done
  done

  if [ ${#candidates[@]} -gt 0 ]; then
    info "Found existing image(s):"
    local i=1
    for _img in "${candidates[@]}"; do
      local _sz
      _sz=$(du -h "${_img}" 2>/dev/null | cut -f1 || echo "?")
      echo "  [${i}] ${_img} (${_sz})"
      i=$((i + 1))
    done
    echo ""
    read -r -p "Use image [1] or type 'build' for new build: " choice
    choice="${choice:-1}"
    if [ "${choice}" = "build" ]; then
      BUILD_FIRST=true
    elif [ "${choice}" -ge 1 ] 2>/dev/null && [ "${choice}" -le "${#candidates[@]}" ]; then
      VM_DISK="${candidates[$((choice - 1))]}"
      success "Using: ${VM_DISK}"
      return 0
    fi
  fi

  if [ "${BUILD_FIRST}" = true ] || [ -z "${VM_DISK}" ]; then
    if [ "${IS_LINUX}" = "1" ]; then
      _build_native
    else
      _build_docker
    fi
  fi

  if [ -z "${VM_DISK}" ] || [ ! -f "${VM_DISK}" ]; then
    error "No IORA OS image found and build did not produce one."
    error "Try: $(basename "$0") --build-first"
    error "Or specify pre-built image: $(basename "$0") --disk /path/to/iora-os.img"
    exit 1
  fi
}

# ── Debian Cloud VM Setup (native dev mode) ───────────────────────────────
_HOST_ARCH=$(uname -m)
# Apple Silicon: use aarch64 cloud image (HVF-accelerated)
# Intel/AMD: use amd64 cloud image
if [ "${_HOST_ARCH}" = "arm64" ]; then
  _DEBIAN_CLOUD_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-arm64.qcow2"
  _QEMU_BIN_ARCH="qemu-system-aarch64"
  _QEMU_MACHINE="virt"
  _CLOUD_CACHE_FILE="debian-12-cloud-arm64.qcow2"
else
  _DEBIAN_CLOUD_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
  _QEMU_BIN_ARCH="qemu-system-x86_64"
  _QEMU_MACHINE="q35"
  _CLOUD_CACHE_FILE="debian-12-cloud-amd64.qcow2"
fi
_DEBIAN_CLOUD_IMG="${SCRIPT_DIR}/.cache/${_CLOUD_CACHE_FILE}"
_CLOUD_INIT_YAML="${SCRIPT_DIR}/cloud-init.yaml"

_setup_native_vm() {
  [ "${DEV_MODE}" = "native" ] || return 0

  log "Preparing native Debian Dev VM (glibc + systemd = IORA OS 1:1)..."
  mkdir -p "$(dirname "${_DEBIAN_CLOUD_IMG}")"

  # Download Debian cloud image (one-time, ~300MB)
  if [ ! -f "${_DEBIAN_CLOUD_IMG}" ]; then
    info "Downloading Debian 12 cloud image (~300MB, one-time)..."
    curl -L -o "${_DEBIAN_CLOUD_IMG}.tmp" "${_DEBIAN_CLOUD_URL}" 2>&1 | tail -1 || {
      error "Download failed. Check internet connection."
      rm -f "${_DEBIAN_CLOUD_IMG}.tmp"
      exit 1
    }
    mv "${_DEBIAN_CLOUD_IMG}.tmp" "${_DEBIAN_CLOUD_IMG}"
    success "Debian cloud image downloaded."
  else
    info "Using cached Debian cloud image."
  fi

  # Create working copy (cloud image is read-only seed)
  VM_DISK="${SCRIPT_DIR}/.cache/iora-dev-vm.qcow2"
  local _need_init=false
  if [ ! -f "${VM_DISK}" ]; then
    info "Creating writable VM disk from cloud image..."
    qemu-img create -f qcow2 -b "${_DEBIAN_CLOUD_IMG}" -F qcow2 "${VM_DISK}" 20G 2>/dev/null
    _need_init=true
  fi

  # Generate cloud-init ISO (always regenerate if yaml changed)
  local _cloud_iso="${SCRIPT_DIR}/.cache/cloud-init.iso"
  local _yaml_hash="${SCRIPT_DIR}/.cache/.cloud-init-yaml.hash"
  local _need_iso=false

  # Check if cloud-init.yaml changed since last ISO generation
  if [ -f "${_CLOUD_INIT_YAML}" ]; then
    local _current_hash; _current_hash=$(shasum -a 256 "${_CLOUD_INIT_YAML}" 2>/dev/null | awk '{print $1}' || md5 -q "${_CLOUD_INIT_YAML}" 2>/dev/null)
    if [ ! -f "${_cloud_iso}" ] || [ ! -f "${_yaml_hash}" ] || [ "$(cat "${_yaml_hash}" 2>/dev/null)" != "${_current_hash}" ]; then
      _need_iso=true
    fi
  fi

  if [ "${_need_init}" = true ] || [ "${_need_iso}" = true ] || [ ! -f "${_cloud_iso}" ]; then
    info "Generating cloud-init ISO with project files..."
      local _tmp_dir; _tmp_dir=$(mktemp -d)
      cp "${_CLOUD_INIT_YAML}" "${_tmp_dir}/user-data"
      echo "instance-id: iora-dev-$(date +%s)" > "${_tmp_dir}/meta-data"
      echo "local-hostname: iora-dev" >> "${_tmp_dir}/meta-data"

      # Create project tarball (exclude build artifacts)
      info "  Creating project tarball for VM..."
      tar czf "${_tmp_dir}/project.tar.gz" \
        -C "${REPO_ROOT}" \
        --exclude='.git' --exclude='target' --exclude='node_modules' \
        --exclude='.cache' --exclude='buildroot-*' --exclude='releases' \
        --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' \
        . 2>/dev/null || warn "  Tarball creation may be incomplete."

      # Generate ISO with project files embedded
      if command -v mkisofs >/dev/null 2>&1; then
        mkisofs -o "${_cloud_iso}" -V cidata -J -r "${_tmp_dir}" 2>/dev/null
      elif command -v xorriso >/dev/null 2>&1; then
        xorriso -as mkisofs -o "${_cloud_iso}" -V cidata -J -r "${_tmp_dir}" 2>/dev/null
      elif command -v hdiutil >/dev/null 2>&1; then
        hdiutil makehybrid -o "${_cloud_iso}" -joliet -iso "${_tmp_dir}" 2>/dev/null
      else
        warn "No ISO tool found – install mkisofs or xorriso."
        rm -rf "${_tmp_dir}"
        return 1
      fi
      rm -rf "${_tmp_dir}"
      local _iso_size; _iso_size=$(du -h "${_cloud_iso}" | cut -f1)
      success "  Cloud-init ISO created (${_iso_size})"
      # Save hash to detect yaml changes
      [ -n "${_current_hash:-}" ] && echo "${_current_hash}" > "${_yaml_hash}"
  fi

  info "VM disk:  ${VM_DISK}"
  info "Cloud ISO: ${_cloud_iso}"
  _NEED_CLOUD_INIT="${_need_init}"
}

# ── Start QEMU VM ───────────────────────────────────────────────────────────
start_qemu() {
  log "Starting QEMU VM..."

  # Select QEMU binary: native mode uses arch-specific binary
  local _qemu
  if [ "${DEV_MODE}" = "native" ] && command -v "${_QEMU_BIN_ARCH}" >/dev/null 2>&1; then
    _qemu="${_QEMU_BIN_ARCH}"
  else
    _qemu=$(_qemu_bin)
  fi

  # CPU count
  if [ -z "${VM_CPUS}" ]; then
    VM_CPUS=$(_host_cpus)
    VM_CPUS=$(( VM_CPUS / 2 ))
    [ "${VM_CPUS}" -lt 2 ] && VM_CPUS=2
  fi

  # Platform: acceleration
  local _accel_opts=()
  local _machine="${_QEMU_MACHINE:-q35}"

  if [ "${IS_MACOS}" = "1" ]; then
    if [ "${_HOST_ARCH}" = "arm64" ]; then
      # Apple Silicon: HVF works for aarch64 guests only
      _accel_opts=(-machine "${_machine},accel=hvf" -cpu host)
    else
      # Intel Mac: HVF works for x86_64 guests
      _accel_opts=(-machine "${_machine},accel=hvf" -cpu host)
    fi
  elif [ -e /dev/kvm ] && [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
    _accel_opts=(-enable-kvm -machine "${_machine},accel=kvm" -cpu host)
  else
    _accel_opts=(-machine "${_machine}")
    warn "No hardware acceleration – VM will be SLOW."
  fi

  # Platform: display
  local _display_opts=()
  if [ "${HEADLESS}" = true ]; then
    _display_opts=(-nographic)
  elif [ "${IS_MACOS}" = "1" ]; then
    _display_opts=(-display cocoa)
  elif [ "${IS_WSL}" = "1" ]; then
    # WSL2: try gtk first, fall back to sdl
    if command -v gtk-launch >/dev/null 2>&1 || [ -n "${DISPLAY:-}" ]; then
      _display_opts=(-display gtk)
    else
      _display_opts=(-display sdl)
      warn "No X11 display detected. Install VcXsrv or use --headless."
    fi
  else
    _display_opts=(-display gtk)
  fi

  info "  Platform: $([ "${IS_MACOS}" = "1" ] && echo "macOS")$([ "${IS_LINUX}" = "1" ] && echo "Linux")$([ "${IS_WSL}" = "1" ] && echo "WSL2")"
  info "  QEMU:     ${_qemu}"
  info "  RAM:      ${VM_RAM}"
  info "  CPUs:     ${VM_CPUS}"
  info "  Disk:     ${VM_DISK}"

  # ── Build QEMU args ──────────────────────────────────────────────────
  local _netdev="virtio-net-pci"
  if [ "${DEV_MODE}" = "native" ] && [ "${_HOST_ARCH}" = "arm64" ]; then
    _netdev="virtio-net-device"
  fi

  local QEMU_ARGS=(
    -m "${VM_RAM}"
    -smp "${VM_CPUS}"
    -drive "file=${VM_DISK},format=qcow2,if=virtio"
    -netdev "user,id=net0,hostfwd=tcp::${IORA_HOME_PORT}-:8126,hostfwd=tcp::${DEV_BRIDGE_PORT}-:8101,hostfwd=tcp::8090-:8090,hostfwd=tcp::8091-:8091,hostfwd=tcp::8092-:8092,hostfwd=tcp::8093-:8093,hostfwd=tcp::${VM_SSH_PORT}-:22"
    -device "${_netdev},netdev=net0"
    -name "IORA OS Dev"
    "${_accel_opts[@]}"
  )
  # GPU/display is in display opts or handled by machine type
  if [ "${DEV_MODE}" != "native" ] || [ "${_HOST_ARCH}" != "arm64" ]; then
    QEMU_ARGS+=(-vga virtio)
  else
    QEMU_ARGS+=(-device virtio-gpu)
  fi
  QEMU_ARGS+=("${_display_opts[@]}")

  # ── Native mode extras ──────────────────────────────────────────────
  if [ "${DEV_MODE}" = "native" ]; then
    local _cloud_iso="${SCRIPT_DIR}/.cache/cloud-init.iso"
    if [ -f "${_cloud_iso}" ]; then
      QEMU_ARGS+=(-drive "file=${_cloud_iso},format=raw,if=virtio")
    fi
    # Aarch64 needs UEFI firmware for boot
    if [ "${_HOST_ARCH}" = "arm64" ]; then
      local _fw="/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
      [ ! -f "${_fw}" ] && _fw=$(find /opt/homebrew -name "edk2-aarch64-code.fd" 2>/dev/null | head -1)
      [ ! -f "${_fw}" ] && _fw=$(find /usr -name "edk2-aarch64-code.fd" 2>/dev/null | head -1)
      if [ -f "${_fw}" ]; then
        QEMU_ARGS+=(-bios "${_fw}")
        info "  UEFI:     ${_fw}"
      else
        warn "  edk2-aarch64-code.fd not found – VM may not boot."
        warn "  Install: brew install qemu (should include EDK2 firmware)"
      fi
      # Force disk boot, skip PXE/network boot delay
      QEMU_ARGS+=(-boot order=d,menu=off)
      # Redirect serial console to log file (aarch64 boot messages go to serial)
      QEMU_ARGS+=(-serial "file:${SCRIPT_DIR}/.cache/boot.log")
    fi
  fi

  # Start QEMU
  "${_qemu}" "${QEMU_ARGS[@]}" &
  QEMU_PID=$!
  info "  QEMU PID: ${QEMU_PID}"

  # Wait for VM boot
  echo ""
  local _label="IORA OS"
  [ "${DEV_MODE}" = "native" ] && _label="Debian"
  log "Waiting for ${_label} to boot..."
  if [ "${DEV_MODE}" = "native" ] && [ "${_NEED_CLOUD_INIT:-false}" = "true" ]; then
    info "  First boot – cloud-init is setting up the VM..."
    info "  Phase 1: Package install (Rust, Node, Docker) ~2 min"
    info "  Phase 2: IORA workspace build (cargo --release) ~10-30 min"
    info "  Waiting for cloud-init to finish..."
  fi
  echo ""
  echo -e "${D}──────────────── VM Boot Log ────────────────${N}"

  # Show live boot log while waiting
  local _boot_log="${SCRIPT_DIR}/.cache/boot.log"
  local _tail_pid=""
  # Wait a moment for QEMU to create the log file
  sleep 2
  if [ -f "${_boot_log}" ] && [ -s "${_boot_log}" ]; then
    tail -f "${_boot_log}" 2>/dev/null &
    _tail_pid=$!
  fi

  local _max_wait=600  # 10 min for cloud-init package install
  local _waited=0 _reachable=false
  local _check_port="${VM_SSH_PORT}"

  while [ "${_waited}" -lt "${_max_wait}" ]; do
    # Wait for SSH (cloud-init only installs packages, ~2 min)
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o BatchMode=yes \
         -p "${_check_port}" iora@localhost "test -f /etc/iora/ssh-ready" 2>/dev/null; then
      _reachable=true; break
    fi
    # Fallback: just SSH reachable
    if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 -o BatchMode=yes \
         -p "${_check_port}" iora@localhost "exit" 2>/dev/null; then
      if [ $(( _waited % 60 )) -eq 0 ]; then
        echo ""
        info "  SSH ready, waiting for cloud-init package install..."
        echo -n "  "
      fi
    fi
    sleep 5; _waited=$(( _waited + 5 ))
    echo -n "."
  done
  echo ""

  # Stop live log
  [ -n "${_tail_pid:-}" ] && kill "${_tail_pid}" 2>/dev/null || true

  if [ "${_reachable}" = true ]; then
    success "VM is ready – setting up IORA..."
    echo ""
    _setup_vm_via_ssh
  else
    error "${_label} not reachable within ${_max_wait}s."
    error "Check: tail -f ${_boot_log}"
    error "VM may need more time or QEMU may have crashed."
    exit 1
  fi

  echo ""
}

# ── Start Vite Dev Server ───────────────────────────────────────────────────
start_frontend() {
  [ "${NO_FRONTEND}" = true ] && return 0
  [ ! -d "${FRONTEND_DIR}" ] && { warn "Frontend not found: ${FRONTEND_DIR}"; return 0; }

  log "Starting Vite dev server..."
  (
    cd "${FRONTEND_DIR}"
    [ ! -d "node_modules" ] && { info "Installing npm deps..."; npm install --silent 2>&1 | tail -3; }
    VITE_BACKEND_URL="http://localhost:${IORA_HOME_PORT}" \
      npx vite --host 0.0.0.0 --port 5173 &
    VITE_PID=$!
  )
  success "Frontend HMR: http://localhost:5173"
}

# ── Start Rust Backend Watcher ──────────────────────────────────────────────
start_backend_watcher() {
  [ "${NO_BACKEND}" = true ] && return 0

  local _deploy_bin="${SCRIPT_DIR}/tools/iora-dev-deploy/target/release/iora-dev-deploy"
  if [ ! -f "${_deploy_bin}" ]; then
    (cd "${SCRIPT_DIR}/tools/iora-dev-deploy" && cargo build --release) || {
      error "Failed to build iora-dev-deploy."
      return 1
    }
  fi

  log "Starting Rust file watcher..."
  "${_deploy_bin}" connect "localhost:${DEV_BRIDGE_PORT}" --token "dev" 2>/dev/null || true
  "${_deploy_bin}" watch --automatic --debounce-ms 2000 &
  WATCHER_PID=$!
  success "Rust watcher active – save .rs to hot-deploy"
}

# ── Status ──────────────────────────────────────────────────────────────────
show_status() {
  local _vm_status="RUNNING"
  local _rust_status="disabled"
  local _web_status="disabled"
  [ -n "${QEMU_PID:-}" ] && kill -0 "${QEMU_PID}" 2>/dev/null || _vm_status="STOPPED"
  curl -s --connect-timeout 1 "http://localhost:${DEV_BRIDGE_PORT}/dev/health" >/dev/null 2>&1 && _rust_status="HOT RELOAD"
  curl -s --connect-timeout 1 "http://localhost:5173" >/dev/null 2>&1 && _web_status="HMR :5173"
  curl -s --connect-timeout 1 "http://localhost:5174" >/dev/null 2>&1 && _web_status="HMR :5174"
  echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${N}"
  echo -e "${BOLD}║${N}  ${C}http://localhost:${IORA_HOME_PORT}${N}  ← Dashboard"
  echo -e "${BOLD}║${N}  ${C}http://localhost:5173${N}              ← Frontend (Vite HMR)"
  echo -e "${BOLD}║${N}  ${C}http://localhost:${DEV_BRIDGE_PORT}/dev/health${N}  ← Dev Bridge"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${N}"
  echo -e "${D}Ctrl+C to stop${N}"
}

# ── Setup VM via SSH (after cloud-init, with live progress) ────────────────
_setup_vm_via_ssh() {
  local _ssh="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p ${VM_SSH_PORT} iora@localhost"
  local _scp="scp -o StrictHostKeyChecking=no -P ${VM_SSH_PORT}"

  # Already built?
  if ${_ssh} "test -f /opt/iora/build/iora-home/bin/iora-home" 2>/dev/null; then
    success "IORA already built – skipping setup."
    return 0
  fi

  log "═══════════════════════════════════════════════"
  log "Setting up IORA in VM (~10-30 min first time)"
  log "═══════════════════════════════════════════════"
  echo ""

  # Step 1: Upload project
  log "[1/4] Uploading project via rsync..."
  ${_ssh} "mkdir -p /home/iora/iora" 2>/dev/null
  rsync -az --delete \
    --exclude='.git' --exclude='target' --exclude='node_modules' \
    --exclude='.cache' --exclude='buildroot-*' --exclude='releases' \
    --exclude='*.img' --exclude='*.qcow2' --exclude='*.iso' \
    -e "ssh -o StrictHostKeyChecking=no -p ${VM_SSH_PORT}" \
    "${REPO_ROOT}/" "iora@localhost:/home/iora/iora/" 2>&1 | tail -3
  success "Project uploaded."

  # Step 2: OS compat + service units
  log "[2/4] IORA OS compatibility + service units..."
  ${_ssh} "sudo bash /home/iora/iora/iora-os/iora-dev-compat.sh 2>&1" | tail -5 || true
  ${_ssh} "sudo bash /home/iora/iora/iora-os/iora-dev-services.sh 2>&1" | tail -5 || true

  # Step 3: cargo build (LIVE output)
  log "[3/4] Building IORA workspace (cargo --release)..."
  info "  Live build output follows. First build: 10-30 min."
  echo ""
  ${_ssh} -t "source ~/.cargo/env 2>/dev/null; cd /home/iora/iora/iora-os/backend && cargo build --workspace --release 2>&1" || warn "cargo build had errors."
  echo ""

  # Step 4: Deploy binaries + start
  log "[4/4] Deploying + starting services..."
  ${_ssh} 'bash -s' <<'DEPLOYEOF'
for svc in iora-core iora-home iora-control iora-assist iora-secrets \
           iora-watchdog iora-security iora-gateway iora-supervisor \
           iora-api iora-appstore iora-backup iora-connector iora-dev-bridge \
           iora-files iora-network-monitor iora-nginx iora-resource-manager iora-updater; do
  src="/home/iora/iora/iora-os/backend/target/release/${svc}"
  if [ -f "$src" ]; then
    sudo mkdir -p "/opt/iora/build/${svc}/bin"
    sudo cp "$src" "/opt/iora/build/${svc}/bin/${svc}"
    sudo chmod 755 "/opt/iora/build/${svc}/bin/${svc}"
    echo "  deployed: ${svc}"
  fi
done
sudo systemctl daemon-reload
sudo systemctl start iora-core iora-home iora-dev-bridge 2>/dev/null || true
echo "DONE" > /tmp/iora-setup-done
DEPLOYEOF

  success "IORA services deployed and started."
  echo ""
}

# ── Clean cache + VM ────────────────────────────────────────────────────────
_do_clean() {
  local _cache="${SCRIPT_DIR}/.cache"
  echo ""
  log "Cleaning IORA dev cache + VM..."
  if [ -d "${_cache}" ]; then
    local _freed; _freed=$(du -sm "${_cache}" 2>/dev/null | cut -f1 || echo 0)
    local _count; _count=$(find "${_cache}" -type f 2>/dev/null | wc -l | tr -d ' ')
    rm -rf "${_cache}"
    success "Removed .cache/ (${_count} files, ~${_freed} MB freed)"
  else
    info "No cache found – already clean."
  fi
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════

banner

# Always clean stale VMs to prevent port conflicts
_kill_stale_vms

# Handle --clean
if [ "${_CLEAN_FIRST:-false}" = true ]; then
  _do_clean
  exit 0
fi

if ! check_prereqs; then
  if [ "${INSTALL_REQUIRED}" = true ]; then
    auto_install
    # Re-check after install
    if ! check_prereqs; then
      warn "Some prerequisites still missing – starting with reduced functionality."
    fi
  else
    error "Run with -ir / --install-required to auto-install missing packages."
    exit 1
  fi
fi

log "Step 1/4: VM Setup (mode: ${DEV_MODE})..."
if [ "${DEV_MODE}" = "native" ]; then
  _setup_native_vm
else
  find_or_build_image
fi

log "Step 2/4: QEMU VM..."
start_qemu

log "Step 3/4: Dev services..."

# Only start watchers if dev-bridge is reachable (IORAservices are running)
if curl -s --connect-timeout 2 "http://localhost:${DEV_BRIDGE_PORT}/dev/health" >/dev/null 2>&1; then
  start_backend_watcher
else
  warn "Dev-bridge (port ${DEV_BRIDGE_PORT}) not reachable – skipping watchers."
  warn "Build & start IORA in the VM first, then restart."
fi

# Start Vite only if iora-home is reachable
if curl -s --connect-timeout 2 "http://localhost:${IORA_HOME_PORT}" >/dev/null 2>&1; then
  start_frontend
else
  warn "iora-home (port ${IORA_HOME_PORT}) not reachable – skipping frontend."
fi

log "Step 4/4: Ready!"
show_status
_DEV_STARTED=1
wait
