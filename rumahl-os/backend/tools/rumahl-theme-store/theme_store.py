#!/usr/bin/env python3
"""
rumahl Theme Store – External Theme Repository Server
====================================================
Simple HTTP API for hosting, discovering, and serving rumahl themes.
Run this on your server (e.g., themes.rumahl.com) alongside the
main store.rumahl.com.

Endpoints:
  GET  /api/themes                  – List all themes (with search/filter)
  GET  /api/themes/:id              – Get theme details
  GET  /api/themes/:id/download     – Download theme ZIP
  POST /api/themes/upload           – Upload a new theme (admin)
  GET  /api/themes/:id/preview      – Get preview image
  GET  /api/themes/:id/rating       – Get ratings
  POST /api/themes/:id/rate         – Rate a theme

Storage:
  themes/              – Theme ZIP files
  themes.json          – Theme metadata index
  ratings.json         – User ratings

Usage:
  python3 theme_store.py --port 8099 --host 0.0.0.0
"""

import json
import os
import sys
import time
import hashlib
import zipfile
import argparse
import shutil
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

# ─── Configuration ────────────────────────────────────────────────────

DATA_DIR = Path(os.environ.get('THEME_STORE_DATA', './data'))
THEMES_DIR = DATA_DIR / 'themes'
PREVIEWS_DIR = DATA_DIR / 'previews'
METADATA_FILE = DATA_DIR / 'themes.json'
RATINGS_FILE = DATA_DIR / 'ratings.json'
UPLOAD_SECRET = os.environ.get('UPLOAD_SECRET', 'change-me-in-production')

# ─── Data Models ──────────────────────────────────────────────────────

class ThemeStore:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        THEMES_DIR.mkdir(parents=True, exist_ok=True)
        PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
        self.themes = self._load_json(METADATA_FILE, [])
        self.ratings = self._load_json(RATINGS_FILE, {})

    def _load_json(self, path, default):
        if path.exists():
            try:
                return json.loads(path.read_text())
            except:
                return default
        return default

    def _save_json(self, path, data):
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    def _save_themes(self):
        self._save_json(METADATA_FILE, self.themes)

    def _save_ratings(self):
        self._save_json(RATINGS_FILE, self.ratings)

    def list_themes(self, search=None, category=None, limit=50, offset=0):
        results = self.themes
        if search:
            q = search.lower()
            results = [t for t in results if
                       q in t.get('name', '').lower() or
                       q in t.get('description', '').lower() or
                       q in t.get('developer', '').lower() or
                       q in t.get('id', '').lower()]
        if category:
            results = [t for t in results if t.get('category') == category]
        total = len(results)
        return total, results[offset:offset + limit]

    def get_theme(self, theme_id):
        for t in self.themes:
            if t['id'] == theme_id:
                return t
        return None

    def add_theme(self, theme_data, zip_path):
        theme_id = theme_data['id']
        # Check for duplicate
        existing = self.get_theme(theme_id)
        if existing:
            # Update
            for key, value in theme_data.items():
                existing[key] = value
            existing['updated_at'] = int(time.time())
        else:
            theme_data['created_at'] = int(time.time())
            theme_data['updated_at'] = int(time.time())
            theme_data['downloads'] = 0
            theme_data['rating'] = 0.0
            theme_data['rating_count'] = 0
            self.themes.append(theme_data)

        # Move ZIP to storage
        dest = THEMES_DIR / f'{theme_id}.zip'
        shutil.move(str(zip_path), str(dest))

        # Extract preview image if exists
        try:
            with zipfile.ZipFile(dest) as zf:
                for name in zf.namelist():
                    if 'preview' in name.lower() and (
                        name.endswith('.png') or name.endswith('.jpg') or
                        name.endswith('.svg') or name.endswith('.webp')
                    ):
                        zf.extract(name, PREVIEWS_DIR / theme_id)
                        theme_data['preview_path'] = name
                        break
        except:
            pass

        self._save_themes()
        return theme_data

    def get_download_path(self, theme_id):
        path = THEMES_DIR / f'{theme_id}.zip'
        if path.exists():
            # Increment downloads
            theme = self.get_theme(theme_id)
            if theme:
                theme['downloads'] = theme.get('downloads', 0) + 1
                self._save_themes()
            return path
        return None

    def rate_theme(self, theme_id, user_id, score):
        theme = self.get_theme(theme_id)
        if not theme:
            return None

        if theme_id not in self.ratings:
            self.ratings[theme_id] = {}

        self.ratings[theme_id][user_id] = score

        # Recalculate average
        scores = list(self.ratings[theme_id].values())
        theme['rating'] = round(sum(scores) / len(scores), 1)
        theme['rating_count'] = len(scores)

        self._save_ratings()
        self._save_themes()
        return theme

# ─── HTTP Handler ─────────────────────────────────────────────────────

store = ThemeStore()

class ThemeStoreHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, content_type='application/zip'):
        if not path.exists():
            self._send_json({'error': 'Not found'}, 404)
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', path.stat().st_size)
        self.send_header('Content-Disposition', f'attachment; filename="{path.name}"')
        self.end_headers()
        with open(path, 'rb') as f:
            self.wfile.write(f.read())

    def _send_error(self, message, status=400):
        self._send_json({'error': message}, status)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')
        params = parse_qs(parsed.query)

        # GET /api/themes – List themes
        if path == '/api/themes':
            search = params.get('q', [None])[0]
            category = params.get('category', [None])[0]
            limit = int(params.get('limit', ['50'])[0])
            offset = int(params.get('offset', ['0'])[0])
            total, themes = store.list_themes(search, category, limit, offset)
            self._send_json({
                'themes': themes,
                'total': total,
                'limit': limit,
                'offset': offset,
            })
            return

        # GET /api/themes/:id – Theme details
        parts = path.split('/')
        if len(parts) >= 4 and parts[1] == 'api' and parts[2] == 'themes':
            theme_id = parts[3]
            theme = store.get_theme(theme_id)
            if not theme:
                self._send_error('Theme not found', 404)
                return

            if len(parts) >= 5:
                action = parts[4]
                if action == 'download':
                    zip_path = store.get_download_path(theme_id)
                    if zip_path:
                        self._send_file(zip_path)
                    else:
                        self._send_error('Theme file not found', 404)
                    return
                elif action == 'preview':
                    preview_dir = PREVIEWS_DIR / theme_id
                    if preview_dir.exists():
                        for f in preview_dir.iterdir():
                            if f.is_file():
                                ct = 'image/png' if f.suffix == '.png' else 'image/jpeg' if f.suffix in ('.jpg', '.jpeg') else 'image/svg+xml'
                                self._send_file(f, ct)
                                return
                    self._send_error('Preview not found', 404)
                    return
                elif action == 'rating':
                    self._send_json({
                        'rating': theme.get('rating', 0),
                        'rating_count': theme.get('rating_count', 0),
                        'downloads': theme.get('downloads', 0),
                    })
                    return

            self._send_json(theme)
            return

        # GET /api/categories
        if path == '/api/categories':
            cats = sorted(set(t.get('category', 'Uncategorized') for t in store.themes))
            self._send_json({'categories': cats})
            return

        self._send_error('Not found', 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/')

        # POST /api/themes/upload
        if path == '/api/themes/upload':
            # Check auth
            auth = self.headers.get('Authorization', '')
            if f'Bearer {UPLOAD_SECRET}' not in auth:
                self._send_error('Unauthorized', 401)
                return

            content_type = self.headers.get('Content-Type', '')
            content_length = int(self.headers.get('Content-Length', 0))

            if 'multipart/form-data' in content_type:
                self._send_error('Use application/json with base64 zip_data', 400)
                return

            # Read JSON body with base64 ZIP
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
            except:
                self._send_error('Invalid JSON', 400)
                return

            import base64
            zip_b64 = data.get('zip_data', '')
            if ',' in zip_b64:
                zip_b64 = zip_b64.split(',')[1]
            zip_bytes = base64.b64decode(zip_b64)

            # Extract manifest to get metadata
            import tempfile
            import io
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
            tmp.write(zip_bytes)
            tmp.close()

            try:
                with zipfile.ZipFile(tmp.name) as zf:
                    if 'manifest.json' not in zf.namelist():
                        self._send_error('ZIP must contain manifest.json', 400)
                        os.unlink(tmp.name)
                        return
                    manifest_raw = zf.read('manifest.json')
                    manifest = json.loads(manifest_raw)

                    # Support both wrapped and unwrapped manifests
                    if 'theme' in manifest and isinstance(manifest['theme'], dict):
                        t = manifest['theme']
                    else:
                        t = manifest

                theme_data = {
                    'id': t['id'],
                    'name': t['name'],
                    'version': t['version'],
                    'developer': t.get('developer', 'Unknown'),
                    'description': t.get('description', ''),
                    'icon': t.get('icon', 'Palette'),
                    'parent_theme': t.get('parent_theme'),
                    'category': t.get('category', data.get('category', 'Uncategorized')),
                    'tags': data.get('tags', []),
                    'screenshots': data.get('screenshots', []),
                }

                theme = store.add_theme(theme_data, Path(tmp.name))
                self._send_json({'success': True, 'theme': theme}, 201)
            except Exception as e:
                self._send_error(f'Upload failed: {str(e)}', 400)
                try:
                    os.unlink(tmp.name)
                except:
                    pass
            return

        # POST /api/themes/:id/rate
        parts = path.split('/')
        if len(parts) >= 5 and parts[1] == 'api' and parts[2] == 'themes' and parts[4] == 'rate':
            theme_id = parts[3]
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body)
                user_id = data.get('user_id', 'anonymous')
                score = int(data.get('score', 0))
                if score < 1 or score > 5:
                    self._send_error('Score must be 1-5', 400)
                    return
                theme = store.rate_theme(theme_id, user_id, score)
                if theme:
                    self._send_json({'success': True, 'rating': theme['rating'], 'rating_count': theme['rating_count']})
                else:
                    self._send_error('Theme not found', 404)
            except Exception as e:
                self._send_error(f'Invalid request: {str(e)}', 400)
            return

        self._send_error('Not found', 404)

# ─── Main ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='rumahl Theme Store Server')
    parser.add_argument('--port', type=int, default=8099, help='Port to listen on')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--data-dir', default='./data', help='Data directory')
    args = parser.parse_args()

    global DATA_DIR, THEMES_DIR, PREVIEWS_DIR, METADATA_FILE, RATINGS_FILE
    DATA_DIR = Path(args.data_dir)
    THEMES_DIR = DATA_DIR / 'themes'
    PREVIEWS_DIR = DATA_DIR / 'previews'
    METADATA_FILE = DATA_DIR / 'themes.json'
    RATINGS_FILE = DATA_DIR / 'ratings.json'

    # Re-init store with new paths
    global store
    store = ThemeStore()

    print(f"""
╔══════════════════════════════════════════════════════════╗
║  🎨 rumahl Theme Store Server                             ║
╠══════════════════════════════════════════════════════════╣
║  Listening on: http://{args.host}:{args.port}
║  Data dir:     {DATA_DIR}
║  Themes:       {len(store.themes)} available
║  Endpoints:    /api/themes, /api/themes/:id, etc.
╚══════════════════════════════════════════════════════════╝
""")

    server = HTTPServer((args.host, args.port), ThemeStoreHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nShutting down...')
        server.shutdown()

if __name__ == '__main__':
    main()
