#!/bin/bash
# =============================================================================
# IORA Steampunk Revolution – Self-Contained Theme Installer
# =============================================================================
# One-command installation of the full Steampunk theme with all effects:
# brass borders, gear animations, steam particles, Victorian typography, etc.
#
# Usage:
#   bash install-steampunk.sh [IORA_URL] [AUTH_TOKEN]
#
# Examples:
#   bash install-steampunk.sh                                    # localhost:3001
#   bash install-steampunk.sh http://192.168.1.100:8126          # IORA OS
#   bash install-steampunk.sh http://localhost:3001 "your-token"
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IORA_URL="${1:-http://localhost:3001}"
AUTH_TOKEN="${2:-}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║  ⚙  STEAMPUNK REVOLUTION – Self-Contained Installer    ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  Target: ${BOLD}$IORA_URL${NC}"

# ─── Get auth token ──────────────────────────────────────────────────
if [ -z "$AUTH_TOKEN" ]; then
    # Try common auth token locations for IORA
    for src in \
        "$SCRIPT_DIR/../../../.env" \
        "$HOME/.iora/auth" \
        "/etc/iora/auth-token"; do
        if [ -f "$src" ]; then
            AUTH_TOKEN=$(grep -oP '(?:AUTH_TOKEN|iora_token|token)=\K.*' "$src" 2>/dev/null | head -1 | tr -d '\r\n' || echo "")
            [ -n "$AUTH_TOKEN" ] && break
        fi
    done
fi

if [ -z "$AUTH_TOKEN" ]; then
    echo -e "\n  ${YELLOW}Auth token required.${NC}"
    echo "  Find it in IORA → Settings → Developer → API Token,"
    echo "  or in browser DevTools → Application → Local Storage → 'auth-token'"
    echo ""
    read -rp "  Paste your auth token: " AUTH_TOKEN
fi

if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${RED}Error: Auth token is required${NC}"
    exit 1
fi

# ─── Build the final manifest ────────────────────────────────────────
echo -e "\n${CYAN}[1/2]${NC} Building self-contained theme manifest..."

MANIFEST_FILE="$SCRIPT_DIR/.steampunk-install-temp.json"

python3 -c "
import json, base64

with open('$SCRIPT_DIR/steampunk-self-contained.json', 'r') as f:
    manifest = json.load(f)

with open('$SCRIPT_DIR/theme.css', 'r') as f:
    manifest['additional_css'] = f.read()

with open('$SCRIPT_DIR/theme.js', 'r') as f:
    js_b64 = base64.b64encode(f.read().encode()).decode()
    manifest['js_files'] = [f'data:text/javascript;base64,{js_b64}']

manifest['html_templates'] = {}

with open('$MANIFEST_FILE', 'w') as f:
    json.dump(manifest, f, ensure_ascii=False)

size = len(json.dumps(manifest, ensure_ascii=False))
print(f'  Manifest: {size/1024:.1f} KB (CSS: {len(manifest[\"additional_css\"])} chars, JS: embedded)')
"

echo -e "  ${GREEN}✓${NC} Manifest ready"

# ─── Install via API ─────────────────────────────────────────────────
echo -e "\n${CYAN}[2/2]${NC} Installing theme via IORA API..."

HTTP_CODE=$(curl -s -o /tmp/iora-theme-response.txt -w "%{http_code}" \
    -X POST "$IORA_URL/api/themes/install-from-manifest" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "@$MANIFEST_FILE" 2>&1)

RESPONSE=$(cat /tmp/iora-theme-response.txt 2>/dev/null || echo "")
rm -f /tmp/iora-theme-response.txt "$MANIFEST_FILE"

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    echo -e "  ${GREEN}✓${NC} Theme installed successfully!"
else
    echo -e "  ${RED}✗${NC} API returned HTTP $HTTP_CODE"
    echo "  Response: $RESPONSE"
    echo ""
    echo -e "  ${YELLOW}Alternative: Install via IORA UI${NC}"
    echo "  Go to: Admin Panel → Themes → Upload ZIP"
    echo "  Select: $SCRIPT_DIR/steampunk-theme.zip"
    echo ""
    echo "  Or manually POST the manifest to:"
    echo "  ${BOLD}curl -X POST $IORA_URL/api/themes/install-from-manifest \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -H 'Authorization: Bearer YOUR_TOKEN' \\"
    echo "    -d @steampunk-self-contained-final.json${NC}"
    exit 1
fi

# ─── Success ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}  ║  ✅  Steampunk Revolution ist bereit!            ║${NC}"
echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Theme aktivieren:${NC}"
echo -e "  ${BOLD}1.${NC} Öffne IORA → Einstellungen → Erscheinungsbild"
echo -e "  ${BOLD}2.${NC} Wähle ${YELLOW}\"Steampunk Revolution\"${NC} aus"
echo ""
echo -e "  ${BOLD}Was du jetzt siehst:${NC}"
echo -e "  🟡 ${BOLD}Messing-Rahmen${NC} – Alle Cards haben brassene Umrandungen"
echo -e "  🔩 ${BOLD}Eck-Nieten${NC} – Dekorative Metallnieten an Kartenecken"
echo -e "  ⚙  ${BOLD}Rotierende Zahnräder${NC} – Dezente animierte Zahnräder"
echo -e "  💨 ${BOLD}Dampf-Partikel${NC} – Aufsteigende Dampfschwaden"
echo -e "  🕯️ ${BOLD}Gaslicht-Flackern${NC} – Ambienter Beleuchtungseffekt"
echo -e "  📜 ${BOLD}Viktorianische Schrift${NC} – IM Fell English + Cinzel Decorative"
echo -e "  🎛️ ${BOLD}Seitenleiste links${NC} – Navigation im Brass-Control-Panel"
echo ""
echo -e "  ${BOLD}Feintuning:${NC}"
echo -e "  Einstellungen → Erscheinungsbild → Theme-Einstellungen:"
echo -e "  • Dampf-Partikel (an/aus)"
echo -e "  • Zahnrad-Geschwindigkeit (langsam/normal/schnell)"
echo -e "  • Vignette-Effekt (0-100%)"
echo -e "  • Messing-Rahmen (an/aus)"
echo -e "  • Akzentfarbe: Messing, Kupfer, Bronze, Rose Gold"
echo ""
