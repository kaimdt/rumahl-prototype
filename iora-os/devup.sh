#!/usr/bin/env bash
# ============================================================================
# devup.sh – IORA OS Dev Inkrementelles Update-Skript
# ============================================================================
#
# Baut geänderte IORA-Services auf dem Build-Host (via Docker/Alpine für
# GLIBC-Kompatibilität) und deployed sie per HTTP an die iora-dev-bridge
# auf dem IORA OS Dev-Gerät.
#
# KEIN komplettes OS-Rebuild nötig – nur die Services, die sich geändert
# haben, werden neu gebaut und auf das Gerät übertragen.
#
# Voraussetzungen auf dem Build-Host:
#   - Docker (für GLIBC-sichere Cross-Compilation)
#   - curl / jq (für HTTP-Requests an die Bridge)
#   - git (für Change-Detection)
#
# Voraussetzungen auf dem IORA OS Dev-Gerät:
#   - iora-dev-bridge läuft auf Port 8101
#   - /dev/replace-binary Endpoint erreichbar
#   - Dev-Token bekannt (aus /var/lib/iora/dev-token oder Build-Log)
#
# Verwendung:
#   ./devup.sh                           # Interaktiv: fragt nach Device
#   ./devup.sh --host 192.168.1.100      # Direkt mit IP
#   ./devup.sh --host my-dev.local       # mDNS
#   ./devup.sh --status                  # Zeigt Versionen (lokal vs Device)
#   ./devup.sh --list                    # Listet änderbare Services
#   ./devup.sh --service iora-home       # Nur einen Service bauen+deployen
#   ./devup.sh --all                     # Alle Services bauen+deployen
#   ./devup.sh --no-restart              # Build + Upload, kein Restart
#   ./devup.sh --dry-run                 # Zeigt was gebaut würde, ohne zu deployen
#   ./devup.sh --save                    # Speichert Host+Token in Config
#
# Umgebungsvariablen:
#   IORA_DEV_HOST    – IP/Hostname des IORA OS Dev-Geräts (Port 8101)
#   IORA_DEV_TOKEN   – Dev-Token (Hex-String aus /var/lib/iora/dev-token)
#   IORA_DEVUP_JOBS  – Anzahl paralleler Docker-Builds (Default: nproc)
#
# Config-Datei:
#   ~/.config/iora-devup/config    – Speichert Host und Token
#   ~/.config/iora-devup/lastbuild – Git-Commit des letzten Builds
# ============================================================================

set -euo pipefail

# ── Farben ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  R="\033[0;31m"; G="\033[0;32m"; Y="\033[1;33m"; B="\033[0;34m"; C="\033[0;36m"; N="\033[0m"
  BOLD="\033[1m"
else
  R=""; G=""; Y=""; B=""; C=""; N=""; BOLD=""
fi

# ── Pfade ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
CONFIG_DIR="${HOME}/.config/iora-devup"
CONFIG_FILE="${CONFIG_DIR}/config"
LAST_BUILD_FILE="${CONFIG_DIR}/lastbuild"
DOCKERFILE="${BACKEND_DIR}/Dockerfile"
BUILD_LOG_DIR="/tmp/iora-devup-logs"

# ── IORA Services (wie in build-all-images.sh definiert) ─────────────────────
IORA_SERVICES=(
  iora-core iora-home iora-control iora-assist iora-secrets
  iora-watchdog iora-security iora-gateway iora-supervisor
  iora-api iora-appstore iora-backup iora-connector
  iora-dev-bridge iora-domain-validator iora-files
  iora-network-monitor iora-nginx iora-resource-manager
  iora-updater
)

IORA_BINARY_PATHS=(
  iora-core:/usr/bin/iora-core
  iora-home:/usr/bin/iora-home
  iora-control:/usr/bin/iora-control
  iora-assist:/usr/bin/iora-assist
  iora-secrets:/usr/bin/iora-secrets
  iora-watchdog:/usr/bin/iora-watchdog
  iora-security:/usr/bin/iora-security
  iora-gateway:/usr/bin/iora-gateway
  iora-supervisor:/usr/bin/iora-supervisor
  iora-api:/usr/bin/iora-api
  iora-appstore:/usr/bin/iora-appstore
  iora-backup:/usr/bin/iora-backup
  iora-connector:/usr/bin/iora-connector
  iora-dev-bridge:/usr/bin/iora-dev-bridge
  iora-domain-validator:/usr/bin/iora-domain-validator
  iora-files:/usr/bin/iora-files
  iora-network-monitor:/usr/bin/iora-network-monitor
  iora-nginx:/usr/bin/iora-nginx
  iora-resource-manager:/usr/bin/iora-resource-manager
  iora-updater:/usr/bin/iora-updater
)

# ── Args ─────────────────────────────────────────────────────────────────────
HOST="${IORA_DEV_HOST:-}"
TOKEN="${IORA_DEV_TOKEN:-}"
MODE="auto"
SELECTED_SERVICES=()
NO_RESTART=false
DRY_RUN=false
JOBS="${IORA_DEVUP_JOBS:-$(nproc 2>/dev/null || echo 4)}"

usage() {
  cat <<EOF
${BOLD}devup.sh${N} – IORA OS Dev Inkrementelles Update-Tool

${BOLD}Verwendung:${N}
  ./devup.sh [OPTIONEN]

${BOLD}Optionen:${N}
  --host HOST[:PORT]    IORA OS Dev-Gerät (IP oder mDNS, Default-Port 8101)
  --token HEX           Dev-Token (aus /var/lib/iora/dev-token)
  --service, -s NAME    Nur einen bestimmten Service bauen+deployen
  --all, -a             Alle Services bauen+deployen
  --no-restart, -n      Nur hochladen, Services nicht neustarten
  --dry-run             Zeigt was gebaut würde (kein Build/Deploy)
  --status              Lokale und Device-Version vergleichen
  --list, -l            Alle Services und Änderungsstatus auflisten
  --save                Host und Token in Config speichern
  --jobs, -j N          Parallele Build-Jobs (Default: ${JOBS})
  --help, -h            Diese Hilfe

${BOLD}Beispiele:${N}
  ./devup.sh                                    # Interaktiv
  ./devup.sh --host 192.168.1.42                # Nur geänderte Services
  ./devup.sh --service iora-home                # Nur iora-home
  ./devup.sh --all --no-restart                 # Alle bauen, nicht neustarten
  ./devup.sh --status                           # Versionen vergleichen
  ./devup.sh --host 192.168.1.42 --save         # Config speichern
  ./devup.sh --dry-run                          # Vorschau

${BOLD}Config:${N}  ${CONFIG_FILE}
${BOLD}Logs:${N}    ${BUILD_LOG_DIR}/
EOF
  exit 0
}

# ── Logging ──────────────────────────────────────────────────────────────────
log()     { echo -e "${B}[devup]${N} $*"; }
success() { echo -e "${G}[  OK ]${N} $*"; }
warn()    { echo -e "${Y}[ WARN]${N} $*"; }
error()   { echo -e "${R}[ERROR]${N} $*"; }
info()    { echo -e "${C}[ INFO]${N} $*"; }

# ── Config laden/speichern ───────────────────────────────────────────────────
load_config() {
  if [ -f "${CONFIG_FILE}" ]; then
    # shellcheck disable=SC1090
    source "${CONFIG_FILE}"
    HOST="${IORA_DEVUP_HOST:-${HOST}}"
    TOKEN="${IORA_DEVUP_TOKEN:-${TOKEN}}"
  fi
}

save_config() {
  mkdir -p "${CONFIG_DIR}"
  cat > "${CONFIG_FILE}" <<EOF
# IORA devup config
IORA_DEVUP_HOST="${HOST}"
IORA_DEVUP_TOKEN="${TOKEN}"
EOF
  chmod 600 "${CONFIG_FILE}"
  success "Config gespeichert: ${CONFIG_FILE}"
}

# ── Device-Kommunikation ─────────────────────────────────────────────────────
normalize_url() {
  local h="$1"
  h="${h%/}"
  # Wenn kein Schema, http:// und Port 8101 hinzufügen
  if [[ ! "$h" =~ ^https?:// ]]; then
    if [[ ! "$h" =~ :[0-9]+$ ]]; then
      h="${h}:8101"
    fi
    h="http://${h}"
  fi
  echo "$h"
}

device_api() {
  local method="$1" endpoint="$2" data="${3:-}"
  local url base
  base="$(normalize_url "${HOST}")"
  url="${base}${endpoint}"
  local curl_opts=(-s -S --connect-timeout 5 --max-time 30)
  if [ -n "${TOKEN:-}" ]; then
    curl_opts+=(-H "X-IORA-Dev-Token: ${TOKEN}")
  fi
  if [ -n "$data" ]; then
    curl "${curl_opts[@]}" -X "${method}" -H "Content-Type: application/json" -d "$data" "$url"
  else
    curl "${curl_opts[@]}" -X "${method}" "$url"
  fi
}

check_device() {
  local resp
  resp="$(device_api GET "/dev/status" "" 2>/dev/null || true)"
  if [ -z "$resp" ]; then
    error "Keine Antwort von ${HOST} – läuft iora-dev-bridge auf Port 8101?"
    return 1
  fi
  local variant
  variant="$(echo "$resp" | jq -r '.variant // "unknown"')"
  if [ "$variant" != "dev" ]; then
    error "Gerät meldet variant='${variant}' statt 'dev' – kein Dev-Image!"
    return 1
  fi
  echo "$resp"
}

get_device_version() {
  local resp
  resp="$(device_api GET "/dev/status" "" 2>/dev/null || true)"
  echo "$resp" | jq -r '.build // "unknown"'
}

get_device_capabilities() {
  local resp
  resp="$(device_api GET "/dev/status" "" 2>/dev/null || true)"
  echo "$resp" | jq -r '.capabilities[]? // empty'
}

auth_device() {
  # Versuche Auth über iora-home credentials falls Token nicht funktioniert
  if [ -n "${TOKEN:-}" ]; then
    local status_resp
    status_resp="$(device_api GET "/dev/status" "" 2>/dev/null || true)"
    if echo "$status_resp" | jq -e '.dev_mode == true' >/dev/null 2>&1; then
      return 0
    fi
    warn "Token ungültig, versuche Interactive Auth..."
  fi

  echo ""
  info "Bitte IORA Dashboard Login-Daten eingeben:"
  read -r -p "  Username: " username
  read -r -s -p "  Password: " password
  echo ""

  local auth_resp
  auth_resp="$(device_api POST "/dev/auth" "{\"username\":\"${username}\",\"password\":\"${password}\"}" 2>/dev/null || true)"
  local session_token
  session_token="$(echo "$auth_resp" | jq -r '.token // empty')"
  if [ -n "$session_token" ]; then
    TOKEN="$session_token"
    success "Authentifiziert als ${username} (Session-Token)"
    return 0
  fi
  error "Auth fehlgeschlagen: $(echo "$auth_resp" | jq -r '. // "keine Antwort"')"
  return 1
}

replace_binary() {
  local service="$1" bin_path="$2" binary_name="$3"
  local sha
  sha="$(sha256sum "$bin_path" | cut -d' ' -f1)"

  info "Uploading ${binary_name} ($(du -h "$bin_path" | cut -f1)) SHA256=${sha:0:16}..."

  local resp
  resp="$(curl -s -S --connect-timeout 10 --max-time 120 \
    -H "X-IORA-Dev-Token: ${TOKEN}" \
    -F "target=/usr/bin/${binary_name}" \
    -F "sha256=${sha}" \
    -F "unit=${service}.service" \
    -F "file=@${bin_path};filename=${binary_name}" \
    "$(normalize_url "${HOST}")/dev/replace-binary" 2>&1)"

  local ok
  ok="$(echo "$resp" | jq -r '.restart.ok // false')"
  if [ "$ok" = "true" ]; then
    success "${service} deployed & restarted"
    return 0
  else
    local code stderr_msg
    code="$(echo "$resp" | jq -r '.restart.code // "?"')"
    stderr_msg="$(echo "$resp" | jq -r '.restart.stderr // ""' | head -5)"
    error "${service} deploy fehlgeschlagen (exit=${code}): ${stderr_msg}"
    # Upload könnte trotzdem geklappt haben – versuche manuellen Restart
    warn "Versuche manuellen Restart von ${service}.service..."
    device_api POST "/dev/service/${service}/restart" "" 2>/dev/null || true
    return 1
  fi
}

# ── Docker Build ─────────────────────────────────────────────────────────────
check_prerequisites() {
  local missing=()
  if ! command -v docker >/dev/null 2>&1; then
    missing+=("docker")
  fi
  if ! command -v curl >/dev/null 2>&1; then
    missing+=("curl")
  fi
  if ! command -v jq >/dev/null 2>&1; then
    missing+=("jq")
  fi
  if ! command -v sha256sum >/dev/null 2>&1; then
    missing+=("sha256sum")
  fi
  if [ ${#missing[@]} -gt 0 ]; then
    error "Fehlende Tools: ${missing[*]}"
    error "Installiere mit: sudo apt-get install -y ${missing[*]}"
    return 1
  fi
  return 0
}

detect_target_arch() {
  # Versuche die Ziel-Architektur vom Device zu ermitteln
  local resp
  resp="$(device_api GET "/dev/status" "" 2>/dev/null || true)"
  # Prüfe auf Architektur-Hinweise in der Build-ID oder im Hostname
  # Standard: nimm lokale Architektur als Default
  local host_arch
  host_arch="$(uname -m)"
  # Für Buildroot: aarch64 Target erkennt man an der defconfig
  if [ -f "${SCRIPT_DIR}/.setup-target" ]; then
    local target
    target="$(tr -d '\n' < "${SCRIPT_DIR}/.setup-target" 2>/dev/null || echo pc)"
    case "$target" in
      rpi3|rpi4|rpi5|generic-arm64) echo "aarch64" ;;
      *) echo "$host_arch" ;;
    esac
  else
    echo "$host_arch"
  fi
}

docker_build_service() {
  local service="$1"
  local logfile="${BUILD_LOG_DIR}/${service}.log"
  local target_arch
  target_arch="$(detect_target_arch 2>/dev/null || uname -m)"
  local host_arch
  host_arch="$(uname -m)"

  mkdir -p "${BUILD_LOG_DIR}"

  # ── Architektur-Strategie wählen ──────────────────────────────────────
  # x86_64 host → x86_64 target: Alpine/musl über Dockerfile (schnell, kein QEMU)
  # x86_64 host → aarch64 target: ARM64 Docker-Image via QEMU-Emulation
  # aarch64 host → aarch64 target: Alpine/musl über Dockerfile (nativ)
  local docker_platform=""
  local rust_image=""
  if [ "$host_arch" = "x86_64" ] && [ "$target_arch" = "aarch64" ]; then
    # Cross-Compile: x86_64 → aarch64
    # Nutze das offizielle rust-Image für ARM64 via QEMU-Emulation
    docker_platform="linux/arm64"
    rust_image="rust:1.90"  # Debian-basiert, besser für QEMU als Alpine
    info "Baue ${service} via Docker (x86_64→aarch64 cross, QEMU)..."
  else
    # Native Build via Dockerfile (Alpine/musl)
    rust_image=""
    info "Baue ${service} via Docker (Alpine/musl, native arch)..."
  fi

  echo "==> $(date) Building ${service} (host=${host_arch}, target=${target_arch})" > "$logfile"

  local build_tag="iora-devup-${service}:$(date +%s)"

  if [ -n "$docker_platform" ]; then
    # ── ARM64 Cross-Compile via QEMU-Emulation ──────────────────────────
    # Prüfe ob QEMU binfmt registriert ist
    if ! docker run --rm --platform "$docker_platform" alpine:3.19 uname -m >/dev/null 2>&1; then
      warn "QEMU binfmt nicht registriert – installiere..."
      docker run --rm --privileged tonistiigi/binfmt:latest --install "arm64" >> "$logfile" 2>&1 || {
        error "QEMU-Installation fehlgeschlagen. Installiere manuell:"
        error "  docker run --rm --privileged tonistiigi/binfmt:latest --install arm64"
        return 1
      }
      success "QEMU binfmt für ARM64 installiert"
    fi

    # Baue im ARM64-Container mit Cross-Compilation-Target
    # Wir starten einen Container, installieren Deps, und bauen nur den einen Service
    local container_name="iora-devup-build-${service}-$$"

    cat > "${BUILD_LOG_DIR}/Dockerfile.arm64-${service}" <<'DOCKERFILE_ARM64'
ARG RUST_IMAGE=rust:1.90
FROM ${RUST_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libssl-dev libpq-dev perl cmake git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY . .

ARG SERVICE
RUN cargo build --release -p ${SERVICE} && \
    mkdir -p /out && \
    for d in target/release target/aarch64-unknown-linux-gnu/release target/x86_64-unknown-linux-gnu/release; do \
      if [ -x "$d/${SERVICE}" ]; then cp "$d/${SERVICE}" "/out/${SERVICE}"; break; fi; \
    done
DOCKERFILE_ARM64

    if ! docker build \
      --platform "$docker_platform" \
      --build-arg "RUST_IMAGE=${rust_image}" \
      --build-arg "SERVICE=${service}" \
      -t "${build_tag}" \
      -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${service}" \
      "${BACKEND_DIR}" \
      >> "$logfile" 2>&1; then
      error "Docker-Cross-Build für ${service} fehlgeschlagen"
      warn "Log: $logfile"
      tail -30 "$logfile" | while IFS= read -r line; do echo "  ${R}${line}${N}"; done
      docker image rm -f "${build_tag}" >/dev/null 2>&1 || true
      rm -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${service}"
      return 1
    fi
    rm -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${service}"
  else
    # ── Native Build via Dockerfile ─────────────────────────────────────
    if ! DOCKER_BUILDKIT=1 docker build \
      --progress=plain \
      --target builder \
      -t "${build_tag}" \
      -f "${DOCKERFILE}" \
      "${BACKEND_DIR}" \
      >> "$logfile" 2>&1; then
      error "Docker-Build für ${service} fehlgeschlagen"
      warn "Log: $logfile"
      tail -30 "$logfile" | while IFS= read -r line; do echo "  ${R}${line}${N}"; done
      docker image rm -f "${build_tag}" >/dev/null 2>&1 || true
      return 1
    fi
  fi

  # Extrahiere das Binary aus dem Image
  local bin_path="${BUILD_LOG_DIR}/${service}"
  if ! docker create --name "iora-devup-extract-${service}" "${build_tag}" >/dev/null 2>&1; then
    error "Konnte Container für ${service} nicht erstellen"
    docker image rm -f "${build_tag}" >/dev/null 2>&1 || true
    return 1
  fi

  # Binary im Container finden
  local container_bin=""
  for candidate in \
    "/out/${service}" \
    "/app/backend/target/release/${service}" \
    "/app/backend/target/aarch64-unknown-linux-gnu/release/${service}" \
    "/app/backend/target/x86_64-unknown-linux-musl/release/${service}" \
    "/app/backend/target/x86_64-unknown-linux-gnu/release/${service}"; do
    if docker exec "iora-devup-extract-${service}" test -f "$candidate" 2>/dev/null; then
      container_bin="$candidate"
      break
    fi
  done

  if [ -z "$container_bin" ]; then
    error "Binary ${service} nicht im Container gefunden"
    warn "Container-Pfade durchsuchen..."
    docker exec "iora-devup-extract-${service}" find / -name "${service}" -type f 2>/dev/null | head -5
    docker rm -f "iora-devup-extract-${service}" >/dev/null 2>&1 || true
    docker image rm -f "${build_tag}" >/dev/null 2>&1 || true
    return 1
  fi

  docker cp "iora-devup-extract-${service}:${container_bin}" "$bin_path" 2>/dev/null
  docker rm -f "iora-devup-extract-${service}" >/dev/null 2>&1 || true
  docker image rm -f "${build_tag}" >/dev/null 2>&1 || true

  if [ ! -f "$bin_path" ] || [ ! -s "$bin_path" ]; then
    error "Konnte Binary für ${service} nicht extrahieren"
    return 1
  fi

  chmod +x "$bin_path"
  local size file_type
  size="$(du -h "$bin_path" | cut -f1)"
  file_type="$(file "$bin_path" 2>/dev/null | cut -d: -f2-)"
  success "${service} gebaut (${size}) [${file_type## }]"

  # GLIBC-Check (nur für gleiche Architektur sinnvoll)
  if command -v objdump >/dev/null 2>&1 && [ "$host_arch" = "$target_arch" ]; then
    local max_glibc
    max_glibc="$(objdump -T "$bin_path" 2>/dev/null \
      | grep -oE 'GLIBC_[0-9]+\.[0-9]+' \
      | sort -uV | tail -n 1 || true)"
    if [ -n "$max_glibc" ]; then
      local ver="${max_glibc#GLIBC_}"
      if awk -v v="$ver" 'BEGIN { exit !(v+0 > 2.38) }'; then
        warn "${service} benötigt ${max_glibc} (Ziel hat glibc 2.38) – Binary könnte beim Start crashen!"
      fi
    fi
  fi

  return 0
}

# ── Git Change Detection ─────────────────────────────────────────────────────
get_local_version() {
  cd "${SCRIPT_DIR}"
  git rev-parse --short HEAD 2>/dev/null || echo "unknown"
}

get_last_build_version() {
  if [ -f "${LAST_BUILD_FILE}" ]; then
    cat "${LAST_BUILD_FILE}"
  else
    echo ""
  fi
}

save_build_version() {
  mkdir -p "${CONFIG_DIR}"
  get_local_version > "${LAST_BUILD_FILE}"
}

get_changed_services() {
  local last_commit="$1"
  cd "${SCRIPT_DIR}"

  if [ -z "$last_commit" ]; then
    # Kein letzter Build → alle Services sind "geändert"
    echo "${IORA_SERVICES[@]}"
    return
  fi

  # Prüfe ob der Commit noch existiert (nach force-push o.ä.)
  if ! git cat-file -e "${last_commit}" 2>/dev/null; then
    warn "Commit ${last_commit} nicht mehr im Repo – baue alle Services"
    echo "${IORA_SERVICES[@]}"
    return
  fi

  local changed=()
  for svc in "${IORA_SERVICES[@]}"; do
    # Prüfe Änderungen im Service-Verzeichnis UND in shared
    if ! git diff --quiet "${last_commit}"..HEAD -- \
      "backend/${svc}/" \
      "backend/iora-shared/" \
      "backend/Cargo.toml" \
      "backend/Cargo.lock" \
      "backend/Dockerfile" 2>/dev/null; then
      changed+=("$svc")
    fi
  done
  echo "${changed[@]}"
}

# ── Interaktiver Modus ───────────────────────────────────────────────────────
interactive_setup() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════╗${N}"
  echo -e "${BOLD}║   IORA OS Dev – Inkrementelles Update   ║${N}"
  echo -e "${BOLD}╚══════════════════════════════════════════╝${N}"
  echo ""

  # Schritt 0: Prerequisites
  check_prerequisites || return 1

  if [ -z "${HOST}" ]; then
    # mDNS-Scan versuchen
    if command -v avahi-browse >/dev/null 2>&1; then
      echo ""
      info "Suche IORA OS Dev-Geräte im Netzwerk (mDNS)..."
      local devices
      devices="$(timeout 4 avahi-browse -t _iora-dev._tcp -r -p 2>/dev/null | grep '=' | cut -d';' -f7,9 | sort -u || true)"
      if [ -n "$devices" ]; then
        echo ""
        echo -e "  ${BOLD}Gefundene Geräte:${N}"
        local i=1
        declare -a device_list=()
        while IFS= read -r line; do
          local dhost dport
          dhost="${line%;*}"
          dport="${line#*;}"
          echo -e "    ${G}[${i}]${N} ${dhost}:${dport}"
          device_list+=("${dhost}:${dport}")
          ((i++))
        done <<< "$devices"
        echo ""
        read -r -p "  Gerät wählen [1-${#device_list[@]}] oder IP eingeben: " choice
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] 2>/dev/null && [ "$choice" -le "${#device_list[@]}" ]; then
          HOST="${device_list[$((choice-1))]}"
        else
          HOST="$choice"
        fi
      fi
    fi

    if [ -z "${HOST}" ]; then
      read -r -p "  Device IP/Hostname [Port 8101]: " HOST
    fi
  fi

  if [ -z "${HOST}" ]; then
    error "Kein Device angegeben"
    return 1
  fi

  # Device kontaktieren
  echo ""
  info "Kontaktiere ${HOST}..."
  local status_resp
  status_resp="$(check_device)" || {
    warn "Device nicht erreichbar – trotzdem fortfahren? (y/n)"
    read -r ans
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] || return 1
  }

  if [ -n "$status_resp" ]; then
    local dev_build dev_hostname
    dev_build="$(echo "$status_resp" | jq -r '.build // "?"')"
    dev_hostname="$(echo "$status_resp" | jq -r '.hostname // "?"')"
    echo -e "  Device: ${G}${dev_hostname}${N} (Build: ${C}${dev_build}${N})"
  fi

  # Auth
  auth_device || return 1

  echo ""
  echo -e "  Lokaler Stand: ${C}$(get_local_version)${N}"
  local last_build
  last_build="$(get_last_build_version)"
  if [ -n "$last_build" ]; then
    echo -e "  Letzter Build: ${C}${last_build}${N}"
  fi

  # Änderungen ermitteln
  local changed
  read -ra changed <<< "$(get_changed_services "$last_build")"

  if [ ${#changed[@]} -eq 0 ]; then
    success "Keine Änderungen seit letztem Build (${last_build})"
    echo ""
    read -r -p "  Trotzdem alle Services bauen? (y/n): " ans
    if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
      changed=("${IORA_SERVICES[@]}")
    else
      return 0
    fi
  else
    echo ""
    echo -e "  ${BOLD}Geänderte Services (${#changed[@]}):${N}"
    for svc in "${changed[@]}"; do
      echo -e "    ${Y}→${N} ${svc}"
    done
    echo ""
    read -r -p "  Fortfahren? (y/n/list/select): " ans
    case "$ans" in
      list|l|L)
        for svc in "${IORA_SERVICES[@]}"; do
          if [[ " ${changed[*]} " == *" ${svc} "* ]]; then
            echo -e "    ${Y}[CHANGED]${N} ${svc}"
          else
            echo -e "    ${G}[   OK  ]${N} ${svc}"
          fi
        done
        echo ""
        read -r -p "  Fortfahren mit geänderten Services? (y/n): " ans2
        [ "$ans2" = "y" ] || [ "$ans2" = "Y" ] || return 0
        ;;
      select|s|S)
        echo ""
        echo -e "  ${BOLD}Verfügbare Services:${N}"
        local i=1
        declare -a svc_select
        for svc in "${IORA_SERVICES[@]}"; do
          local marker=" "
          [[ " ${changed[*]} " == *" ${svc} "* ]] && marker="${Y}*${N}"
          echo -e "    ${marker} [${i}] ${svc}"
          svc_select+=("$svc")
          ((i++))
        done
        echo ""
        read -r -p "  Nummern (space-separated) oder 'all': " selection
        if [ "$selection" = "all" ]; then
          changed=("${IORA_SERVICES[@]}")
        else
          changed=()
          for num in $selection; do
            if [ "$num" -ge 1 ] 2>/dev/null && [ "$num" -le "${#svc_select[@]}" ]; then
              changed+=("${svc_select[$((num-1))]}")
            fi
          done
        fi
        ;;
      y|Y|yes) ;;
      *) return 0 ;;
    esac
  fi

  SELECTED_SERVICES=("${changed[@]}")
  MODE="build"
}

# ── Hauptfunktionen ──────────────────────────────────────────────────────────
cmd_status() {
  load_config
  check_prerequisites || return 1

  if [ -z "${HOST}" ]; then
    error "Kein Device konfiguriert. Nutze --host <IP> oder ./devup.sh --save"
    return 1
  fi

  echo ""
  echo -e "${BOLD}═══ IORA Dev Status ═══${N}"
  echo ""

  # Lokale Version
  local local_ver
  local_ver="$(get_local_version)"
  echo -e "  Lokaler Commit: ${C}${local_ver}${N}"

  local last_build
  last_build="$(get_last_build_version)"
  echo -e "  Letzter Build:  ${C}${last_build:-keiner}${N}"

  # Device Version
  echo ""
  echo -e "  ${BOLD}Device:${N} ${HOST}"
  local status_resp
  if status_resp="$(check_device 2>/dev/null)"; then
    local dev_build dev_hostname dev_uptime
    dev_build="$(echo "$status_resp" | jq -r '.build // "?"')"
    dev_hostname="$(echo "$status_resp" | jq -r '.hostname // "?"')"
    echo -e "    Hostname: ${G}${dev_hostname}${N}"
    echo -e "    Build:    ${G}${dev_build}${N}"

    # Capabilities
    local caps
    caps="$(echo "$status_resp" | jq -r '.capabilities[]?' 2>/dev/null)"
    if echo "$caps" | grep -q "binary.replace"; then
      echo -e "    Bridge:   ${G}Hot-Reload bereit${N}"
    else
      echo -e "    Bridge:   ${Y}Hot-Reload eingeschränkt${N}"
    fi

    # Services via Bridge
    echo ""
    echo -e "  ${BOLD}Services (live):${N}"
    local svc_resp
    svc_resp="$(device_api GET "/dev/services" "" 2>/dev/null || true)"
    if [ -n "$svc_resp" ] && echo "$svc_resp" | jq -e '.services' >/dev/null 2>&1; then
      echo "$svc_resp" | jq -r '.services | to_entries[] | "    \(.key): \(.value.status // "unknown")"'
    else
      echo "    (nicht verfügbar – iora-core läuft ggf. nicht)"
    fi
  fi

  # Änderungen
  if [ -n "$last_build" ]; then
    echo ""
    echo -e "  ${BOLD}Änderungen seit letztem Build:${N}"
    local changed
    read -ra changed <<< "$(get_changed_services "$last_build")"
    if [ ${#changed[@]} -eq 0 ]; then
      echo -e "    ${G}Keine Änderungen${N}"
    else
      for svc in "${changed[@]}"; do
        echo -e "    ${Y}→${N} ${svc}"
      done
    fi
  fi
  echo ""
}

cmd_list() {
  load_config
  local last_build
  last_build="$(get_last_build_version)"
  local changed=()
  if [ -n "$last_build" ]; then
    read -ra changed <<< "$(get_changed_services "$last_build")"
  fi

  echo ""
  echo -e "${BOLD}IORA Services:${N}"
  printf "  %-30s %-10s %s\n" "SERVICE" "STATUS" "TARGET"
  printf "  %-30s %-10s %s\n" "───────" "──────" "──────"
  for entry in "${IORA_BINARY_PATHS[@]}"; do
    local svc="${entry%%:*}" bin="${entry##*:}"
    local stat="OK"
    if [[ " ${changed[*]} " == *" ${svc} "* ]]; then
      stat="${Y}CHANGED${N}"
    fi
    printf "  %-30s %-10b %s\n" "$svc" "$stat" "$bin"
  done
  echo ""

  if [ -n "${HOST}" ]; then
    echo -e "  Device: ${C}${HOST}${N}"
  else
    echo -e "  ${Y}Kein Device konfiguriert${N}"
  fi
  echo ""
}

cmd_build_and_deploy() {
  check_prerequisites || return 1

  if [ -z "${HOST}" ]; then
    error "Kein Device konfiguriert. Nutze --host <IP>"
    return 1
  fi

  # Device kontaktieren
  local status_resp
  status_resp="$(check_device 2>/dev/null)" || {
    error "Device ${HOST} nicht erreichbar"
    return 1
  }

  local dev_build dev_hostname
  dev_build="$(echo "$status_resp" | jq -r '.build // "?"')"
  dev_hostname="$(echo "$status_resp" | jq -r '.hostname // "?"')"
  log "Device: ${dev_hostname} (Build: ${dev_build})"

  # Auth
  auth_device || return 1

  # Capabilities check
  local caps
  caps="$(get_device_capabilities)"
  if ! echo "$caps" | grep -q "binary.replace"; then
    error "Device unterstützt kein binary.replace – iora-dev-bridge updaten!"
    return 1
  fi

  local local_ver last_build
  local_ver="$(get_local_version)"
  last_build="$(get_last_build_version)"
  log "Lokal: ${local_ver}  |  Letzter Build: ${last_build:-keiner}"

  # Services zum Bauen bestimmen
  local to_build=()
  if [ ${#SELECTED_SERVICES[@]} -gt 0 ]; then
    to_build=("${SELECTED_SERVICES[@]}")
  elif [ "$MODE" = "all" ]; then
    to_build=("${IORA_SERVICES[@]}")
  else
    read -ra to_build <<< "$(get_changed_services "$last_build")"
  fi

  if [ ${#to_build[@]} -eq 0 ]; then
    success "Keine Änderungen – nichts zu tun!"
    return 0
  fi

  echo ""
  log "Baue ${#to_build[@]} Service(s): ${to_build[*]}"
  echo ""

  if [ "$DRY_RUN" = true ]; then
    echo -e "  ${Y}DRY-RUN – keine Änderungen werden durchgeführt${N}"
    for svc in "${to_build[@]}"; do
      echo -e "  → ${svc} würde gebaut und deployed werden"
    done
    return 0
  fi

  # Build Phase
  local failed=()
  local built=()
  mkdir -p "${BUILD_LOG_DIR}"

  for svc in "${to_build[@]}"; do
    if docker_build_service "$svc"; then
      built+=("$svc")
    else
      failed+=("$svc")
    fi
    echo ""
  done

  if [ ${#built[@]} -eq 0 ]; then
    error "Kein Service erfolgreich gebaut!"
    return 1
  fi

  # Deploy Phase
  log "Deploye ${#built[@]} Service(s)..."
  local deploy_failed=()

  for svc in "${built[@]}"; do
    local bin_path="${BUILD_LOG_DIR}/${svc}"
    if [ ! -f "$bin_path" ]; then
      error "Binary ${svc} nicht gefunden unter ${bin_path}"
      deploy_failed+=("$svc")
      continue
    fi

    if [ "$NO_RESTART" = true ]; then
      # Upload ohne Restart
      local sha
      sha="$(sha256sum "$bin_path" | cut -d' ' -f1)"
      info "Uploading ${svc} (ohne Restart)..."
      curl -s -S --connect-timeout 10 --max-time 120 \
        -H "X-IORA-Dev-Token: ${TOKEN}" \
        -F "target=/usr/bin/${svc}" \
        -F "sha256=${sha}" \
        -F "file=@${bin_path};filename=${svc}" \
        "$(normalize_url "${HOST}")/dev/replace-binary" >/dev/null 2>&1 || {
          error "Upload ${svc} fehlgeschlagen"
          deploy_failed+=("$svc")
          continue
        }
      success "${svc} hochgeladen (kein Restart)"
    else
      replace_binary "$svc" "$bin_path" "$svc" || deploy_failed+=("$svc")
    fi
  done

  # Zusammenfassung
  echo ""
  echo -e "${BOLD}═══ Zusammenfassung ═══${N}"
  echo -e "  Gebaut:    ${#built[@]}"
  echo -e "  Build-Fehler:  ${#failed[@]}"
  echo -e "  Deploy-Fehler: ${#deploy_failed[@]}"

  if [ ${#failed[@]} -gt 0 ]; then
    echo -e "  ${R}Build-Fehler:${N} ${failed[*]}"
    echo -e "  Logs: ${BUILD_LOG_DIR}/<service>.log"
  fi
  if [ ${#deploy_failed[@]} -gt 0 ]; then
    echo -e "  ${R}Deploy-Fehler:${N} ${deploy_failed[*]}"
  fi

  # Build-Version speichern
  if [ ${#deploy_failed[@]} -eq 0 ] && [ ${#failed[@]} -eq 0 ]; then
    save_build_version
    success "Build-Marker aktualisiert: $(get_last_build_version)"
  fi

  return 0
}

# ── Argument Parsing ─────────────────────────────────────────────────────────
parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --host) HOST="$2"; shift 2 ;;
      --token) TOKEN="$2"; shift 2 ;;
      --service|-s) SELECTED_SERVICES+=("$2"); shift 2 ;;
      --all|-a) MODE="all"; shift ;;
      --no-restart|-n) NO_RESTART=true; shift ;;
      --dry-run) DRY_RUN=true; shift ;;
      --status) MODE="status"; shift ;;
      --list|-l) MODE="list"; shift ;;
      --save) MODE="save"; shift ;;
      --jobs|-j) JOBS="$2"; shift 2 ;;
      --help|-h) usage ;;
      *) error "Unbekannte Option: $1"; usage ;;
    esac
  done
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  parse_args "$@"

  case "$MODE" in
    status)
      cmd_status
      ;;
    list)
      cmd_list
      ;;
    save)
      load_config
      if [ -z "${HOST}" ]; then
        read -r -p "Device IP/Hostname: " HOST
      fi
      if [ -z "${TOKEN}" ]; then
        read -r -p "Dev-Token: " TOKEN
      fi
      save_config
      ;;
    *)
      # Auto/Interactive/Build-Modus
      load_config
      if [ -z "${HOST}" ] && [ ${#SELECTED_SERVICES[@]} -eq 0 ] && [ "$DRY_RUN" != true ]; then
        interactive_setup || exit 1
      fi
      cmd_build_and_deploy
      ;;
  esac
}

main "$@"
