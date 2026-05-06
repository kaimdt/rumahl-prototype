#!/usr/bin/env bash
# ============================================================================
# devup.sh – IORA OS Dev Inkrementelles Update-Tool mit TUI
# ============================================================================
# Benötigt bash >= 4.0 (associative arrays). Auf Ubuntu/Debian Standard.
# macOS: brew install bash && /usr/local/bin/bash devup.sh
# ============================================================================
[ -z "${BASH_VERSINFO[0]:-}" ] || [ "${BASH_VERSINFO[0]}" -lt 4 ] && {
  echo "FEHLER: devup.sh benötigt bash >= 4.0 (aktuell: ${BASH_VERSION:-unbekannt})" >&2
  echo "  Ubuntu/Debian: bereits installiert" >&2
  echo "  macOS: brew install bash" >&2
  exit 1
}
set -euo pipefail

# ── Metadaten ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
DOCKERFILE="${BACKEND_DIR}/Dockerfile"
CONFIG_DIR="${HOME}/.config/iora-devup"
CONFIG_FILE="${CONFIG_DIR}/config"
LAST_BUILD_FILE="${CONFIG_DIR}/lastbuild"
BUILD_LOG_DIR="/tmp/iora-devup-logs"

# ── Farben ───────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; B='\033[0;34m'; C='\033[0;36m'
  N='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'
else
  R=''; G=''; Y=''; B=''; C=''; N=''; BOLD=''; DIM=''
fi

# ═══════════════════════════════════════════════════════════════════════════════
# SERVICE REGISTRY – Single Source of Truth für alle IORA-Services
# ═══════════════════════════════════════════════════════════════════════════════
# Definiert: Name, Binary-Pfad auf Device, Port, Systemd-After-Deps,
# Restart-Priorität, ist der Service kritisch?
declare -A SVC_BIN SVC_PORT SVC_AFTER SVC_PRIO SVC_CRITICAL SVC_DESC SVC_ENV

_register() {
  local n="$1" bin="$2" port="$3" after="$4" prio="$5" crit="$6" desc="$7" env="$8"
  SVC_BIN["$n"]="$bin"; SVC_PORT["$n"]="$port"; SVC_AFTER["$n"]="$after"
  SVC_PRIO["$n"]="$prio"; SVC_CRITICAL["$n"]="$crit"; SVC_DESC["$n"]="$desc"
  SVC_ENV["$n"]="$env"
}

_register iora-core            "/usr/bin/iora-core"            "8090" ""                                   1 "true"  "Core Orchestrator"              ""
_register iora-home            "/usr/bin/iora-home"            "8126" "iora-core.service"                  2 "true"  "Home Dashboard"                 ""
_register iora-control         "/usr/bin/iora-control"         "8091" "iora-core iora-home"                3 "true"  "Control Center"                 ""
_register iora-assist          "/usr/bin/iora-assist"          "8092" "iora-core"                          4 "false" "AI Assistant"                   ""
_register iora-secrets         "/usr/bin/iora-secrets"         "8093" ""                                   1 "true"  "Secrets Manager"                ""
_register iora-watchdog        "/usr/bin/iora-watchdog"        "8094" "iora-core"                          1 "true"  "Watchdog (Security-Critical)"   ""
_register iora-security        "/usr/bin/iora-security"        "8095" "iora-watchdog"                      3 "true"  "Security Monitor"               ""
_register iora-gateway         "/usr/bin/iora-gateway"         "8096" ""                                   5 "false" "External Gateway"               ""
_register iora-supervisor      "/usr/bin/iora-supervisor"      "8097" "iora-core iora-secrets docker"      2 "true"  "Docker Gatekeeper (Supervisor)"  ""
_register iora-api             "/usr/bin/iora-api"             "8099" "iora-core iora-home"                4 "false" "Extended API (GraphQL/WebDAV)"   ""
_register iora-appstore        "/usr/bin/iora-appstore"        "8098" "iora-core iora-supervisor"          5 "false" "App Store"                      ""
_register iora-backup          "/usr/bin/iora-backup"          "8100" "iora-core"                          6 "false" "Backup & Restore"               ""
_register iora-connector       "/usr/bin/iora-connector"       "8088" "iora-core"                          5 "false" "Datacenter Connector"           ""
_register iora-dev-bridge      "/usr/bin/iora-dev-bridge"      "8101" "iora-core iora-supervisor"          2 "true"  "Developer Bridge (Self-Update)"  ""
_register iora-domain-validator "/usr/bin/iora-domain-validator" "8102" "iora-core"                        6 "false" "Domain Validator (ACME/DNS)"     ""
_register iora-files           "/usr/bin/iora-files"           "8103" "iora-core"                          5 "false" "File Service"                   ""
_register iora-network-monitor "/usr/bin/iora-network-monitor" "8104" "iora-core"                          6 "false" "Network Monitor"                ""
_register iora-nginx           "/usr/bin/iora-nginx"           "8089" ""                                   5 "false" "Nginx Config Manager"           ""
_register iora-resource-manager "/usr/bin/iora-resource-manager" "8105" "iora-core"                         6 "false" "Resource Manager"               ""
_register iora-updater         "/usr/bin/iora-updater"         "8106" "iora-core"                          6 "false" "System Updater"                 ""

ALL_SERVICES=()
for _svc in "${!SVC_BIN[@]}"; do ALL_SERVICES+=("$_svc"); done
# Sortiere nach Priorität
IFS=$'\n' ALL_SERVICES=($(sort -t$'\t' -k1,1 <<<"${ALL_SERVICES[*]}")); unset IFS

svc_list() { printf '%s\n' "${ALL_SERVICES[@]}"; }

# ═══════════════════════════════════════════════════════════════════════════════
#  HELPER
# ═══════════════════════════════════════════════════════════════════════════════
log()     { echo -e "${B}[devup]${N} $*"; }
success() { echo -e "${G}[  OK ]${N} $*"; }
warn()    { echo -e "${Y}[ WARN]${N} $*"; }
error()   { echo -e "${R}[ERROR]${N} $*"; }
info()    { echo -e "${C}[ INFO]${N} $*"; }
is_json() { echo "$1" | jq -e . >/dev/null 2>&1; }

check_prereq() {
  local m=()
  for t in docker curl jq sha256sum git; do
    command -v "$t" >/dev/null 2>&1 || m+=("$t")
  done
  if [ ${#m[@]} -gt 0 ]; then
    error "Fehlende Tools: ${m[*]}"
    error "Installiere: sudo apt-get install -y ${m[*]}"
    return 1
  fi
}

normalize_url() {
  local h="${1%/}"
  [[ "$h" =~ ^https?:// ]] || { [[ "$h" =~ :[0-9]+$ ]] || h="${h}:8101"; h="http://${h}"; }
  echo "$h"
}

_device_call() {
  local method="$1" ep="$2" data="${3:-}" tmp http_code
  tmp="$(mktemp /tmp/iora-devup.XXXXXX)"
  local copts=(-s --connect-timeout 5 --max-time 30 -o "$tmp" -w '%{http_code}')
  [ -n "${TOKEN:-}" ] && copts+=(-H "X-IORA-Dev-Token: ${TOKEN}")
  local url="$(normalize_url "${HOST}")${ep}"
  if [ -n "$data" ]; then
    http_code=$(curl "${copts[@]}" -X "$method" -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null) || true
  else
    http_code=$(curl "${copts[@]}" -X "$method" "$url" 2>/dev/null) || true
  fi
  [[ "$http_code" =~ ^2 ]] || echo "[HTTP ${http_code}]" >&2
  cat "$tmp" 2>/dev/null; rm -f "$tmp"
}

# Auth: Login gegen iora-home via /dev/auth, oder statischen Token nutzen
# Gibt 0 zurück wenn auth ok, sonst 1.
ensure_auth() {
  local base_url; base_url="$(normalize_url "${HOST}")"

  # 0. Quick-Check: Ist das Device überhaupt erreichbar?
  local health_check health_url="${base_url}/dev/health"
  health_check="$(curl -s --connect-timeout 3 --max-time 5 "$health_url" 2>/dev/null || true)"
  if ! is_json "$health_check"; then
    error "Device ${base_url} nicht erreichbar (keine JSON-Antwort auf /dev/health)"
    error "→ Prüfe: curl -s ${health_url}"
    error "→ Läuft iora-dev-bridge? systemctl status iora-dev-bridge"
    error "→ IP korrekt? Port 8101 offen?"
    return 1
  fi

  # 1. Versuche existierenden Token
  if [ -n "${TOKEN:-}" ]; then
    local r; r="$(_device_call GET "/dev/status" "" 2>/dev/null)" || true
    if is_json "$r" && echo "$r" | jq -e '.dev_mode == true' >/dev/null 2>&1; then
      info "Token gültig – Device OK"
      return 0
    fi
    warn "Gespeicherter Token ungültig – interaktiver Login nötig"
  fi

  # 2. Interaktiver Login
  echo ""; info "Bitte IORA Dashboard Login (gleiche Daten wie im Webinterface):"
  read -r -p "  Username: " username
  read -r -s -p "  Password: " password; echo ""
  [ -z "$username" ] || [ -z "$password" ] && { error "Username/Passwort benötigt"; return 1; }

  local body; body="$(jq -n --arg u "$username" --arg p "$password" '{username:$u,password:$p}')"
  info "Sende Login an ${base_url}/dev/auth ..."

  # Direkt curl verwenden (nicht _device_call) damit wir HTTP-Codes sauber sehen
  local tmp http_code
  tmp="$(mktemp /tmp/iora-devup-auth.XXXXXX)"
  http_code=$(curl -s --connect-timeout 5 --max-time 10 \
    -X POST -H "Content-Type: application/json" \
    -d "$body" -o "$tmp" -w '%{http_code}' \
    "${base_url}/dev/auth" 2>/dev/null) || true

  local resp; resp="$(cat "$tmp" 2>/dev/null)"; rm -f "$tmp"

  if [ -z "$resp" ]; then
    error "Keine Antwort von /dev/auth (HTTP ${http_code:-?})"
    error "→ Läuft iora-home auf Port 3001 oder 8126?"
    error "→ Die Dev-Bridge fragt iora-home nach der Auth an"
    return 1
  fi

  if ! is_json "$resp"; then
    error "Ungültige Antwort (HTTP ${http_code:-?}): ${resp:0:300}"
    return 1
  fi

  local tok; tok="$(echo "$resp" | jq -r '.token // empty')"
  if [ -n "$tok" ] && [ "$tok" != "null" ]; then
    TOKEN="$tok"
    local method role
    method="$(echo "$resp" | jq -r '.auth_method // "?"')"
    role="$(echo "$resp" | jq -r '.role // "?"')"
    success "Angemeldet als ${username} (${method}, ${role})"
    return 0
  fi

  local err; err="$(echo "$resp" | jq -r '.error // ""')"
  [ -z "$err" ] && err="$(echo "$resp" | jq -r '.message // "Kein Token in Antwort"')"
  error "Auth fehlgeschlagen (HTTP ${http_code:-?}): ${err}"
  info "Tipp: Das sind die gleichen Login-Daten wie im IORA Webinterface"
  if [ "$http_code" = "502" ] || [ "$http_code" = "000" ]; then
    error "→ iora-home scheint nicht zu laufen. Starte: systemctl start iora-home"
  fi
  return 1
}

device_status_json() {
  local r; r="$(_device_call GET "/dev/status" "" 2>/dev/null)" || true
  is_json "$r" && echo "$r" || echo '{"error":"nicht erreichbar"}'
}

# ═══════════════════════════════════════════════════════════════════════════════
#  GIT CHANGE DETECTION
# ═══════════════════════════════════════════════════════════════════════════════
get_local_version() {
  cd "$SCRIPT_DIR"; git rev-parse --short HEAD 2>/dev/null || echo "unknown"
}
get_last_build() { cat "$LAST_BUILD_FILE" 2>/dev/null || echo ""; }
save_last_build() { mkdir -p "$CONFIG_DIR"; get_local_version > "$LAST_BUILD_FILE"; }

get_changed_svcs() {
  local last="$1"
  [ -z "$last" ] && { svc_list; return; }
  cd "$SCRIPT_DIR"
  git cat-file -e "$last" 2>/dev/null || { svc_list; return; }
  local c=()
  while IFS= read -r svc; do
    [ -z "$svc" ] && continue
    if ! git diff --quiet "$last"..HEAD -- "backend/${svc}/" "backend/iora-shared/" \
      "backend/Cargo.toml" "backend/Cargo.lock" "backend/Dockerfile" 2>/dev/null; then
      c+=("$svc")
    fi
  done <<< "$(svc_list)"
  printf '%s\n' "${c[@]}"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  DOCKER BUILD
# ═══════════════════════════════════════════════════════════════════════════════
detect_target_arch() {
  local t; t="$(cat "${SCRIPT_DIR}/.setup-target" 2>/dev/null || echo pc)"
  case "$t" in rpi3|rpi4|rpi5|generic-arm64) echo "aarch64" ;; *) uname -m ;; esac
}

docker_build_one() {
  local svc="$1" host_arch target_arch logfile bin_path
  host_arch="$(uname -m)"
  target_arch="$(detect_target_arch 2>/dev/null || uname -m)"
  logfile="${BUILD_LOG_DIR}/${svc}.log"; mkdir -p "$BUILD_LOG_DIR"
  bin_path="${BUILD_LOG_DIR}/${svc}"
  echo "==> $(date) ${svc} (host=${host_arch} target=${target_arch})" > "$logfile"

  local tag="iora-devup-${svc}:$(date +%s)"

  # ARM-Cross: Docker mit QEMU-Emulation
  if [ "$host_arch" = "x86_64" ] && [ "$target_arch" = "aarch64" ]; then
    info "  ${svc}: Docker x86_64→aarch64 (QEMU)..."
    # QEMU registrieren falls nötig
    docker run --rm --privileged tonistiigi/binfmt:latest --install arm64 >> "$logfile" 2>&1 || true

    cat > "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}" <<DOCKEREOF
FROM rust:1.90
RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential pkg-config libssl-dev libpq-dev perl cmake git curl ca-certificates \\
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY . .
ARG SVC
RUN cargo build --release -p \${SVC} && mkdir -p /out && \\
    for d in target/release target/aarch64-unknown-linux-gnu/release; do \\
      [ -x "\$d/\${SVC}" ] && cp "\$d/\${SVC}" "/out/\${SVC}" && break; done
DOCKEREOF
    docker build --platform linux/arm64 --build-arg "SVC=${svc}" -t "$tag" \
      -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}" "$BACKEND_DIR" >> "$logfile" 2>&1 || {
      error "  ${svc}: Build fehlgeschlagen"; tail -20 "$logfile" | while read -r l; do echo "    ${R}${l}${N}"; done
      docker image rm -f "$tag" >/dev/null 2>&1; rm -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}"; return 1
    }
    rm -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}"
  else
    # Native via Dockerfile (Alpine/musl, glibc-sicher)
    info "  ${svc}: Docker (Alpine/musl)..."
    DOCKER_BUILDKIT=1 docker build --progress=plain --target builder -t "$tag" \
      -f "$DOCKERFILE" "$BACKEND_DIR" >> "$logfile" 2>&1 || {
      error "  ${svc}: Build fehlgeschlagen"; tail -20 "$logfile" | while read -r l; do echo "    ${R}${l}${N}"; done
      docker image rm -f "$tag" >/dev/null 2>&1; return 1
    }
  fi

  # Extraktion
  docker create --name "iora-devup-ext-${svc}" "$tag" >/dev/null 2>&1 || {
    error "  ${svc}: Container-Erstellung fehlgeschlagen"; docker image rm -f "$tag" >/dev/null 2>&1; return 1
  }
  local cb=""
  for cand in "/out/${svc}" "/app/backend/target/release/${svc}" \
    "/app/backend/target/aarch64-unknown-linux-gnu/release/${svc}" \
    "/app/backend/target/x86_64-unknown-linux-musl/release/${svc}"; do
    docker exec "iora-devup-ext-${svc}" test -f "$cand" 2>/dev/null && { cb="$cand"; break; }
  done
  [ -z "$cb" ] && {
    error "  ${svc}: Binary nicht im Container gefunden"
    docker exec "iora-devup-ext-${svc}" find / -name "${svc}" -type f 2>/dev/null | head -3
    docker rm -f "iora-devup-ext-${svc}" >/dev/null 2>&1; docker image rm -f "$tag" >/dev/null 2>&1; return 1
  }
  docker cp "iora-devup-ext-${svc}:${cb}" "$bin_path" 2>/dev/null
  docker rm -f "iora-devup-ext-${svc}" >/dev/null 2>&1; docker image rm -f "$tag" >/dev/null 2>&1
  [ ! -f "$bin_path" ] || [ ! -s "$bin_path" ] && { error "  ${svc}: Binary-Extraktion fehlgeschlagen"; return 1;
}
  chmod +x "$bin_path"
  local sz ft; sz="$(du -h "$bin_path" | cut -f1)"; ft="$(file "$bin_path" 2>/dev/null | cut -d: -f2-)"
  success "  ${svc} (${sz}) [${ft## }]"
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  DEPLOY + RESTART mit Health-Check
# ═══════════════════════════════════════════════════════════════════════════════
deploy_one() {
  local svc="$1" no_restart="${2:-false}" bin_path="${BUILD_LOG_DIR}/${svc}"
  local target="${SVC_BIN[$svc]:-/usr/bin/${svc}}" unit="${svc}.service"

  [ ! -f "$bin_path" ] && { error "  ${svc}: Binary fehlt: ${bin_path}"; return 1; }

  local sha; sha="$(sha256sum "$bin_path" | cut -d' ' -f1)"
  local sz; sz="$(du -h "$bin_path" | cut -f1)"
  info "  Upload ${svc} (${sz}, sha256=${sha:0:12}...) → ${target}"

  local tmp; tmp="$(mktemp /tmp/iora-devup-upload.XXXXXX)"
  local http_code
  http_code=$(curl -s --connect-timeout 10 --max-time 120 \
    -H "X-IORA-Dev-Token: ${TOKEN}" \
    -F "target=${target}" -F "sha256=${sha}" -F "unit=${unit}" \
    -F "file=@${bin_path};filename=${svc}" \
    -o "$tmp" -w '%{http_code}' \
    "$(normalize_url "${HOST}")/dev/replace-binary" 2>/dev/null) || true

  local resp; resp="$(cat "$tmp" 2>/dev/null)"; rm -f "$tmp"

  if ! is_json "$resp"; then
    error "  ${svc}: Keine JSON-Antwort (HTTP ${http_code})"; return 1
  fi

  local ok; ok="$(echo "$resp" | jq -r '.restart.ok // false')"
  if [ "$ok" != "true" ]; then
    local code; code="$(echo "$resp" | jq -r '.restart.code // "?"')"
    local stderr; stderr="$(echo "$resp" | jq -r '.restart.stderr // ""' | head -3)"
    error "  ${svc}: Restart fehlgeschlagen (exit=${code}): ${stderr}"
    # Trotzdem manuell versuchen
    _device_call POST "/dev/service/${svc}/restart" "" >/dev/null 2>&1 || true
    return 1
  fi

  if [ "$no_restart" = "true" ]; then
    success "  ${svc}: hochgeladen (kein Restart)"
    return 0
  fi

  # ── Health Check: Warte bis Service wieder "active" ist ────────────────────
  info "  ${svc}: Warte auf healthy-Status..."
  local waited=0 max_wait=30
  while [ $waited -lt $max_wait ]; do
    local svc_json; svc_json="$(_device_call GET "/dev/services" "" 2>/dev/null)" || true
    if is_json "$svc_json"; then
      local status; status="$(echo "$svc_json" | jq -r --arg u "$unit" '.services[$u].status // "unknown"')"
      if [ "$status" = "healthy" ] || [ "$status" = "active" ]; then
        success "  ${svc}: ${status} (nach ${waited}s)"
        return 0
      elif [ "$status" = "failed" ]; then
        error "  ${svc}: Service im Status 'failed' – Logs prüfen"
        return 1
      fi
    fi
    sleep 2; waited=$((waited + 2))
  done
  warn "  ${svc}: Kein Healthy-Status innerhalb ${max_wait}s – Service könnte noch starten"
  return 0
}

# Manueller Restart ohne vorherigen Build (für abhängige Services)
restart_dependents() {
  local svc="$1"
  # Services finden, die von diesem Service abhängen
  local deps=()
  while IFS= read -r s; do
    [ -z "$s" ] && continue
    local after="${SVC_AFTER[$s]:-}"
    if [[ " $after " == *" ${svc} "* ]]; then
      deps+=("$s")
    fi
  done <<< "$(svc_list)"

  for dep in "${deps[@]}"; do
    warn "  → Restarte abhängigen Service: ${dep}"
    _device_call POST "/dev/service/${dep}/restart" "" >/dev/null 2>&1 || true
    sleep 1
  done
}

# ═══════════════════════════════════════════════════════════════════════════════
#  SELF-UPDATE: iora-dev-bridge selbst updaten
# ═══════════════════════════════════════════════════════════════════════════════
self_update_bridge() {
  echo ""
  echo -e "${BOLD}═══ iora-dev-bridge Self-Update ═══${N}"
  echo ""

  # 1. Bridge bauen
  if ! docker_build_one "iora-dev-bridge"; then
    error "Build der iora-dev-bridge fehlgeschlagen"; return 1
  fi

  local bin_path="${BUILD_LOG_DIR}/iora-dev-bridge"
  local sha; sha="$(sha256sum "$bin_path" | cut -d' ' -f1)"
  local sz; sz="$(du -h "$bin_path" | cut -f1)"

  echo ""
  warn "⚠  ACHTUNG: Das Update ersetzt die laufende Dev-Bridge."
  warn "   Die Verbindung wird kurz unterbrochen und automatisch wiederhergestellt."
  echo ""
  read -r -p "  Fortfahren? (y/N): " ans
  [ "$ans" != "y" ] && [ "$ans" != "Y" ] && { info "Abgebrochen."; return 0; }

  info "Upload iora-dev-bridge ($sz, sha256=${sha:0:12}...)"

  local tmp; tmp="$(mktemp /tmp/iora-devup-self.XXXXXX)"
  local http_code
  http_code=$(curl -s --connect-timeout 10 --max-time 120 \
    -H "X-IORA-Dev-Token: ${TOKEN}" \
    -F "target=/usr/bin/iora-dev-bridge" -F "sha256=${sha}" \
    -F "unit=iora-dev-bridge.service" \
    -F "file=@${bin_path};filename=iora-dev-bridge" \
    -o "$tmp" -w '%{http_code}' \
    "$(normalize_url "${HOST}")/dev/replace-binary" 2>/dev/null) || true

  local resp; resp="$(cat "$tmp" 2>/dev/null)"; rm -f "$tmp"

  # Die Bridge wurde neugestartet – Verbindung ist jetzt weg
  echo ""
  info "Bridge wird neugestartet – warte auf Wiederverbindung..."

  local waited=0 max_wait=20
  while [ $waited -lt $max_wait ]; do
    local r; r="$(_device_call GET "/dev/health" "" 2>/dev/null)" || true
    if is_json "$r" && echo "$r" | jq -e '.ok == true' >/dev/null 2>&1; then
      success "Bridge ist wieder online (nach ${waited}s)!"
      local new_build; new_build="$(echo "$r" | jq -r '.build // "?"')"
      info "Bridge Build: ${new_build}"
      return 0
    fi
    echo -n "."
    sleep 2; waited=$((waited + 2))
  done

  warn "Bridge antwortet nicht nach ${max_wait}s – prüfe manuell:"
  warn "  curl http://${HOST}:8101/dev/health"
  return 1
}

# ═══════════════════════════════════════════════════════════════════════════════
#  TUI (Whiptail-basiert)
# ═══════════════════════════════════════════════════════════════════════════════
TUI_HEIGHT=28; TUI_WIDTH=90

tui_main() {
  check_prereq || return 1

  # Host konfigurieren falls nötig
  if [ -z "${HOST:-}" ]; then
    load_config
    if [ -z "${HOST:-}" ]; then
      HOST=$(whiptail --title "IORA OS Dev – Verbindung" \
        --inputbox "IP/Hostname des IORA OS Dev-Geräts (Port 8101):" \
        10 60 "192.168." 3>&1 1>&2 2>&3) || { echo "Abgebrochen."; exit 0; }
      [ -z "$HOST" ] && { echo "Kein Host – Abbruch."; exit 0; }
    fi
  fi

  # Auth
  info "Verbinde mit ${HOST}..."
  if ! ensure_auth; then
    whiptail --title "Fehler" --msgbox "Authentifizierung fehlgeschlagen.\n\nPrüfe:\n- Läuft iora-home (Port 3001/8126)?\n- Korrekte Login-Daten?" 10 50
    exit 1
  fi

  # Device Status
  local dev_json; dev_json="$(device_status_json)"
  local dev_build dev_host
  dev_build="$(echo "$dev_json" | jq -r '.build // "?"')"
  dev_host="$(echo "$dev_json" | jq -r '.hostname // "?"')"
  local local_ver; local_ver="$(get_local_version)"

  # Hauptmenü-Schleife
  while true; do
    local changed=()
    local last; last="$(get_last_build)"
    if [ -n "$last" ]; then
      while IFS= read -r s; do [ -n "$s" ] && changed+=("$s"); done <<< "$(get_changed_svcs "$last")"
    fi

    local menu_header="Device: ${dev_host}  |  Build: ${dev_build}\nLokal:  ${local_ver}  |  Letzter Deploy: ${last:-keiner}\nGeändert: ${#changed[@]} Services\n\nAktion wählen:"

    local choice
    choice=$(whiptail --title "IORA OS Dev – devup.sh" \
      --menu "$menu_header" $TUI_HEIGHT $TUI_WIDTH 12 \
      "deploy"     "Geänderte Services bauen & deployen  (${#changed[@]} Services)" \
      "select"     "Bestimmte Services auswählen & deployen" \
      "all"        "ALLE Services neu bauen & deployen" \
      "status"     "Device-Status & Service-Übersicht anzeigen" \
      "selfupdate" "iora-dev-bridge selbst aktualisieren" \
      "restart"    "Einzelnen Service neustarten (ohne Build)" \
      "logs"       "Service-Logs anzeigen" \
      "config"     "Device-Adresse & Token konfigurieren" \
      "shell"      "Shell verlassen (zum CLI-Modus)" \
      3>&1 1>&2 2>&3) || { echo -e "\n${DIM}Auf Wiedersehen.${N}"; exit 0; }

    case "$choice" in
      deploy) tui_deploy_changed "${changed[@]}" ;;
      select) tui_select_and_deploy ;;
      all)    tui_deploy_all ;;
      status) tui_status "$dev_json" "$last" "${changed[@]}" ;;
      selfupdate) self_update_bridge; read -r -p "Enter für Menü..." _ ;;
      restart) tui_restart_one ;;
      logs)    tui_show_logs ;;
      config)  tui_config ;;
      shell)   echo -e "\n${DIM}Wechsel in CLI-Modus. Nutze --help für Optionen.${N}"; exit 0 ;;
    esac
  done
}

tui_deploy_changed() {
  local changed=("$@")
  if [ ${#changed[@]} -eq 0 ]; then
    whiptail --title "Keine Änderungen" --msgbox "Keine Services haben sich seit dem letzten Deploy geändert.\n\nLetzter Build: $(get_last_build)\n\nNutze 'ALLE Services' um trotzdem zu bauen." 10 60
    return
  fi

  # Zeige Liste der geänderten Services + Confirmation
  local list=""
  for s in "${changed[@]}"; do list+="${s}  (${SVC_DESC[$s]:-?})\n"; done
  whiptail --title "Geänderte Services" --yesno "Folgende ${#changed[@]} Services werden gebaut & deployed:\n\n${list}\nFortfahren?" \
    $((12 + ${#changed[@]})) 70 || return

  build_and_deploy "${changed[@]}"
}

tui_select_and_deploy() {
  local args=()
  while IFS= read -r s; do
    [ -z "$s" ] && continue
    local last; last="$(get_last_build)"
    local is_changed="OFF"
    if [ -n "$last" ]; then
      cd "$SCRIPT_DIR"
      if ! git diff --quiet "$last"..HEAD -- "backend/${s}/" "backend/iora-shared/" \
        "backend/Cargo.toml" "backend/Cargo.lock" "backend/Dockerfile" 2>/dev/null; then
        is_changed="ON"
      fi
    fi
    args+=("$s" "${SVC_DESC[$s]:-?}" "$is_changed")
  done <<< "$(svc_list)"

  local selected
  selected=$(whiptail --title "Services auswählen" --checklist \
    "Wähle die zu deployenden Services (CHANGED = vorausgewählt):" \
    $TUI_HEIGHT $TUI_WIDTH 18 "${args[@]}" 3>&1 1>&2 2>&3) || return

  # Parsen: whiptail gibt quoted strings zurück
  local svcs=()
  for s in $selected; do s="${s//\"/}"; svcs+=("$s"); done
  [ ${#svcs[@]} -eq 0 ] && { info "Keine Services ausgewählt."; return; }
  build_and_deploy "${svcs[@]}"
}

tui_deploy_all() {
  whiptail --title "Alle Services" --yesno \
    "ALLE $(svc_list | wc -l) Services bauen & deployen?\n\nDies kann je nach System 10-30 Minuten dauern." 8 60 || return
  local all=()
  while IFS= read -r s; do [ -n "$s" ] && all+=("$s"); done <<< "$(svc_list)"
  build_and_deploy "${all[@]}"
}

tui_restart_one() {
  local args=()
  while IFS= read -r s; do [ -z "$s" ] && continue; args+=("$s" "${SVC_DESC[$s]:-?}"); done <<< "$(svc_list)"
  local svc
  svc=$(whiptail --title "Service neustarten" --menu "Welchen Service neu starten?" \
    $TUI_HEIGHT $TUI_WIDTH 18 "${args[@]}" 3>&1 1>&2 2>&3) || return
  local resp; resp="$(_device_call POST "/dev/service/${svc}/restart" "" 2>/dev/null)" || true
  local ok; ok="$(echo "$resp" | jq -r '.ok // false' 2>/dev/null)"
  if [ "$ok" = "true" ]; then
    whiptail --title "OK" --msgbox "${svc} wurde neugestartet." 8 40
  else
    whiptail --title "Fehler" --msgbox "Restart fehlgeschlagen:\n$(echo "$resp" | jq -r '.stderr // "?"' 2>/dev/null)" 10 60
  fi
}

tui_show_logs() {
  local args=()
  while IFS= read -r s; do [ -z "$s" ] && continue; args+=("$s" "${SVC_DESC[$s]:-?}"); done <<< "$(svc_list)"
  local svc
  svc=$(whiptail --title "Logs anzeigen" --menu "Welcher Service?" \
    $TUI_HEIGHT $TUI_WIDTH 18 "${args[@]}" 3>&1 1>&2 2>&3) || return
  local resp; resp="$(_device_call POST "/dev/service/${svc}/logs" '{"tail":100}' 2>/dev/null)" || true
  local stdout; stdout="$(echo "$resp" | jq -r '.stdout // "keine Logs"' 2>/dev/null | tail -50)"
  echo "$stdout" | whiptail --title "Logs: ${svc}" --scrolltext --textbox /dev/stdin $TUI_HEIGHT $TUI_WIDTH
}

tui_status() {
  local dev_json="$1" last="$2"; shift 2; local changed=("$@")
  local out=""
  out+="Device:  $(echo "$dev_json" | jq -r '.hostname // "?"')\n"
  out+="Build:   $(echo "$dev_json" | jq -r '.build // "?"')\n"
  out+="Lokal:   $(get_local_version)\n"
  out+="Letzter: ${last:-keiner}\n\n"
  out+="── Services ──\n"

  while IFS= read -r s; do
    [ -z "$s" ] && continue
    local marker="  "
    for c in "${changed[@]}"; do [ "$c" = "$s" ] && marker="${Y}*${N} "; done
    local desc="${SVC_DESC[$s]:-?}"
    out+="$(printf "%-25s %s" "${marker}${s}" "${desc}")\n"
  done <<< "$(svc_list)"

  local svc_json; svc_json="$(_device_call GET "/dev/services" "" 2>/dev/null)" || true
  if is_json "$svc_json"; then
    out+="\n── Live Status ──\n"
    while IFS= read -r s; do
      [ -z "$s" ] && continue
      local st; st="$(echo "$svc_json" | jq -r --arg u "${s}.service" '.services[$u].status // "?"' 2>/dev/null)"
      local icon=" "; case "$st" in healthy|active) icon="${G}●${N}" ;; failed|error) icon="${R}●${N}" ;; *) icon="${Y}○${N}" ;; esac
      out+="$(printf "%-4s %-23s %s\n" "$icon" "$s" "$st")\n"
    done <<< "$(svc_list)"
  fi

  echo -e "$out" | whiptail --title "Status" --scrolltext --textbox /dev/stdin $TUI_HEIGHT $TUI_WIDTH
}

tui_config() {
  local h="${HOST}"; local t="${TOKEN:-}"
  h=$(whiptail --title "Konfiguration" --inputbox "Device IP/Hostname (Port 8101):" 10 60 "$h" 3>&1 1>&2 2>&3) || return
  t=$(whiptail --title "Konfiguration" --inputbox "Dev-Token (leer lassen für interaktiven Login):" 10 60 "$t" 3>&1 1>&2 2>&3) || return
  HOST="$h"; TOKEN="$t"
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_FILE" <<EOF
IORA_DEVUP_HOST="${HOST}"
IORA_DEVUP_TOKEN="${TOKEN}"
EOF
  chmod 600 "$CONFIG_FILE"
  whiptail --title "OK" --msgbox "Konfiguration gespeichert:\n${CONFIG_FILE}" 8 60
}

# ═══════════════════════════════════════════════════════════════════════════════
#  BUILD & DEPLOY Pipeline
# ═══════════════════════════════════════════════════════════════════════════════
build_and_deploy() {
  local svcs=("$@")
  [ ${#svcs[@]} -eq 0 ] && { warn "Keine Services angegeben."; return; }

  echo ""
  echo -e "${BOLD}═══ Build & Deploy: ${#svcs[@]} Services ═══${N}"
  echo ""

  # Sortiere nach Priorität (kritische zuerst)
  IFS=$'\n' svcs=($(for s in "${svcs[@]}"; do printf '%s\t%s\n' "${SVC_PRIO[$s]:-99}" "$s"; done | sort -n | cut -f2)); unset IFS

  # ── Phase 1: Build ──────────────────────────────────────────────────────
  local built=() failed=()
  mkdir -p "$BUILD_LOG_DIR"
  for s in "${svcs[@]}"; do
    docker_build_one "$s" && built+=("$s") || failed+=("$s")
  done

  if [ ${#built[@]} -eq 0 ]; then
    error "Kein Service erfolgreich gebaut!"; return 1
  fi

  echo ""
  echo -e "${BOLD}─── Deploy: ${#built[@]} Services ───${N}"
  if [ ${#failed[@]} -gt 0 ]; then
    warn "Build-Fehler (werden übersprungen): ${failed[*]}"
  fi
  echo ""

  # ── Phase 2: Deploy ─────────────────────────────────────────────────────
  local deployed=() deploy_failed=()
  local dev_bridge_updated=false
  for s in "${built[@]}"; do
    if [ "$s" = "iora-dev-bridge" ]; then
      # Bridge-Update erfordert Spezialbehandlung
      warn "iora-dev-bridge wird als letztes aktualisiert (nach allen anderen Services)"
      dev_bridge_updated=true
      continue
    fi
    deploy_one "$s" && deployed+=("$s") || deploy_failed+=("$s")
  done

  # ── Phase 3: Bridge Self-Update (falls im Build-Set) ────────────────────
  if [ "$dev_bridge_updated" = true ]; then
    echo ""
    warn "═══ iora-dev-bridge Self-Update ═══"
    local bbin="${BUILD_LOG_DIR}/iora-dev-bridge"
    local sha; sha="$(sha256sum "$bbin" | cut -d' ' -f1)"
    local tmp; tmp="$(mktemp /tmp/iora-devup-self2.XXXXXX)"
    curl -s --connect-timeout 10 --max-time 120 \
      -H "X-IORA-Dev-Token: ${TOKEN}" \
      -F "target=/usr/bin/iora-dev-bridge" -F "sha256=${sha}" \
      -F "unit=iora-dev-bridge.service" \
      -F "file=@${bbin};filename=iora-dev-bridge" \
      -o "$tmp" -w '%{http_code}' \
      "$(normalize_url "${HOST}")/dev/replace-binary" >/dev/null 2>&1 || true
    rm -f "$tmp"

    info "Warte auf Bridge-Neustart..."
    local w=0
    while [ $w -lt 20 ]; do
      local r; r="$(_device_call GET "/dev/health" "" 2>/dev/null)" || true
      if is_json "$r" && echo "$r" | jq -e '.ok == true' >/dev/null 2>&1; then
        success "Bridge online nach ${w}s"
        deployed+=("iora-dev-bridge")
        break
      fi
      sleep 2; w=$((w+2))
    done
    [ $w -ge 20 ] && deploy_failed+=("iora-dev-bridge")
  fi

  # ── Phase 4: Abhängige Services neustarten ──────────────────────────────
  echo ""
  info "Prüfe abhängige Services..."
  for s in "${deployed[@]}"; do
    restart_dependents "$s"
  done

  # ── Zusammenfassung ─────────────────────────────────────────────────────
  echo ""
  echo -e "${BOLD}══════ Zusammenfassung ══════${N}"
  echo -e "  Gebaut:      ${G}${#built[@]}${N}"
  echo -e "  Deployed:    ${G}${#deployed[@]}${N}"
  [ ${#failed[@]} -gt 0 ] && echo -e "  Build-Fehler: ${R}${failed[*]}${N}"
  [ ${#deploy_failed[@]} -gt 0 ] && echo -e "  Deploy-Fehler: ${R}${deploy_failed[*]}${N}"

  if [ ${#deploy_failed[@]} -eq 0 ] && [ ${#failed[@]} -eq 0 ]; then
    save_last_build
    success "Build-Marker: $(get_last_build)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  CLI-Modus (wenn Argumente übergeben werden)
# ═══════════════════════════════════════════════════════════════════════════════
load_config() {
  if [ -f "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
    HOST="${IORA_DEVUP_HOST:-${HOST:-}}"
    TOKEN="${IORA_DEVUP_TOKEN:-${TOKEN:-}}"
  fi
}

cli_usage() {
  cat <<EOF
${BOLD}devup.sh${N} – IORA OS Dev Inkrementelles Update-Tool

${BOLD}Verwendung:${N}
  ./devup.sh                  TUI-Modus (interaktiv)
  ./devup.sh [OPTIONEN]       CLI-Modus

${BOLD}CLI-Optionen:${N}
  --host HOST[:PORT]    Device-Adresse
  --token HEX           Dev-Token
  -s, --service NAME    Nur diesen Service deployen
  -a, --all             Alle Services deployen
  -n, --no-restart      Nur uploaden, nicht neustarten
  --dry-run             Vorschau
  --status              Device-Status anzeigen
  --list                Services auflisten
  --self-update         iora-dev-bridge selbst updaten
  --save                Config speichern
  --help                Diese Hilfe

${BOLD}Beispiele:${N}
  ./devup.sh                                  # TUI starten
  ./devup.sh --status                         # Status anzeigen
  ./devup.sh --service iora-home              # Ein Service
  ./devup.sh --all                            # Alles deployen
  ./devup.sh --host 192.168.1.42 --self-update
EOF
  exit 0
}

cli_main() {
  local MODE="deploy" SEL=() NO_RESTART=false DRY=false
  while [ $# -gt 0 ]; do
    case "$1" in
      --host) HOST="$2"; shift 2 ;;
      --token) TOKEN="$2"; shift 2 ;;
      -s|--service) SEL+=("$2"); shift 2 ;;
      -a|--all) MODE="all"; shift ;;
      -n|--no-restart) NO_RESTART=true; shift ;;
      --dry-run) DRY=true; shift ;;
      --status) MODE="status"; shift ;;
      --list) MODE="list"; shift ;;
      --self-update) MODE="selfupdate"; shift ;;
      --save) MODE="save"; shift ;;
      --help|-h) cli_usage ;;
      *) error "Unbekannt: $1"; cli_usage ;;
    esac
  done

  check_prereq || exit 1
  load_config

  case "$MODE" in
    status)
      [ -z "${HOST:-}" ] && { error "--host benötigt"; exit 1; }
      ensure_auth || exit 1
      local dev_json; dev_json="$(device_status_json)"
      echo -e "${BOLD}═══ IORA Dev Status ═══${N}"
      echo -e "Device:  $(echo "$dev_json" | jq -r '.hostname // "?"')"
      echo -e "Build:   $(echo "$dev_json" | jq -r '.build // "?"')"
      echo -e "Lokal:   $(get_local_version)"
      local last; last="$(get_last_build)"; echo -e "Letzter: ${last:-keiner}"
      echo ""
      local changed=()
      [ -n "$last" ] && while IFS= read -r s; do [ -n "$s" ] && changed+=("$s"); done <<< "$(get_changed_svcs "$last")"
      echo -e "${BOLD}Services:${N}"
      while IFS= read -r s; do
        [ -z "$s" ] && continue
        local m="  "
        for c in "${changed[@]}"; do [ "$c" = "$s" ] && m="${Y}*${N} "; done
        printf "  %b%-25s %s\n" "$m" "$s" "${SVC_DESC[$s]:-?}"
      done <<< "$(svc_list)"
      [ ${#changed[@]} -gt 0 ] && echo -e "\n${Y}*${N} = geändert seit letztem Build"
      ;;
    list)
      printf "%-28s %-6s %-8s %s\n" "SERVICE" "PORT" "PRIO" "BESCHREIBUNG"
      printf "%.0s─" {1..70}; echo ""
      while IFS= read -r s; do
        [ -z "$s" ] && continue
        printf "%-28s %-6s %-8s %s\n" "$s" "${SVC_PORT[$s]:-?}" "${SVC_PRIO[$s]:-?}" "${SVC_DESC[$s]:-?}"
      done <<< "$(svc_list)"
      ;;
    selfupdate)
      [ -z "${HOST:-}" ] && { error "--host benötigt"; exit 1; }
      ensure_auth || exit 1
      self_update_bridge
      ;;
    save)
      [ -z "${HOST:-}" ] && read -r -p "Device IP: " HOST
      [ -z "${TOKEN:-}" ] && read -r -p "Token: " TOKEN
      mkdir -p "$CONFIG_DIR"
      cat > "$CONFIG_FILE" <<EOF
IORA_DEVUP_HOST="${HOST}"
IORA_DEVUP_TOKEN="${TOKEN}"
EOF
      chmod 600 "$CONFIG_FILE"; success "Gespeichert: $CONFIG_FILE"
      ;;
    deploy|all)
      [ -z "${HOST:-}" ] && { error "--host benötigt"; exit 1; }
      ensure_auth || exit 1
      if [ ${#SEL[@]} -gt 0 ]; then
        build_and_deploy "${SEL[@]}"
      elif [ "$MODE" = "all" ]; then
        local all=()
        while IFS= read -r s; do [ -n "$s" ] && all+=("$s"); done <<< "$(svc_list)"
        build_and_deploy "${all[@]}"
      else
        local ch=()
        local l; l="$(get_last_build)"
        while IFS= read -r s; do [ -n "$s" ] && ch+=("$s"); done <<< "$(get_changed_svcs "$l")"
        [ ${#ch[@]} -eq 0 ] && { success "Keine Änderungen."; exit 0; }
        build_and_deploy "${ch[@]}"
      fi
      ;;
  esac
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ENTRYPOINT
# ═══════════════════════════════════════════════════════════════════════════════
if [ $# -eq 0 ]; then
  # Kein Argument → TUI starten
  if command -v whiptail >/dev/null 2>&1; then
    tui_main
  else
    echo -e "${Y}[WARN] whiptail nicht installiert – starte CLI-Modus.${N}"
    echo -e "${Y}       Installiere whiptail mit: sudo apt-get install whiptail${N}"
    echo ""
    echo -e "Nutze ${BOLD}./devup.sh --help${N} für Optionen."
    echo -e "Oder starte interaktiv mit: ${BOLD}./devup.sh --host <IP>${N}"
    exit 0
  fi
else
  cli_main "$@"
fi
