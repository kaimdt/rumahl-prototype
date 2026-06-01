#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FAIL_ON_FINDING=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$(cd "$2" && pwd)"
      shift 2
      ;;
    --fail-on-finding)
      FAIL_ON_FINDING=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

FRONTEND_SRC="$REPO_ROOT/frontend/src"
if [ ! -d "$FRONTEND_SRC" ]; then
  echo "WARN: frontend/src not found; skipping frontend config cache scan."
  exit 0
fi

NODE_BIN="$(command -v node || true)"
if [ -n "$NODE_BIN" ] && "$NODE_BIN" --version >/dev/null 2>&1; then
  ARGS=(--repo-root "$REPO_ROOT")
  if [ "$FAIL_ON_FINDING" -eq 1 ]; then
    ARGS+=(--fail-on-finding)
  fi
  "$NODE_BIN" "$SCRIPT_DIR/check-frontend-config-cache.mjs" "${ARGS[@]}"
  exit $?
fi

if command -v python3 >/dev/null 2>&1; then
  ARGS=(--repo-root "$REPO_ROOT")
  if [ "$FAIL_ON_FINDING" -eq 1 ]; then
    ARGS+=(--fail-on-finding)
  fi
  python3 "$SCRIPT_DIR/check-frontend-config-cache.py" "${ARGS[@]}"
  exit $?
fi

if command -v node.exe >/dev/null 2>&1 && node.exe --version >/dev/null 2>&1; then
  ARGS=(--repo-root "$REPO_ROOT")
  if [ "$FAIL_ON_FINDING" -eq 1 ]; then
    ARGS+=(--fail-on-finding)
  fi
  node.exe "$SCRIPT_DIR/check-frontend-config-cache.mjs" "${ARGS[@]}"
  exit $?
fi

  echo "ERROR: Node.js or Python 3 is required for frontend config cache validation." >&2
  exit 1