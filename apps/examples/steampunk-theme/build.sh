#!/bin/bash
# Build Steampunk Revolution Theme
# Run: bash build.sh
# Output: steampunk-theme.zip

cd "$(dirname "$0")"

echo "⚙  Packaging Steampunk Revolution Theme..."

rm -f steampunk-theme.zip

zip -r steampunk-theme.zip \
  manifest.json \
  theme.css \
  theme.js \
  html/layout.html

echo ""
echo "✅ Created steampunk-theme.zip"
echo ""
echo "📦 Contents:"
unzip -l steampunk-theme.zip
echo ""
echo "🚂 Install with:"
echo "   ora app install steampunk-theme.zip"
echo ""
echo "🎩 Then go to Settings → Appearance → Steampunk Revolution"
