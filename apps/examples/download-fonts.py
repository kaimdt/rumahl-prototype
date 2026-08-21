#!/usr/bin/env python3
"""
Google Fonts Downloader für rumahl Themes
Lädt alle in den Theme-Manifesten referenzierten Google Fonts als woff2 herunter
und speichert sie lokal im fonts/-Verzeichnis des jeweiligen Themes.
Aktualisiert die Manifeste für offline-Nutzung.

Usage: python3 download-fonts.py [--theme <name>] [--all]
"""

import json
import os
import sys
import re
import urllib.request
import urllib.parse
from pathlib import Path

EXAMPLES_DIR = Path(__file__).parent if '__file__' in dir() else Path.cwd()

# Google Fonts CSS API v2
GF_API = "https://fonts.googleapis.com/css2"

def parse_google_fonts_url(url: str) -> tuple[str, dict]:
    """Parse a Google Fonts URL and extract family + params."""
    if 'fonts.googleapis.com' not in url:
        return None, {}
    
    parsed = urllib.parse.urlparse(url)
    params = urllib.parse.parse_qs(parsed.query)
    family = params.get('family', [''])[0]
    
    # Extract weight and subset info
    extra = {}
    for key in ['weight', 'subset', 'display']:
        if key in params:
            extra[key] = params[key][0]
    
    return family, extra

def build_download_url(family: str, params: dict) -> str:
    """Build the Google Fonts CSS URL for downloading."""
    query_parts = [f"family={urllib.parse.quote(family)}"]
    if 'weight' in params:
        query_parts.append(f"weight={params['weight']}")
    if 'subset' in params:
        query_parts.append(f"subset={params['subset']}")
    query_parts.append("display=swap")
    return f"{GF_API}?{'&'.join(query_parts)}"

def extract_font_urls(css_text: str) -> list[tuple[str, str]]:
    """Extract font URLs and formats from Google Fonts CSS."""
    fonts = []
    # Match @font-face blocks
    blocks = re.findall(r'@font-face\s*\{([^}]+)\}', css_text, re.DOTALL)
    for block in blocks:
        url_match = re.search(r'url\((https://[^)]+)\)', block)
        format_match = re.search(r"format\('([^']+)'\)", block)
        if url_match:
            fmt = format_match.group(1) if format_match else 'woff2'
            fonts.append((url_match.group(1), fmt))
    return fonts

def download_font(url: str, dest: Path) -> bool:
    """Download a font file to destination."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; rumahl-Theme-Builder/1.0)'
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(data)
        return True
    except Exception as e:
        print(f"    ✗ Download fehlgeschlagen: {url[:80]}... ({e})")
        return False

def process_theme(theme_dir: Path, dry_run: bool = False) -> dict:
    """Process a single theme: download fonts and update manifest."""
    manifest_path = theme_dir / "manifest.json"
    if not manifest_path.exists():
        return {"theme": theme_dir.name, "status": "no manifest"}
    
    with open(manifest_path) as f:
        data = json.load(f)
    
    theme = data.get("theme", {})
    fonts = theme.get("fonts", [])
    if not fonts:
        return {"theme": theme_dir.name, "status": "no google fonts"}
    
    fonts_dir = theme_dir / "fonts"
    downloaded = []
    updated_fonts = []
    
    for font in fonts:
        url = font.get("url", "")
        if "fonts.googleapis.com" not in url:
            updated_fonts.append(font)
            continue
        
        family, params = parse_google_fonts_url(url)
        if not family:
            updated_fonts.append(font)
            continue
        
        print(f"  📦 {font['name']} ({family[:40]}...)")
        
        # Download CSS
        dl_url = build_download_url(family, params)
        try:
            req = urllib.request.Request(dl_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; rumahl-Theme-Builder/1.0)'
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                css_text = resp.read().decode('utf-8')
        except Exception as e:
            print(f"    ✗ CSS download failed: {e}")
            updated_fonts.append(font)
            continue
        
        # Extract font file URLs
        font_files = extract_font_urls(css_text)
        if not font_files:
            print(f"    ⚠ Keine Font-Dateien gefunden")
            updated_fonts.append(font)
            continue
        
        # Download each font variant
        local_files = []
        for idx, (font_url, font_format) in enumerate(font_files):
            ext = "woff2" if "woff2" in font_format else "woff"
            fname = f"{font['name'].lower().replace(' ', '-')}-{idx}.{ext}"
            dest = fonts_dir / fname
            
            if dry_run:
                print(f"    [DRY] Would download: {font_url[:60]}... -> {fname}")
            else:
                if download_font(font_url, dest):
                    size_kb = dest.stat().st_size / 1024
                    print(f"    ✓ {fname} ({size_kb:.1f} KB)")
                    local_files.append(f"fonts/{fname}")
        
        if local_files:
            # Create local CSS file
            css_name = f"{font['name'].lower().replace(' ', '-')}.css"
            css_path = fonts_dir / css_name
            
            # Generate @font-face rules
            local_css = ""
            for idx, (_, _) in enumerate(font_files):
                if idx < len(local_files):
                    fname = local_files[idx].replace("fonts/", "")
                    local_css += f"""@font-face {{
  font-family: '{family.split(':')[0].replace('+', ' ')}';
  src: url('{fname}') format('woff2');
  font-weight: {params.get('weight', '400').split(';')[0] if ';' in params.get('weight','400') else params.get('weight','400')};
  font-style: normal;
  font-display: swap;
}}\n"""
            
            if not dry_run:
                with open(css_path, 'w') as f:
                    f.write(local_css)
                print(f"    ✓ CSS: {css_name}")
            
            # Update font entry to use local files
            updated_font = dict(font)
            updated_font["url"] = f"fonts/{css_name}"
            updated_font["format"] = "woff2"
            updated_fonts.append(updated_font)
            downloaded.append(font['name'])
        else:
            updated_fonts.append(font)
    
    # Update manifest
    data["theme"]["fonts"] = updated_fonts
    if not dry_run:
        with open(manifest_path, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    return {
        "theme": theme_dir.name,
        "status": "ok",
        "downloaded": downloaded,
        "count": len(downloaded)
    }

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Google Fonts Downloader für rumahl Themes")
    parser.add_argument("--theme", help="Nur ein bestimmtes Theme verarbeiten")
    parser.add_argument("--all", action="store_true", help="Alle Themes verarbeiten")
    parser.add_argument("--dry-run", action="store_true", help="Nur anzeigen, nichts herunterladen")
    args = parser.parse_args()
    
    if args.theme:
        theme_dirs = [EXAMPLES_DIR / args.theme]
    elif args.all:
        theme_dirs = sorted([
            d for d in EXAMPLES_DIR.iterdir()
            if d.is_dir() and (d / "manifest.json").exists()
            and "theme" in str((d / "manifest.json").read_text()[:200]).lower()
        ])
    else:
        # Default: only theme directories in apps/examples
        theme_dirs = sorted([
            d for d in EXAMPLES_DIR.iterdir()
            if d.is_dir() and (d / "manifest.json").exists()
        ])
    
    results = []
    for td in theme_dirs:
        print(f"\n{'='*60}")
        print(f"📁 {td.name}")
        print(f"{'='*60}")
        result = process_theme(td, dry_run=args.dry_run)
        results.append(result)
    
    print(f"\n{'='*60}")
    print("📊 ZUSAMMENFASSUNG")
    print(f"{'='*60}")
    total = 0
    for r in results:
        if r["status"] == "ok":
            print(f"  ✓ {r['theme']}: {r['count']} Fonts heruntergeladen")
            total += r["count"]
        else:
            print(f"  - {r['theme']}: {r['status']}")
    print(f"\n  Insgesamt: {total} Font-Dateien")
    
    if args.dry_run:
        print("\n  ⚠ DRY RUN - nichts wurde heruntergeladen")

if __name__ == "__main__":
    main()
