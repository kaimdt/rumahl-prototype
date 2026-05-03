#!/bin/bash
# Build the Material Sidebar Theme as a ZIP package
# Run: bash build.sh
# Output: material-sidebar-theme.zip

cd "$(dirname "$0")"

echo "📦 Packaging Material Sidebar Theme..."

# Remove old zip if exists
rm -f material-sidebar-theme.zip

# Create ZIP with all theme files
zip -r material-sidebar-theme.zip \
  manifest.json \
  theme.css \
  theme.js \
  html/layout.html

echo "✅ Created material-sidebar-theme.zip"
echo ""
echo "📁 Contents:"
unzip -l material-sidebar-theme.zip
echo ""
echo "🚀 Install with:"
echo "   ora app install material-sidebar-theme.zip"
