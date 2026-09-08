#!/bin/bash
# rumahl Weekly Code Quality Check
set -euo pipefail

PROJECT="/home/hermes/ora"
OUTPUT=""

echo "=== rumahl Weekly Code Quality Check ==="
echo ""

# --- cargo check ---
echo "─── cargo check ───"
CHECK_OUTPUT=$(cd "$PROJECT/rumahl-os/backend" && cargo check 2>&1)

if [ $? -ne 0 ]; then
    echo "$CHECK_OUTPUT" | tail -20
    echo ""
    echo "❌ COMPILATION ERRORS FOUND!"
    exit 1
fi

WARN_COUNT=$(echo "$CHECK_OUTPUT" | grep -c "^warning:" 2>/dev/null || echo "0")
echo "$CHECK_OUTPUT" | grep "^warning:" | head -10
echo "   Total: $WARN_COUNT warnings"
echo "✅ cargo check passed"
echo ""

# --- cargo clippy ---
echo "─── cargo clippy ───"
CLIPPY_OUTPUT=$(cd "$PROJECT/rumahl-os/backend" && cargo clippy 2>&1)
CLIPPY_COUNT=$(echo "$CLIPPY_OUTPUT" | grep "^warning:" | wc -l)
echo "$CLIPPY_OUTPUT" | grep "^warning:" | head -15
echo "   Total: $CLIPPY_COUNT clippy warnings"
echo "✅ clippy check passed"
echo ""

# --- Summary ---
echo "=== Summary ==="
echo "cargo check warnings: $WARN_COUNT"
echo "cargo clippy warnings: $CLIPPY_COUNT"

if [ "$WARN_COUNT" -eq 0 ] && [ "$CLIPPY_COUNT" -eq 0 ]; then
    echo "✅ Project is clean!"
fi
