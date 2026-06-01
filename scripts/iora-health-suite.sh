#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FULL_WORKSPACE=0
SKIP_FRONTEND=0
FAILURES=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --full-workspace)
      FULL_WORKSPACE=1
      shift
      ;;
    --skip-frontend)
      SKIP_FRONTEND=1
      shift
      ;;
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

invoke_check() {
  local name="$1"
  shift
  echo ""
  echo "== $name =="
  if "$@"; then
    echo "OK: $name"
  else
    local code=$?
    echo "FAILED: $name"
    echo "  Command exited with code $code"
    FAILURES+=("$name")
  fi
}

invoke_check "Migration registration" "$SCRIPT_DIR/check-iora-migrations.sh" --repo-root "$REPO_ROOT"
invoke_check "Frontend config cache scan" "$SCRIPT_DIR/check-frontend-config-cache.sh" --repo-root "$REPO_ROOT" --fail-on-finding
invoke_check "Cross-platform script pairs" "$SCRIPT_DIR/check-cross-platform-scripts.sh" --repo-root "$REPO_ROOT"
invoke_check "App/plugin/theme examples" "$SCRIPT_DIR/check-app-plugin-theme-examples.sh" --repo-root "$REPO_ROOT"
invoke_check "iora-dev-watch build" bash -c 'cd "$1/iora-os/backend" && cargo build -p iora-dev-watch' bash "$REPO_ROOT"
invoke_check "iora-home build" bash -c 'cd "$1/iora-os/backend" && cargo build -p iora-home' bash "$REPO_ROOT"

if [ "$FULL_WORKSPACE" -eq 1 ]; then
  invoke_check "Rust workspace build" bash -c 'cd "$1/iora-os/backend" && cargo build --workspace' bash "$REPO_ROOT"
fi

if [ "$SKIP_FRONTEND" -eq 0 ] && [ -f "$REPO_ROOT/frontend/package.json" ]; then
  invoke_check "frontend build" bash -c 'cd "$1/frontend" && npm run build' bash "$REPO_ROOT"
fi

echo ""
if [ "${#FAILURES[@]}" -eq 0 ]; then
  echo "All health-suite checks passed."
  exit 0
fi

echo "Health-suite failures:"
printf '  %s\n' "${FAILURES[@]}"
exit 1