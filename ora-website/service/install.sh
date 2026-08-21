#!/usr/bin/env bash
# ============================================================================
# rumahl OS — one-line installer
# ============================================================================
#
#   curl -fsSL https://rumahl.com/install | bash
#
# Installs rumahl OS on your hardware or Linux server:
#
#   Interactive                       Detect & ask what to do
#   --server                         Docker Compose install on this Linux host
#   --device /dev/sdX                Flash the rumahl OS image to a device
#   --yes                            Non-interactive (safe defaults)
#   --version                        Show installer version and exit
#   --help                           This help
#
# Examples:
#   curl -fsSL https://rumahl.com/install | bash -s -- --server
#   curl -fsSL https://rumahl.com/install | bash -s -- --device /dev/sda --yes
# ============================================================================

set -euo pipefail

INSTALLER_VERSION="1.0.0"
REPO="rumahl/rumahl"
GITHUB_BASE="https://github.com/${REPO}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
RELEASE_BASE="${GITHUB_BASE}/releases/latest/download"
IMAGE_NAME="rumahl-os.img.xz"
COMPOSE_FILE="docker-compose.rumahl-os.yml"

# ── Colors ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  R="\033[0;31m"; G="\033[0;32m"; Y="\033[1;33m"; C="\033[0;36m"; BOLD="\033[1m"; N="\033[0m"
else
  R=""; G=""; Y=""; C=""; BOLD=""; N=""
fi

say()  { printf "${G}==>${N} %s\n" "$*"; }
warn() { printf "${Y}WARN:${N} %s\n" "$*"; }
fail() { printf "${R}ERROR:${N} %s\n" "$*" >&2; exit 1; }
info() { printf "    %s\n" "$*"; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ── CLI parsing ──────────────────────────────────────────────────────────────
MODE="interactive"
DEVICE=""
ASSUME_YES=false

while [ $# -gt 0 ]; do
  case "$1" in
    --server)     MODE="server" ;;
    --device)     MODE="flash"; shift; [ $# -ge 1 ] || fail "--device needs a block device, e.g. /dev/sda"; DEVICE="$1" ;;
    --yes)        ASSUME_YES=true ;;
    --version)    echo "rumahl OS installer v${INSTALLER_VERSION}"; exit 0 ;;
    --help|-h)    usage ;;
    *)            fail "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

# ── Detection ────────────────────────────────────────────────────────────────
OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
IS_RPI=false
if [ -f /proc/device-tree/model ] && grep -qi "raspberry" /proc/device-tree/model 2>/dev/null; then
  IS_RPI=true
fi

# ── Download helper ──────────────────────────────────────────────────────────
download() { # $1=url  $2=dest
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$dest" "$url" || fail "Download failed: $url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url" || fail "Download failed: $url"
  else
    fail "Neither curl nor wget found. Install one of them first (apt install curl)."
  fi
}

confirm() { # $1=prompt
  [ "$ASSUME_YES" = true ] && return 0
  printf "%s [y/N] " "$1"
  read -r answer
  case "$answer" in
    y|Y|yes|Yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ── Mode: server (Docker Compose) ────────────────────────────────────────────
install_server() {
  say "Installing rumahl OS via Docker Compose"

  if [ "$OS" != "Linux" ]; then
    fail "Server install currently supports Linux only (detected: $OS). Use the image install instead: curl -fsSL https://rumahl.com/install | bash -s -- --device /dev/sdX"
  fi
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose). Update Docker or install the compose plugin."

  local install_dir
  if [ "$(id -u)" -eq 0 ]; then
    install_dir="/opt/rumahl"
  else
    install_dir="$HOME/rumahl"
    warn "Not running as root — installing to $install_dir. Some features may need elevated permissions."
  fi

  mkdir -p "$install_dir"
  cd "$install_dir"

  say "Downloading compose stack from ${REPO}…"
  download "${RAW_BASE}/deploy/${COMPOSE_FILE}" "$COMPOSE_FILE"
  download "${RAW_BASE}/deploy/.env.example" ".env.example"
  [ -f .env ] || cp .env.example .env
  download "${RAW_BASE}/deploy/init-postgres.sh" "init-postgres.sh" || warn "init-postgres.sh not available; the stack may need manual DB init."
  chmod +x init-postgres.sh 2>/dev/null || true

  say "Starting services (this can take a few minutes on first run)…"
  docker compose up -d

  echo
  say "rumahl OS is up."
  info "Dashboard:      http://localhost:8126"
  info "App Store:      http://localhost:8098"
  info "Install dir:    $install_dir"
  info "Config:         $install_dir/.env  (edit, then: docker compose up -d)"
  info "Logs:           docker compose -f $install_dir/$COMPOSE_FILE logs -f"
  echo
  warn "Change the default credentials immediately after the first login!"
}

# ── Mode: flash image to device ─────────────────────────────────────────────
install_flash() {
  if [ "$OS" != "Linux" ]; then
    fail "Image flashing currently supports Linux only (detected: $OS)."
  fi
  [ "$(id -u)" -eq 0 ] || fail "Flashing requires root: re-run with sudo (curl -fsSL https://rumahl.com/install | sudo bash -s -- --device $DEVICE)"

  local dev="$DEVICE"
  [ -n "$dev" ] || fail "No device given. List devices with: lsblk — then use: --device /dev/sdX"
  [ -b "$dev" ] || fail "Not a block device: $dev (check with: lsblk)"

  if [ "$IS_RPI" = true ]; then
    say "Raspberry Pi detected ($(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo unknown))"
  else
    say "Installing rumahl OS image to $dev"
  fi

  # Safety: never flash the running system disk
  local root_dev
  root_dev="$(findmnt -no SOURCE / 2>/dev/null || echo "")"
  if [ -n "$root_dev" ] && [ "$root_dev" = "/dev/root" ]; then
    root_dev="$(readlink -f "$root_dev" 2>/dev/null || echo "$root_dev")"
  fi
  if [ -n "$root_dev" ] && [ "${root_dev#"$dev"}" != "$root_dev" ]; then
    warn "Refusing to flash $dev — this looks like the running system disk (root: $root_dev)."
    fail "Pick another device. List candidates: lsblk"
  fi

  echo
  warn "ALL DATA on $dev will be DESTROYED!"
  lsblk -o NAME,SIZE,MODEL,TRAN "$dev" 2>/dev/null | sed 's/^/    /' || true
  confirm "Continue flashing $dev?" || { info "Aborted."; exit 1; }

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  say "Downloading ${IMAGE_NAME}…"
  download "${RELEASE_BASE}/${IMAGE_NAME}" "$tmp/${IMAGE_NAME}"

  # Optional checksum verification (best effort — not all releases ship one)
  if download "${RELEASE_BASE}/${IMAGE_NAME}.sha256" "$tmp/${IMAGE_NAME}.sha256" 2>/dev/null; then
    say "Verifying checksum…"
    (cd "$tmp" && sha256sum -c "${IMAGE_NAME}.sha256") || fail "Checksum mismatch — download corrupted. Aborting before any write."
  else
    warn "No checksum file in this release — skipping verification."
  fi

  say "Flashing $dev (this takes several minutes)…"
  xzcat "$tmp/${IMAGE_NAME}" | dd of="$dev" bs=4M status=progress conv=fsync 2>&1 | sed 's/^/    /'
  sync

  echo
  say "Image written successfully!"
  info "1. Remove the device and connect it to your hardware."
  info "2. Boot rumahl OS and open the dashboard at http://<device-ip>:8126"
  warn "Change the default credentials at first login!"
}

# ── Interactive mode ─────────────────────────────────────────────────────────
install_interactive() {
  echo
  info "${BOLD}rumahl OS installer v${INSTALLER_VERSION}${N}"
  info "Detected: $OS / $ARCH${IS_RPI:+" / Raspberry Pi"}"
  echo
  if [ "$IS_RPI" = true ]; then
    say "Recommended: flash the rumahl OS image to an SD card."
  else
    say "Two ways to install rumahl OS:"
  fi
  echo "    ${BOLD}1)${N} Linux server (Docker Compose) — run rumahl OS as containers"
  echo "    ${BOLD}2)${N} Flash image to a device (SD card / USB / disk)"
  echo
  if confirm "Install on this server with Docker (1)? [y/N] — 'n' starts the image flash flow"; then
    MODE="server"
  else
    MODE="flash"
    echo
    info "Available devices:"
    lsblk -d -o NAME,SIZE,MODEL,TRAN 2>/dev/null | sed 's/^/    /' || true
    printf "    ${C}Device to flash (e.g. /dev/sda):${N} "
    read -r dev
    DEVICE="${dev:-}"
    [ -n "$DEVICE" ] || fail "No device entered."
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  if [ "$MODE" = "interactive" ]; then
    install_interactive
  fi
  case "$MODE" in
    server) install_server ;;
    flash)  install_flash  ;;
  esac
}

main "$@"
