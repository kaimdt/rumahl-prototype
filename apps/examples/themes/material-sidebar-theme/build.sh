#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NAME="$(basename "$DIR")"

# Find manifest (manifest.json or plugin.json)
MANIFEST=""
if [ -f "$DIR/manifest.json" ]; then
  MANIFEST="$DIR/manifest.json"
elif [ -f "$DIR/plugin.json" ]; then
  MANIFEST="$DIR/plugin.json"
fi

if [ -n "$MANIFEST" ]; then
  VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$MANIFEST" | head -1 | grep -o '[0-9][0-9.]*' || echo "0.0.0")
else
  VERSION="0.0.0"
fi

ZIP="${DIR}/${NAME}-v${VERSION}.zip"
rm -f "$ZIP"
cd "$DIR"
zip -r "$ZIP" . -x "*.zip" ".DS_Store" "build.sh" "build.ps1" "*.bat"
echo "Created: $ZIP ($(du -h "$ZIP" | cut -f1))"
