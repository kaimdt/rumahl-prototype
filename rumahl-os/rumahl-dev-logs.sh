#!/usr/bin/env bash
# ============================================================================
# rumahl-dev-logs.sh – Live Log Access for rumahl Dev VM
# ============================================================================
# Provides live log streaming and access exactly like rumahl OS.
# All rumahl services log to journald, accessible via journalctl.
#
# Usage:
#   ./rumahl-dev-logs.sh                    # Show all rumahl logs (last 100 lines)
#   ./rumahl-dev-logs.sh -f                 # Follow all rumahl logs
#   ./rumahl-dev-logs.sh rumahl-home          # Show logs for specific service
#   ./rumahl-dev-logs.sh rumahl-home -f       # Follow logs for specific service
#   ./rumahl-dev-logs.sh --since "5m ago"   # Show logs from last 5 minutes
# ============================================================================

set -euo pipefail

SERVICE=""
FOLLOW=""
SINCE=""
LINES="100"
EXTRA_ARGS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -f|--follow)
            FOLLOW="-f"
            shift
            ;;
        --since)
            SINCE="--since=$2"
            shift 2
            ;;
        -n|--lines)
            LINES="$2"
            shift 2
            ;;
        rumahl-*)
            SERVICE="$1"
            shift
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

# Color output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}rumahl Dev VM - Live Logs${NC}"
echo ""

if [ -n "$SERVICE" ]; then
    echo -e "${GREEN}Service:${NC} $SERVICE"
    journalctl -u "$SERVICE" -n "$LINES" $FOLLOW $SINCE "${EXTRA_ARGS[@]}" --no-pager
else
    echo -e "${GREEN}All rumahl services${NC}"
    # Show logs from all rumahl-* services
    journalctl -u "rumahl-*" -n "$LINES" $FOLLOW $SINCE "${EXTRA_ARGS[@]}" --no-pager
fi
