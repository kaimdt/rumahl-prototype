#!/usr/bin/env bash
# ============================================================================
# install-requirements.sh – Top-level installer dispatcher
# ============================================================================
# Detects the host environment (WSL, native Linux, macOS) and forwards to
# the appropriate platform-specific installer. Homebrew is installed
# automatically on macOS when missing.
#
# All options after --auto/--linux/--wsl/--macos are forwarded verbatim, e.g.:
#   ./install-requirements.sh --dev-only -y
#   ./install-requirements.sh --linux --build-only
#   ./install-requirements.sh --check
# ============================================================================

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="auto"

usage() {
    cat <<EOF
Usage: $(basename "$0") [--auto|--linux|--wsl|--macos] [installer args...]

Modes:
  --auto       Detect environment (default)
  --linux      Force native Linux installer
  --wsl        Force WSL installer
  --macos      Force macOS installer

All other args are passed through to the platform installer:
  --dev-only     Install just the dev VM + dev-watch deps
  --build-only   Install just the Buildroot build deps
  --full         Both (default)
  --check        Don't install, just report what's missing
  --no-docker    Skip Docker
  --no-rust      Skip rustup
  --no-node      Skip Node.js
  -y, --yes      Non-interactive

Examples:
  $(basename "$0") --dev-only -y
  $(basename "$0") --linux --build-only --no-docker
  $(basename "$0") --check
EOF
}

# ── Pre-parse only the leading platform switch (one-shot) ──────────────
case "${1:-}" in
    --auto)   MODE="auto"; shift ;;
    --linux)  MODE="linux"; shift ;;
    --wsl)    MODE="wsl"; shift ;;
    --macos)  MODE="macos"; shift ;;
    -h|--help) usage; exit 0 ;;
esac

# ── Detect ────────────────────────────────────────────────────────────
if [ "$MODE" = "auto" ]; then
    case "$(uname -s 2>/dev/null)" in
        Darwin) MODE="macos" ;;
        Linux)
            if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
                MODE="wsl"
            else
                MODE="linux"
            fi
            ;;
        *) echo "[ERROR] Unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
fi

echo "[INFO] Installer mode: $MODE"

case "$MODE" in
    linux)
        exec "$SCRIPT_DIR/install-requirements-linux.sh" "$@"
        ;;
    wsl)
        exec "$SCRIPT_DIR/install-requirements-wsl.sh" "$@"
        ;;
    macos)
        exec "$SCRIPT_DIR/install-requirements-macos.sh" "$@"
        ;;
    *)
        echo "[ERROR] Invalid mode: $MODE" >&2
        exit 1
        ;;
esac
