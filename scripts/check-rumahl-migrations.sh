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

MIGRATIONS_DIR="$REPO_ROOT/rumahl-os/backend/services/rumahl-home/migrations"
DB_MOD="$REPO_ROOT/rumahl-os/backend/services/rumahl-home/src/db/mod.rs"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: Migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi
if [ ! -f "$DB_MOD" ]; then
  echo "ERROR: rumahl-home db/mod.rs not found: $DB_MOD" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; | sort > "$TMP_DIR/files.txt"
sed -n 's/.*include_str!("\.\.\/\.\.\/migrations\/\([^"]*\.sql\)").*/\1/p' "$DB_MOD" | sort -u > "$TMP_DIR/registered.txt"

comm -23 "$TMP_DIR/files.txt" "$TMP_DIR/registered.txt" > "$TMP_DIR/missing.txt"
comm -13 "$TMP_DIR/files.txt" "$TMP_DIR/registered.txt" > "$TMP_DIR/stale.txt"

awk '
  /^[0-9][0-9][0-9]_/ {
    n = substr($0, 1, 3) + 0
    seen[n] = 1
    if (n > max) max = n
  }
  END {
    for (i = 1; i <= max; i++) {
      if (!(i in seen)) printf "%03d\n", i
    }
  }
' "$TMP_DIR/files.txt" > "$TMP_DIR/missing_numbers.txt"

if [ ! -s "$TMP_DIR/missing.txt" ] && [ ! -s "$TMP_DIR/stale.txt" ] && [ ! -s "$TMP_DIR/missing_numbers.txt" ]; then
  COUNT="$(wc -l < "$TMP_DIR/files.txt" | tr -d '[:space:]')"
  echo "OK: rumahl-home migrations are registered and sequential ($COUNT files)."
  exit 0
fi

if [ -s "$TMP_DIR/missing.txt" ]; then
  echo "ERROR: SQL files missing from db/mod.rs:"
  sed 's/^/  /' "$TMP_DIR/missing.txt"
fi
if [ -s "$TMP_DIR/stale.txt" ]; then
  echo "ERROR: db/mod.rs references missing SQL files:"
  sed 's/^/  /' "$TMP_DIR/stale.txt"
fi
if [ -s "$TMP_DIR/missing_numbers.txt" ]; then
  echo "ERROR: Migration number gaps:"
  sed 's/^/  /' "$TMP_DIR/missing_numbers.txt"
fi

exit 1