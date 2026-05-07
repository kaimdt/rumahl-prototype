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

# ── Signal Handling: STRG+C = sauberer Abbruch mit Resume ──────────────────
_cleanup_on_interrupt() {
  echo -e "\n${Y}[ ABBRUCH ]${N} Fortschritt gespeichert – läuft beim nächsten Mal weiter."
  exit 130
}
trap '_cleanup_on_interrupt' INT TERM

# ── Resume / Checkpoint ──────────────────────────────────────────────────────
_load_state() { [ -f "$STATE_FILE" ] && is_json "$(cat "$STATE_FILE")"; }
_clear_state() { rm -f "$STATE_FILE"; }

# ── Metadaten ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"
DOCKERFILE="${BACKEND_DIR}/Dockerfile"
CONFIG_DIR="${HOME}/.config/iora-devup"
CONFIG_FILE="${CONFIG_DIR}/config"
LAST_BUILD_FILE="${CONFIG_DIR}/lastbuild"
BUILD_LOG_DIR="/tmp/iora-devup-logs"
STATE_FILE="/tmp/iora-devup-state.json"

# ── Unterstützte Ziel-Architekturen ──────────────────────────────────────
declare -A SUPPORTED_ARCHS
SUPPORTED_ARCHS[x86_64]="PC / VM (Intel/AMD, Standard)"
SUPPORTED_ARCHS[aarch64]="ARM 64-bit (Raspberry Pi 3/4/5, andere ARM64-Boards)"
TARGET_ARCH=""  # leer = auto-detect

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
  git -C "$SCRIPT_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown"
}
get_last_build() { cat "$LAST_BUILD_FILE" 2>/dev/null || echo ""; }
save_last_build() { mkdir -p "$CONFIG_DIR"; get_local_version > "$LAST_BUILD_FILE"; }

get_changed_svcs() {
  local last="$1"
  [ -z "$last" ] && { svc_list; return; }
  pushd "$SCRIPT_DIR" >/dev/null || return
  git cat-file -e "$last" 2>/dev/null || { svc_list; popd >/dev/null; return; }
  local c=()
  while IFS= read -r svc; do
    [ -z "$svc" ] && continue
    if ! git diff --quiet "$last"..HEAD -- "backend/${svc}/" "backend/iora-shared/" \
      "backend/Cargo.toml" "backend/Cargo.lock" "backend/Dockerfile" 2>/dev/null; then
      c+=("$svc")
    fi
  done <<< "$(svc_list)"
  popd >/dev/null
  printf '%s\n' "${c[@]}"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  DOCKER BUILD
# ═══════════════════════════════════════════════════════════════════════════════
detect_target_arch() {
  # 0. Explizit gesetzte Architektur (via --target)
  [ -n "${TARGET_ARCH:-}" ] && { echo "$TARGET_ARCH"; return; }
  # 1. Versuche vom Device die Architektur zu ermitteln
  if [ -n "${HOST:-}" ] && [ -n "${TOKEN:-}" ]; then
    local devinfo
    devinfo="$(_device_call GET "/dev/system/info" "" 2>/dev/null)" || true
    if is_json "$devinfo"; then
      local arch; arch="$(echo "$devinfo" | jq -r '.arch // ""')"
      if [ -n "$arch" ] && [ "$arch" != "null" ]; then
        echo "$arch"; return
      fi
    fi
  fi
  # 2. Fallback: lokale .setup-target Datei (von setup.sh)
  local t; t="$(cat "${SCRIPT_DIR}/.setup-target" 2>/dev/null || echo "")"
  case "$t" in rpi3|rpi4|rpi5|generic-arm64) echo "aarch64"; return ;; esac
  # 3. Letzter Fallback: lokale Architektur
  uname -m
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
    if ! docker build --platform linux/arm64 --build-arg "SVC=${svc}" -t "$tag" \
      -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}" "$BACKEND_DIR" >> "$logfile" 2>&1; then
      error "  ${svc}: Build fehlgeschlagen"; _show_build_error "$logfile" "$svc"
      docker image rm -f "$tag" >/dev/null 2>&1 || true
      rm -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}"; return 1
    fi
    rm -f "${BUILD_LOG_DIR}/Dockerfile.arm64-${svc}"
  else
    # Native Build: Inline-Dockerfile für EINEN Service
    info "  ${svc}: Docker (Alpine)..."

    cat > "${BUILD_LOG_DIR}/Dockerfile.native-${svc}" <<'DOCKERNATIVE'
FROM rust:1.90-alpine
RUN apk add --no-cache musl-dev gcc g++ make openssl-dev openssl-libs-static \
    pkgconfig postgresql-dev perl cmake git curl
WORKDIR /app/backend
COPY . .
ARG SVC
RUN set -ex; \
    cargo build --release -p "${SVC}"; \
    echo "=== Build finished, searching for binary ==="; \
    BIN=""; \
    for d in target/release target/x86_64-unknown-linux-musl/release target/aarch64-unknown-linux-gnu/release; do \
      if [ -x "$d/${SVC}" ]; then BIN="$d/${SVC}"; break; fi; \
    done; \
    if [ -z "$BIN" ]; then \
      echo "FATAL: Binary ${SVC} not found after successful cargo build!"; \
      echo "Searching target/ tree:"; \
      find target -name "${SVC}" -type f -ls 2>/dev/null || echo "  (nothing found)"; \
      ls -la target/ 2>/dev/null || echo "  target/ does not exist"; \
      exit 1; \
    fi; \
    mkdir -p /out; \
    cp "$BIN" "/out/${SVC}"; \
    ls -la "/out/${SVC}"; \
    echo "=== Binary ready: /out/${SVC} ==="
DOCKERNATIVE

    if ! docker build --build-arg "SVC=${svc}" -t "$tag" \
      -f "${BUILD_LOG_DIR}/Dockerfile.native-${svc}" \
      "$BACKEND_DIR" >> "$logfile" 2>&1; then
      error "  ${svc}: Build fehlgeschlagen"
      _show_build_error "$logfile" "$svc"
      docker image rm -f "$tag" >/dev/null 2>&1 || true
      rm -f "${BUILD_LOG_DIR}/Dockerfile.native-${svc}"
      return 1
    fi
    rm -f "${BUILD_LOG_DIR}/Dockerfile.native-${svc}"
  fi

  # Extraktion: Binary aus dem Image holen (docker exec geht nicht auf stopped container!)
  bin_path="${BUILD_LOG_DIR}/${svc}"
  local cb=""
  # Verwende docker run --rm zum Inspizieren (nicht docker create + exec)
  for cand in "/out/${svc}" "/app/backend/target/release/${svc}" \
    "/app/backend/target/aarch64-unknown-linux-gnu/release/${svc}" \
    "/app/backend/target/x86_64-unknown-linux-musl/release/${svc}"; do
    if docker run --rm --entrypoint "/bin/sh" "$tag" -c "test -f '$cand'" 2>/dev/null; then
      cb="$cand"; break
    fi
  done

  if [ -z "$cb" ]; then
    error "  ${svc}: Binary nicht im Container gefunden"
    warn "  Inhalt /out/:"
    docker run --rm --entrypoint "/bin/sh" "$tag" -c "ls -la /out/" 2>/dev/null || echo "    (leer oder Pfad nicht lesbar)"
    warn "  Suche nach ${svc} im Image:"
    docker run --rm --entrypoint "/bin/sh" "$tag" -c "find /out /app -name '${svc}' -type f 2>/dev/null" | head -5 || echo "    (nichts gefunden)"
    docker image rm -f "$tag" >/dev/null 2>&1; return 1
  fi

  # Binary kopieren (docker cp funktioniert mit docker create)
  local cid; cid=$(docker create "$tag" 2>/dev/null) || { error "  ${svc}: Container-Erstellung fehlgeschlagen"; docker image rm -f "$tag" >/dev/null 2>&1; return 1; }
  docker cp "${cid}:${cb}" "$bin_path" 2>/dev/null
  docker rm -f "$cid" >/dev/null 2>&1
  docker image rm -f "$tag" >/dev/null 2>&1

  if [ ! -f "$bin_path" ] || [ ! -s "$bin_path" ]; then
    error "  ${svc}: Binary-Extraktion fehlgeschlagen"; return 1
  fi
  chmod +x "$bin_path"
  local sz ft; sz="$(du -h "$bin_path" | cut -f1)"; ft="$(file "$bin_path" 2>/dev/null | cut -d: -f2-)"
  success "  ${svc} (${sz}) [${ft## }]"
  return 0
}

# Zeigt Build-Fehler aus dem Log
_show_build_error() {
  local log="$1" svc="$2"
  warn "  Build-Log Auszug (${svc}):"
  # Zeige cargo-Fehler und die letzten 15 Zeilen
  grep -E '(^error|WARNING.*did not compile|BUILD FAILURES)' "$log" 2>/dev/null | head -10 | while read -r l; do
    echo -e "    ${R}${l}${N}"
  done
  echo -e "    ${DIM}... letzte 15 Zeilen:${N}"
  tail -15 "$log" 2>/dev/null | while read -r l; do
    echo -e "    ${DIM}${l}${N}"
  done
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

    local target_arch; target_arch="$(detect_target_arch)"
    local menu_header="Device: ${dev_host}  |  Build: ${dev_build}\nLokal:  ${local_ver}  |  Ziel: ${target_arch}  |  Letzter Deploy: ${last:-keiner}\nGeändert: ${#changed[@]} Services\n\nAktion wählen:"

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
      if ! git -C "$SCRIPT_DIR" diff --quiet "$last"..HEAD -- "backend/${s}/" "backend/iora-shared/" \
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
  local svcs_all=("$@")
  [ ${#svcs_all[@]} -eq 0 ] && { warn "Keine Services angegeben."; return; }

  # Sortiere nach Priorität (kritische zuerst)
  IFS=$'\n' svcs_all=($(for s in "${svcs_all[@]}"; do printf '%s\t%s\n' "${SVC_PRIO[$s]:-99}" "$s"; done | sort -n | cut -f2)); unset IFS

  local built=() failed=() deployed=() deploy_failed=() dev_bridge_updated=false
  local total=${#svcs_all[@]} phase="build"

  # ── Resume-Check: vorherigen Run fortsetzen? ───────────────────
  if _load_state; then
    local prev_phase prev_total
    prev_phase="$(jq -r '.phase // ""' "$STATE_FILE")"
    prev_total="$(jq -r '.total // 0' "$STATE_FILE")"
    # Nur fortführen wenn gleiche Anzahl Services
    if [ "$prev_total" = "$total" ] && [ -n "$prev_phase" ] && [ "$prev_phase" != "done" ]; then
      local prev_built prev_deployed
      prev_built="$(jq -r '.built | length' "$STATE_FILE")"
      prev_deployed="$(jq -r '.deployed | length' "$STATE_FILE")"
      echo ""
      warn "Vorheriger Run abgebrochen! (Phase: ${prev_phase}, Gebaut: ${prev_built}/${prev_total}, Deployed: ${prev_deployed}/${prev_total})"
      read -r -p "  Fortsetzen? [Y/n]: " ans
      if [ "$ans" != "n" ] && [ "$ans" != "N" ]; then
        # Lade fertige Services aus State
        local tmp
        tmp="$(jq -r '.built[]?' "$STATE_FILE" 2>/dev/null)" || true
        while IFS= read -r s; do [ -n "$s" ] && built+=("$s"); done <<< "$tmp"
        tmp="$(jq -r '.deployed[]?' "$STATE_FILE" 2>/dev/null)" || true
        while IFS= read -r s; do [ -n "$s" ] && deployed+=("$s"); done <<< "$tmp"
        tmp="$(jq -r '.failed_build[]?' "$STATE_FILE" 2>/dev/null)" || true
        while IFS= read -r s; do [ -n "$s" ] && failed+=("$s"); done <<< "$tmp"
        tmp="$(jq -r '.failed_deploy[]?' "$STATE_FILE" 2>/dev/null)" || true
        while IFS= read -r s; do [ -n "$s" ] && deploy_failed+=("$s"); done <<< "$tmp"
        phase="$prev_phase"
        info "Resume: ${#built[@]} gebaut, ${#deployed[@]} deployed – mache weiter..."
      else
        _clear_state
      fi
    else
      _clear_state
    fi
  fi

  echo ""
  echo -e "${BOLD}═══ Build & Deploy: ${total} Services ═══${N}"
  echo ""

  _save_step() {
    local ph="$1"
    printf '%s\n' "${svcs_all[@]:-}" | jq -R . | jq -s . >/dev/null  # validate arrays
    jq -n \
      --arg phase "$ph" --arg total "$total" \
      --argjson svcs "$(printf '%s\n' "${svcs_all[@]:-}" | jq -R . | jq -s .)" \
      --argjson built "$(printf '%s\n' "${built[@]:-}" | jq -R . | jq -s .)" \
      --argjson deployed "$(printf '%s\n' "${deployed[@]:-}" | jq -R . | jq -s .)" \
      --argjson failed_build "$(printf '%s\n' "${failed[@]:-}" | jq -R . | jq -s .)" \
      --argjson failed_deploy "$(printf '%s\n' "${deploy_failed[@]:-}" | jq -R . | jq -s .)" \
      --arg started "$(date -Iseconds)" \
      '{phase:$phase,total:($total|tonumber),services:$svcs,built:$built,deployed:$deployed,failed_build:$failed_build,failed_deploy:$failed_deploy,started:$started}' \
      > "$STATE_FILE" 2>/dev/null || true
  }

  # ── Phase 1: Build ──────────────────────────────────────────────────────
  if [ "$phase" = "build" ]; then
    mkdir -p "$BUILD_LOG_DIR"
    local current=0
    for s in "${svcs_all[@]}"; do
      [ -z "$s" ] && continue
      # Überspringe bereits gebaute (aus Resume)
      local already=false
      for b in "${built[@]}"; do [ "$b" = "$s" ] && already=true && break; done
      $already && continue
      # Überspringe bereits failed
      for f in "${failed[@]}"; do [ "$f" = "$s" ] && already=true && break; done
      $already && continue

      current=$((current + 1))
      echo -e "${B}[build ${current}/${total}]${N} ${s}"
      docker_build_one "$s" && built+=("$s") || failed+=("$s")
      _save_step "build"  # Checkpoint nach JEDEM Build
    done
  fi

  if [ ${#built[@]} -eq 0 ]; then
    error "Kein Service erfolgreich gebaut!"; _clear_state; return 1
  fi

  echo ""
  echo -e "${BOLD}─── Deploy: ${#built[@]} Services ───${N}"
  if [ ${#failed[@]} -gt 0 ]; then
    warn "Build-Fehler (werden übersprungen): ${failed[*]}"
  fi
  echo ""

  # ── Phase 2: Deploy ─────────────────────────────────────────────────────
  phase="deploy"; _save_step "deploy"
  local current=0
  for s in "${built[@]}"; do
    [ -z "$s" ] && continue
    # Überspringe bereits deployed (aus Resume)
    local already=false
    for d in "${deployed[@]}"; do [ "$d" = "$s" ] && already=true && break; done
    $already && continue
    # Überspringe bereits deploy-failed
    for f in "${deploy_failed[@]}"; do [ "$f" = "$s" ] && already=true && break; done
    $already && continue

    current=$((current + 1))
    echo -e "${B}[deploy ${current}/${#built[@]}]${N} ${s}"
    if [ "$s" = "iora-dev-bridge" ]; then
      warn "iora-dev-bridge wird als letztes aktualisiert (nach allen anderen Services)"
      dev_bridge_updated=true
      continue
    fi
    deploy_one "$s" && deployed+=("$s") || deploy_failed+=("$s")
    _save_step "deploy"  # Checkpoint nach JEDEM Deploy
  done

  # ── Phase 3: Bridge Self-Update ────────────────────────────────────
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

  # ── Phase 4: Abhängige Services neustarten ──────────────────────────
  echo ""
  info "Prüfe abhängige Services..."
  for s in "${deployed[@]}"; do
    restart_dependents "$s"
  done

  # ── Fertig: State löschen ────────────────────────────────────────────
  _clear_state

  # ── Zusammenfassung ─────────────────────────────────────────────────
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
  -t, --target ARCH     Ziel-Architektur: x86_64, aarch64 (Default: auto)
  -s, --service NAME    Nur diesen Service deployen
  -a, --all             Alle Services deployen
  -n, --no-restart      Nur uploaden, nicht neustarten
  --dry-run             Vorschau
  --status              Device-Status anzeigen
  --list                Services auflisten
  --list-archs          Verfügbare Ziel-Architekturen anzeigen
  --self-update         iora-dev-bridge selbst updaten
  --clean               Alle lokalen Docker-Images & Build-Artefakte löschen
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
      -t|--target) TARGET_ARCH="$2"; shift 2 ;;
      -s|--service) SEL+=("$2"); shift 2 ;;
      -a|--all) MODE="all"; shift ;;
      -n|--no-restart) NO_RESTART=true; shift ;;
      --dry-run) DRY=true; shift ;;
      --status) MODE="status"; shift ;;
      --list) MODE="list"; shift ;;
      --list-archs) MODE="list-archs"; shift ;;
      --self-update) MODE="selfupdate"; shift ;;
      --clean) MODE="clean"; shift ;;
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
    list-archs)
      echo -e "${BOLD}Unterstützte Ziel-Architekturen:${N}"
      echo ""
      local detected; detected="$(detect_target_arch)"
      for arch in "${!SUPPORTED_ARCHS[@]}"; do
        local marker=" "; [ "$arch" = "$detected" ] && marker="${G}*${N}"
        printf "  %b %-10s %s\n" "$marker" "$arch" "${SUPPORTED_ARCHS[$arch]}"
      done
      echo ""
      echo -e "  ${G}*${N} = aktuell erkannt/gesetzt"
      echo -e "  Setzen mit: ${BOLD}--target aarch64${N}"
      echo -e "  Oder Datei: echo 'rpi4' > .setup-target"
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
    clean)
      echo -e "${BOLD}═══ Cleanup: Docker-Images & Build-Artefakte ═══${N}"
      echo ""
      # Docker-Images mit iora-devup-Tag
      local imgs; imgs=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep 'iora-devup-' || true)
      if [ -n "$imgs" ]; then
        echo "$imgs" | while read -r img; do
          info "Entferne: $img"
          docker image rm -f "$img" >/dev/null 2>&1 || true
        done
        echo ""
      fi
      # Hängende Container
      local cons; cons=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep 'iora-devup-' || true)
      if [ -n "$cons" ]; then
        echo "$cons" | while read -r c; do
          info "Entferne Container: $c"
          docker rm -f "$c" >/dev/null 2>&1 || true
        done
        echo ""
      fi
      # Build-Logs & Temp-Dateien
      rm -rf "${BUILD_LOG_DIR}" 2>/dev/null || true
      rm -f /tmp/iora-devup-* 2>/dev/null || true
      _clear_state
      # Docker BuildKit Cache
      docker builder prune -f --filter "label=iora-devup" 2>/dev/null || true
      success "Cleanup abgeschlossen"
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
    tui_main || exit 1
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
