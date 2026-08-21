#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# rumahl Status — build the deployable website root (backend/root/).
#
#   cd frontend && npm run build      # static export → frontend/out/
#   bash backend/root/build.sh        # → backend/root/ (ready to upload)
#
# Upload the CONTENTS of backend/root/ to the web root (e.g. httpdocs/),
# then run:  php src/upgrade.php
#
# src/config.local.php is NEVER generated — copy your existing one from the
# old api/src/ folder (or let the web installer create it).
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

ROOT="$(pwd)"
API="$(cd ../api && pwd)"
FRONTEND="$(cd ../../frontend && pwd)"

echo "== Building website root in $ROOT"

# ── Backend modules (PHP only — never the local credentials file) ──
rm -rf "$ROOT/src" "$ROOT/frontend"
mkdir -p "$ROOT/src"

for f in "$API"/src/*.php; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    config.local.php) continue ;; # credentials stay on the server
  esac
  # Relative requires change when the files move from api/src/ into src/:
  #   __DIR__ . '/src/…'  →  __DIR__ . '/…'
  sed -e "s|__DIR__ . '/src/|__DIR__ . '/|g" "$f" > "$ROOT/src/$(basename "$f")"
done

# ── Front controllers → src/ (reachable only through the router) ──
sed -e "s|__DIR__ . '/src/|__DIR__ . '/|g" "$API/index.php"   > "$ROOT/src/api.php"
sed -e "s|__DIR__ . '/src/|__DIR__ . '/|g" "$API/cron.php"    > "$ROOT/src/cron.php"
sed -e "s|__DIR__ . '/src/|__DIR__ . '/|g" "$API/upgrade.php" > "$ROOT/src/upgrade.php"
sed -e "s|__DIR__ . '/src/|__DIR__ . '/|g" "$API/install.php" > "$ROOT/src/install.php"
sed -e "s|__DIR__ . '/src/|__DIR__ . '/|g" "$API/seed.php"    > "$ROOT/src/seed.php"
cp "$API/schema.sql" "$ROOT/src/schema.sql"

# ── Static frontend (Next.js export) ──
if [ -d "$FRONTEND/out" ]; then
  cp -r "$FRONTEND/out" "$ROOT/frontend"
  echo "== frontend/ copied from $FRONTEND/out"
else
  echo "!! frontend/out not found — run 'cd frontend && npm run build' first." >&2
fi

echo ""
echo "Done. Upload the contents of:"
echo "  $ROOT"
echo "to the web root (e.g. httpdocs/), then run:  php src/upgrade.php"
echo "Make sure src/config.local.php exists on the server (copy from the old api/src/)."
