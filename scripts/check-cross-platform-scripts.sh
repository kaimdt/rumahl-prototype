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

TMP_MISSING="$(mktemp)"
trap 'rm -f "$TMP_MISSING"' EXIT

find "$REPO_ROOT" \
  \( -path '*/.git' -o -path '*/node_modules' -o -path '*/target' -o -path '*/dist' -o -path '*/build' \) -prune \
  -o -type f -name '*.ps1' -print | sort | while IFS= read -r ps1_file; do
  sh_file="${ps1_file%.ps1}.sh"
  if [ ! -f "$sh_file" ]; then
    rel="${ps1_file#$REPO_ROOT/}"
    printf '%s\n' "$rel" >> "$TMP_MISSING"
  fi
done

if [ ! -s "$TMP_MISSING" ]; then
  echo "OK: every PowerShell script has a sibling .sh script."
  exit 0
fi

echo "ERROR: PowerShell scripts without sibling .sh script:"
sed 's/^/  /' "$TMP_MISSING"
exit 1