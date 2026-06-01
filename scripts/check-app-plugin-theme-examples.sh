#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

NODE_BIN="$(command -v node || true)"
if [ -n "$NODE_BIN" ] && "$NODE_BIN" --version >/dev/null 2>&1; then
  "$NODE_BIN" "$SCRIPT_DIR/check-app-plugin-theme-examples.mjs" --repo-root "$REPO_ROOT"
  exit $?
fi

if command -v python3 >/dev/null 2>&1; then
  python3 "$SCRIPT_DIR/check-app-plugin-theme-examples.py" --repo-root "$REPO_ROOT"
  exit $?
fi

if command -v node.exe >/dev/null 2>&1 && node.exe --version >/dev/null 2>&1; then
  node.exe "$SCRIPT_DIR/check-app-plugin-theme-examples.mjs" --repo-root "$REPO_ROOT"
  exit $?
fi

echo "ERROR: Node.js or Python 3 is required for app/plugin/theme example validation." >&2
exit 1