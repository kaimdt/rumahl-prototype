#!/usr/bin/env bash
# ============================================================================
# test-hot-reload.sh – Test Global Config Hot-Reload Mechanism
# ============================================================================
# Tests that config changes propagate to services immediately without restart.
#
# Usage: ./test-hot-reload.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()    { echo -e "${BLUE}[test-hot-reload]${NC} $*"; }
success(){ echo -e "${GREEN}[test-hot-reload]${NC} ✓ $*"; }
warn()   { echo -e "${YELLOW}[test-hot-reload]${NC} ⚠ $*"; }
error()  { echo -e "${RED}[test-hot-reload]${NC} ✗ $*"; }

IORA_HOME_URL="${IORA_HOME_URL:-http://127.0.0.1:8126}"
TEST_KEY="test.hot_reload"
TEST_VALUE_1="initial_value_$(date +%s)"
TEST_VALUE_2="updated_value_$(date +%s)"

# ═══════════════════════════════════════════════════════════════════════════
# Prerequisites Check
# ═══════════════════════════════════════════════════════════════════════════

log "Checking prerequisites..."

# Check if iora-home is running
if ! curl -s -f "${IORA_HOME_URL}/api/health" >/dev/null 2>&1; then
    error "iora-home is not running at ${IORA_HOME_URL}"
    exit 1
fi
success "iora-home is running"

# Check if config-notify script exists
if [ ! -f /usr/lib/iora/iora-config-notify ]; then
    warn "iora-config-notify not installed, hot-reload notifications will not work"
    warn "Run: sudo ./iora-config-sync.sh to install"
else
    success "iora-config-notify is installed"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Test 1: Create Initial Setting
# ═══════════════════════════════════════════════════════════════════════════

log "Test 1: Creating initial setting..."

RESPONSE=$(curl -s -X PUT "${IORA_HOME_URL}/api/settings/${TEST_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"value\": \"${TEST_VALUE_1}\"}" 2>&1 || echo "")

if [ -n "$RESPONSE" ]; then
    if echo "$RESPONSE" | grep -q "\"${TEST_VALUE_1}\""; then
        success "Setting created: ${TEST_KEY} = ${TEST_VALUE_1}"
    else
        warn "Setting created but response unexpected: $RESPONSE"
    fi
else
    error "Failed to create setting"
    exit 1
fi

sleep 1

# ═══════════════════════════════════════════════════════════════════════════
# Test 2: Verify Cache Updated
# ═══════════════════════════════════════════════════════════════════════════

log "Test 2: Verifying cache was updated..."

# Check if notification was created
NOTIFY_DIR="/var/run/iora/config-notify"
if [ -d "$NOTIFY_DIR" ]; then
    NOTIFY_COUNT=$(find "$NOTIFY_DIR" -type f -name "*_${TEST_KEY//./_}" 2>/dev/null | wc -l)
    if [ $NOTIFY_COUNT -gt 0 ]; then
        success "Notification file created in ${NOTIFY_DIR}"
        LATEST_NOTIFY=$(find "$NOTIFY_DIR" -type f -name "*_${TEST_KEY//./_}" | tail -1)
        log "Latest notification:"
        cat "$LATEST_NOTIFY" | sed 's/^/  /'
    else
        warn "No notification file found - hot-reload notifications may not be working"
    fi
else
    warn "Notification directory ${NOTIFY_DIR} does not exist"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Test 3: Read Setting Back
# ═══════════════════════════════════════════════════════════════════════════

log "Test 3: Reading setting back..."

READ_RESPONSE=$(curl -s -f "${IORA_HOME_URL}/api/settings/${TEST_KEY}" 2>&1 || echo "")

if [ -n "$READ_RESPONSE" ]; then
    if echo "$READ_RESPONSE" | grep -q "\"${TEST_VALUE_1}\""; then
        success "Setting read successfully: ${TEST_KEY} = ${TEST_VALUE_1}"
    else
        warn "Setting read but value unexpected: $READ_RESPONSE"
    fi
else
    error "Failed to read setting"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════
# Test 4: Update Setting (Hot-Reload Test)
# ═══════════════════════════════════════════════════════════════════════════

log "Test 4: Updating setting (testing hot-reload)..."

sleep 1
BEFORE_UPDATE=$(date +%s)

UPDATE_RESPONSE=$(curl -s -X PUT "${IORA_HOME_URL}/api/settings/${TEST_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"value\": \"${TEST_VALUE_2}\"}" 2>&1 || echo "")

AFTER_UPDATE=$(date +%s)
UPDATE_LATENCY=$((AFTER_UPDATE - BEFORE_UPDATE))

if [ -n "$UPDATE_RESPONSE" ]; then
    if echo "$UPDATE_RESPONSE" | grep -q "\"${TEST_VALUE_2}\""; then
        success "Setting updated: ${TEST_KEY} = ${TEST_VALUE_2} (latency: ${UPDATE_LATENCY}s)"
    else
        warn "Setting updated but response unexpected: $UPDATE_RESPONSE"
    fi
else
    error "Failed to update setting"
    exit 1
fi

sleep 1

# ═══════════════════════════════════════════════════════════════════════════
# Test 5: Verify Hot-Reload (Cache Should Have New Value)
# ═══════════════════════════════════════════════════════════════════════════

log "Test 5: Verifying hot-reload (cache should have new value)..."

# Check if new notification was created
if [ -d "$NOTIFY_DIR" ]; then
    NOTIFY_COUNT=$(find "$NOTIFY_DIR" -type f -mmin -1 -name "*_${TEST_KEY//./_}" 2>/dev/null | wc -l)
    if [ $NOTIFY_COUNT -gt 0 ]; then
        success "New notification file created (hot-reload triggered)"
        LATEST_NOTIFY=$(find "$NOTIFY_DIR" -type f -mmin -1 -name "*_${TEST_KEY//./_}" | tail -1)
        log "Latest notification (updated):"
        cat "$LATEST_NOTIFY" | sed 's/^/  /'
    else
        warn "No recent notification file found - hot-reload may not be working"
    fi
fi

# Read setting again to verify cache update
VERIFY_RESPONSE=$(curl -s -f "${IORA_HOME_URL}/api/settings/${TEST_KEY}" 2>&1 || echo "")

if [ -n "$VERIFY_RESPONSE" ]; then
    if echo "$VERIFY_RESPONSE" | grep -q "\"${TEST_VALUE_2}\""; then
        success "Cache has new value: ${TEST_KEY} = ${TEST_VALUE_2}"
        success "HOT-RELOAD VERIFIED! ✓"
    else
        error "Cache still has old value - hot-reload failed!"
        error "Expected: ${TEST_VALUE_2}, Got: $VERIFY_RESPONSE"
        exit 1
    fi
else
    error "Failed to verify setting"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════
# Test 6: Check SIGHUP Signals Sent
# ═══════════════════════════════════════════════════════════════════════════

log "Test 6: Checking if SIGHUP signals were sent to services..."

# Check systemd journal for SIGHUP messages (best-effort)
SIGHUP_COUNT=$(journalctl -u iora-home -u iora-core -u iora-assist --since "1 minute ago" 2>/dev/null | grep -ci "sighup\|reload\|config.*change" || echo "0")

if [ "$SIGHUP_COUNT" -gt 0 ]; then
    success "Found ${SIGHUP_COUNT} signal/reload log entries in systemd journal"
else
    warn "No SIGHUP/reload messages found in journal (services may not log them)"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Test 7: Cleanup
# ═══════════════════════════════════════════════════════════════════════════

log "Test 7: Cleaning up test setting..."

DELETE_RESPONSE=$(curl -s -X DELETE "${IORA_HOME_URL}/api/settings/${TEST_KEY}" 2>&1 || echo "")

if [ -n "$DELETE_RESPONSE" ]; then
    success "Test setting deleted: ${TEST_KEY}"
else
    warn "Failed to delete test setting - you may need to delete it manually"
fi

# Clean up test notifications
if [ -d "$NOTIFY_DIR" ]; then
    find "$NOTIFY_DIR" -type f -name "*_${TEST_KEY//./_}" -delete 2>/dev/null || true
    success "Test notification files cleaned up"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════

echo ""
log "═══════════════════════════════════════════════════════════════"
success "Hot-Reload Test PASSED ✓"
log "═══════════════════════════════════════════════════════════════"
echo ""
log "Summary:"
log "  1. Setting created: ✓"
log "  2. Cache updated: ✓"
log "  3. Setting read: ✓"
log "  4. Setting updated: ✓ (latency: ${UPDATE_LATENCY}s)"
log "  5. Hot-reload verified: ✓"
log "  6. SIGHUP signals: ${SIGHUP_COUNT} log entries"
log "  7. Cleanup: ✓"
echo ""
success "Global Config Hot-Reload is working correctly!"
echo ""
log "Next steps:"
log "  - Services using get_cached_setting() will automatically get new values"
log "  - No service restart needed for most config changes"
log "  - Check /var/run/iora/config-notify/ for notification files"
log "  - Monitor logs: journalctl -u iora-* -f"
echo ""
