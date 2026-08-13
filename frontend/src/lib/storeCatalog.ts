/**
 * Minimal ZIP builder (store method, no compression) + the IORA store
 * catalog of REAL installable apps (Docker containers).
 *
 * The backend installs apps from a ZIP containing manifest.json + any
 * app files (docker-compose.yml for container apps). We build that ZIP
 * in the browser and POST it to /api/appstore/install — no server-side
 * catalog changes needed.
 */

// ─── CRC32 (standard table) ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build a store-method ZIP from { path → string }. */
export function buildAppZip(files: Record<string, string>): string {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content)
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)

    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true) // local file header signature
    dv.setUint16(4, 20, true) // version needed
    dv.setUint16(6, 0, true) // flags
    dv.setUint16(8, 0, true) // method: store
    dv.setUint16(10, 0, true) // mod time
    dv.setUint16(12, 0x21, true) // mod date
    dv.setUint32(14, crc, true)
    dv.setUint32(18, data.length, true) // compressed size
    dv.setUint32(22, data.length, true) // uncompressed size
    dv.setUint16(26, nameBytes.length, true)
    dv.setUint16(28, 0, true) // extra length
    local.set(nameBytes, 30)

    chunks.push(local, data)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const cdv = new DataView(centralHeader.buffer)
    cdv.setUint32(0, 0x02014b50, true) // central dir signature
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, 0x21, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, data.length, true)
    cdv.setUint32(24, data.length, true)
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint16(30, 0, true) // extra
    cdv.setUint16(32, 0, true) // comment
    cdv.setUint16(34, 0, true) // disk
    cdv.setUint16(36, 0, true) // internal attrs
    cdv.setUint32(38, 0, true) // external attrs
    cdv.setUint32(42, offset, true) // local header offset
    centralHeader.set(nameBytes, 46)
    central.push(centralHeader)

    offset += local.length + data.length
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0)
  const end = new Uint8Array(22)
  const edv = new DataView(end.buffer)
  edv.setUint32(0, 0x06054b50, true) // end of central dir
  edv.setUint16(8, central.length, true)
  edv.setUint16(10, central.length, true)
  edv.setUint32(12, centralSize, true)
  edv.setUint32(16, offset, true)

  const all = new Uint8Array(offset + centralSize + 22)
  let pos = 0
  for (const chunk of [...chunks, ...central, end]) {
    all.set(chunk, pos)
    pos += chunk.length
  }

  // base64
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < all.length; i += CHUNK) {
    binary += String.fromCharCode(...all.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// ─── Store catalog — real, installable Docker apps ────────────────────────

export interface CatalogAppDefinition {
  id: string
  name: string
  developer: string
  description: string
  version: string
  category: string
  /** Manifest permissions to grant at install time (required for enable). */
  permissions: string[]
  /** Port the web UI is reachable at after install (host port). */
  openPort?: number
  /** Local (non-Docker) app: the "port" is a guest-only service port that
   * must NOT be opened as a host URL - the app proxy routes it inside the
   * guest (/api/apps/<id>/proxy). Used by the ORA Browser (iora-browserd). */
  proxyOnly?: boolean
  /** Inline SVG icon (data URL) — real icons, no external dependency. */
  iconUrl?: string
  /** Default login shown on the detail page (Umbrel-style). */
  defaultCredentials?: { username: string; password: string }
  /** Apps that must be installed first (Umbrel-style dependency check). */
  requires?: string[]
  /** Builds the installable ZIP (manifest.json + docker-compose.yml + web assets). */
  buildZip: () => string
}

/** Minimal inline SVG icon helper (rounded tile + letter/glyph). */
function svgIcon(bg: string, glyph: string, fg = 'white'): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="44" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="${fg}" text-anchor="middle">${glyph}</text>` +
    `</svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/** Nextcloud-style cloud glyph on brand blue. */
function cloudSvg(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#0082C9"/>` +
    `<path d="M46 40a8 8 0 0 0-1-15.9 12 12 0 0 0-22.9-2.6A9.5 9.5 0 0 0 20 40h22a6 6 0 0 0 4-1.5" fill="white"/>` +
    `</svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/** Firefox-style globe on orange. */
function globeSvg(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#FF7139"/>` +
    `<circle cx="32" cy="32" r="15" fill="none" stroke="white" stroke-width="5"/>` +
    `<ellipse cx="32" cy="32" rx="7" ry="15" fill="none" stroke="white" stroke-width="5"/>` +
    `<path d="M17 32h30" stroke="white" stroke-width="5"/>` +
    `</svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

const nextcloudManifest = {
  id: 'nextcloud',
  name: 'Nextcloud',
  version: '1.0.0',
  developer: 'Nextcloud GmbH',
  description: 'Deine eigene Cloud: Dateien, Kalender, Kontakte & mehr — vollständig selbst gehostet in einem Docker-Container.',
  type: 'app',
  icon: 'cloud',
  permissions: ['AppStorageRead', 'AppStorageWrite', 'NetworkLocalAccess'],
  // App Embedding Gateway: runs inside the ORA desktop on its own origin.
  display: {
    mode: 'embedded',
    isolation: 'strict',
    permissions: ['clipboard-write', 'fullscreen'],
  },
  docker: {
    auto_build: false,
    image: 'nextcloud:stable',
    internal_ports: [{ port: 80, protocol: 'tcp', external: 8180 }],
    volumes: ['nextcloud_data:/var/www/html'],
    environment: {
      NEXTCLOUD_ADMIN_USER: 'admin',
      NEXTCLOUD_ADMIN_PASSWORD: 'iora-admin',
      SQLITE_DATABASE: '/var/www/html/data/owncloud.db',
    },
    restart: 'unless-stopped',
  },
}

const oraBrowserManifest = {
  id: 'ora-browser',
  name: 'ORA Browser',
  version: '0.1.0',
  developer: 'IORA OS',
  description: 'Der ORA Browser — ein echter Browser als ORA-Systemdienst. Die Seiten laufen in Chromium auf dem ORA-Server (nicht als eingebettete Seite): keine X-Frame-Options-/CSP-Probleme, Tabs und Sessions gehören ORA.',
  type: 'app',
  icon: 'browser',
  permissions: ['NetworkLocalAccess'],
  // The browser UI embeds the remote Chromium surface (canvas + WS),
  // not a website — no iframe sandbox needed. The local app lifecycle
  // uses these loopback hooks: start opens a fresh tab, stop closes all
  // tabs (the global engine keeps running for other apps).
  ports: [
    { external: 8102, protocol: 'tcp', internal: 8102 },
  ],
  start_endpoint: 'http://127.0.0.1:8102/api/tabs',
  stop_endpoint: 'http://127.0.0.1:8102/api/shutdown',
  display: {
    mode: 'embedded',
    permissions: ['clipboard-read', 'clipboard-write', 'fullscreen'],
  },
}

function buildZipFor(manifest: Record<string, unknown>): string {
  // The backend generates the docker-compose.yml from the manifest's
  // `docker` config and assigns free external ports automatically.
  return buildAppZip({
    'manifest.json': JSON.stringify(manifest, null, 2),
  })
}

interface DockerCatalogInput {
  id: string
  name: string
  developer: string
  description: string
  category: string
  image: string
  port: number
  internalPort: number
  icon: string
  volume?: string
  permissions?: string[]
}

/** Creates a complete, installable Docker app entry for the local store. */
function dockerCatalogApp(input: DockerCatalogInput): CatalogAppDefinition {
  return {
    id: input.id,
    name: input.name,
    developer: input.developer,
    description: input.description,
    version: 'latest',
    category: input.category,
    permissions: input.permissions || ['NetworkLocalAccess'],
    openPort: input.port,
    iconUrl: svgIcon(input.icon, input.name.slice(0, 1).toUpperCase()),
    buildZip: () => buildZipFor({
      id: input.id,
      name: input.name,
      version: '1.0.0',
      developer: input.developer,
      description: input.description,
      type: 'app',
      icon: input.icon,
      permissions: input.permissions || ['NetworkLocalAccess'],
      display: {
        mode: 'embedded',
        isolation: 'strict',
        permissions: ['clipboard-write', 'fullscreen'],
      },
      docker: {
        auto_build: false,
        image: input.image,
        internal_ports: [{ port: input.internalPort, protocol: 'tcp', external: input.port }],
        volumes: input.volume ? [input.volume] : [],
        restart: 'unless-stopped',
      },
    }),
  }
}

/** Real, installable apps shown in the store (Docker containers). */
export const STORE_CATALOG: CatalogAppDefinition[] = [
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    developer: 'Nextcloud GmbH',
    description: 'Deine eigene Cloud: Dateien, Kalender, Kontakte & mehr — vollständig selbst gehostet in einem Docker-Container auf deinem IORA OS.',
    version: '1.0.0',
    category: 'Cloud',
    permissions: ['AppStorageRead', 'AppStorageWrite'],
    openPort: 8180,
    iconUrl: cloudSvg(),
    defaultCredentials: { username: 'admin', password: 'iora-admin' },
    buildZip: () => buildZipFor(nextcloudManifest),
  },
  {
    id: 'ora-browser',
    name: 'ORA Browser',
    developer: 'IORA OS',
    description: 'Der ORA Browser — ein echter Browser als ORA-Systemdienst. Seiten laufen in Chromium auf deinem ORA-Server, nicht als eingebettete Seite: X-Frame-Options und CSP sind egal, Tabs & Sessions gehören ORA.',
    version: '0.1.0',
    category: 'Browser',
    permissions: ['NetworkLocalAccess'],
    openPort: 8102,
    proxyOnly: true,
    iconUrl: globeSvg(),
    buildZip: () => buildZipFor(oraBrowserManifest),
  },
  dockerCatalogApp({
    id: 'jellyfin', name: 'Jellyfin', developer: 'Jellyfin Team', category: 'Media',
    description: 'Stream your own films, series, music, and photos from a private media server.',
    image: 'jellyfin/jellyfin:latest', port: 8096, internalPort: 8096, icon: '#00A4DC', volume: 'jellyfin_config:/config',
  }),
  dockerCatalogApp({
    id: 'vaultwarden', name: 'Vaultwarden', developer: 'Vaultwarden', category: 'Security',
    description: 'A lightweight, private password manager compatible with Bitwarden clients.',
    image: 'vaultwarden/server:latest', port: 8222, internalPort: 80, icon: '#175DDC', volume: 'vaultwarden_data:/data',
  }),
  dockerCatalogApp({
    id: 'uptime-kuma', name: 'Uptime Kuma', developer: 'Louis Lam', category: 'Monitoring',
    description: 'Monitor websites and services with a beautiful self-hosted status dashboard.',
    image: 'louislam/uptime-kuma:1', port: 3003, internalPort: 3001, icon: '#5CBD3B', volume: 'uptime_kuma_data:/app/data',
  }),
  dockerCatalogApp({
    id: 'syncthing', name: 'Syncthing', developer: 'Syncthing Foundation', category: 'Productivity',
    description: 'Synchronize files privately between your devices without a central cloud.',
    image: 'syncthing/syncthing:latest', port: 8384, internalPort: 8384, icon: '#0891B2', volume: 'syncthing_data:/var/syncthing',
  }),
  dockerCatalogApp({
    id: 'grafana', name: 'Grafana', developer: 'Grafana Labs', category: 'Monitoring',
    description: 'Build dashboards and explore metrics from your home and services.',
    image: 'grafana/grafana-oss:latest', port: 3300, internalPort: 3000, icon: '#F46800', volume: 'grafana_data:/var/lib/grafana',
  }),
  dockerCatalogApp({
    id: 'mealie', name: 'Mealie', developer: 'Mealie', category: 'Productivity',
    description: 'Plan meals, manage recipes, and generate shopping lists for your household.',
    image: 'ghcr.io/mealie-recipes/mealie:latest', port: 9925, internalPort: 9000, icon: '#E76F51', volume: 'mealie_data:/app/data',
  }),
  dockerCatalogApp({
    id: 'homebridge', name: 'Homebridge', developer: 'Homebridge', category: 'Automation',
    description: 'Connect compatible accessories and bridges to Apple Home.',
    image: 'homebridge/homebridge:latest', port: 8581, internalPort: 8581, icon: '#F7B733', volume: 'homebridge_data:/homebridge',
  }),
  {
    id: "ora-notes",
    name: "Notizen",
    developer: 'IORA Team',
    description: "Einfache Notizen-App \u2013 jede Notiz wird \u00fcber das ORA App Storage (KV) gespeichert. Zeigt, wie eine installierbare App das App-Framework nutzt.",
    version: '1.0.0',
    category: "Produktivit\u00e4t",
    permissions: ['AppStorageRead', 'AppStorageWrite', 'AppStorageDelete', 'AppStorageManage'],
    iconUrl: svgIcon('#0ea5e9', "N"),
    buildZip: () => buildAppZip({
      'manifest.json': "{\n  \"id\": \"ora-notes\",\n  \"name\": \"Notizen\",\n  \"version\": \"1.0.0\",\n  \"developer\": \"IORA Team\",\n  \"description\": \"Einfache Notizen-App \u2013 jede Notiz wird \u00fcber das ORA App Storage (KV) gespeichert. Zeigt, wie eine installierbare App das App-Framework nutzt.\",\n  \"icon\": \"https://img.icons8.com/color/256/notebook.png\",\n  \"type\": \"app\",\n  \"permissions\": [\n    \"AppStorageRead\",\n    \"AppStorageWrite\",\n    \"AppStorageDelete\",\n    \"AppStorageManage\"\n  ],\n  \"storage\": {\n    \"enabled\": true,\n    \"quota\": {\n      \"max_file_storage_bytes\": 5242880,\n      \"max_kv_entries\": 100,\n      \"max_file_size_bytes\": 1048576\n    }\n  },\n  \"custom_pages\": [\n    {\n      \"id\": \"ora-notes-main\",\n      \"title\": \"Notizen\",\n      \"icon\": \"NotePencil\",\n      \"url\": \"/apps/ora-notes/\",\n      \"show_in_nav\": true,\n      \"order\": 210\n    }\n  ],\n  \"settings_schema\": {\n    \"title\": \"Notizen Einstellungen\",\n    \"description\": \"Einstellungen der Notizen-App\",\n    \"fields\": [\n      {\n        \"key\": \"sort_newest_first\",\n        \"label\": \"Neueste zuerst\",\n        \"description\": \"Neueste Notizen oben anzeigen\",\n        \"type\": \"boolean\",\n        \"default\": true\n      }\n    ]\n  },\n  \"docker\": {\n    \"auto_build\": true,\n    \"base_image\": \"node:18-alpine\",\n    \"working_dir\": \"/app\",\n    \"install_cmd\": \"npm install\",\n    \"start_cmd\": \"node server.js\",\n    \"internal_ports\": [\n      {\n        \"port\": 3000,\n        \"protocol\": \"tcp\",\n        \"description\": \"HTTP API und Web-UI\"\n      }\n    ],\n    \"environment\": {\n      \"NODE_ENV\": \"production\"\n    },\n    \"health_check\": {\n      \"endpoint\": \"/health\",\n      \"interval\": 30,\n      \"timeout\": 10,\n      \"retries\": 3\n    }\n  },\n  \"store_metadata\": {\n    \"category\": \"Produktivit\u00e4t\",\n    \"tags\": [\"notizen\", \"notes\", \"produktivit\u00e4t\"],\n    \"screenshots\": [],\n    \"min_iora_version\": \"2.0.0\",\n    \"homepage\": \"https://github.com/kaimdt/ora\",\n    \"source_url\": \"https://github.com/kaimdt/ora\",\n    \"license\": \"MIT\"\n  }\n}\n",
      'server.js': "/**\n * ORA Notes \u2014 installable lifestyle app (Package 6).\n *\n * Demonstrates the ORA App Framework for third-party apps:\n *   \u2022 App Storage KV  \u2192 notes are persisted via the ORA storage API\n *     (PUT/GET /api/apps/<app-id>/storage/kv/<key>) using the app token.\n *   \u2022 Custom page     \u2192 the app registers a launcher page (/apps/ora-notes/).\n *   \u2022 Health check    \u2192 the supervisor polls /health.\n *\n * The app runs in its own Docker container; it never talks to the ORA\n * database directly \u2014 only through the app-scoped storage API.\n */\nconst express = require('express');\nconst path = require('path');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\nconst IORA_HOME = process.env.IORA_HOME_URL || 'http://iora-home:3001';\nconst APP_ID = process.env.IORA_APP_ID || 'ora-notes';\nconst KV_KEY = 'notes';\n\napp.use(express.json({ limit: '1mb' }));\napp.use(express.static(path.join(__dirname, 'public')));\n\n/** Auth header for ORA app-storage calls (token injected by the supervisor). */\nfunction headers() {\n  const h = { 'Content-Type': 'application/json' };\n  if (process.env.IORA_API_KEY) h['Authorization'] = 'Bearer ' + process.env.IORA_API_KEY;\n  return h;\n}\n\nasync function loadNotes() {\n  try {\n    const r = await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, { headers: headers() });\n    if (!r.ok) return [];\n    const data = await r.json();\n    return Array.isArray(data.value) ? data.value : [];\n  } catch {\n    return [];\n  }\n}\n\nasync function saveNotes(notes) {\n  await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, {\n    method: 'PUT',\n    headers: headers(),\n    body: JSON.stringify({ key: KV_KEY, value: notes }),\n  });\n}\n\n// \u2500\u2500 REST API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\napp.get('/api/notes', async (_req, res) => {\n  res.json(await loadNotes());\n});\n\napp.post('/api/notes', async (req, res) => {\n  const title = String(req.body?.title || '').trim().slice(0, 200);\n  const content = String(req.body?.content || '').slice(0, 50_000);\n  if (!title) return res.status(400).json({ error: 'title required' });\n  const notes = await loadNotes();\n  const now = new Date().toISOString();\n  const note = {\n    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),\n    title,\n    content,\n    created_at: now,\n    updated_at: now,\n  };\n  notes.unshift(note);\n  await saveNotes(notes);\n  res.status(201).json(note);\n});\n\napp.put('/api/notes/:id', async (req, res) => {\n  const notes = await loadNotes();\n  const index = notes.findIndex((n) => n.id === req.params.id);\n  if (index === -1) return res.status(404).json({ error: 'not found' });\n  const updated = {\n    ...notes[index],\n    ...(req.body?.title !== undefined ? { title: String(req.body.title).trim().slice(0, 200) } : {}),\n    ...(req.body?.content !== undefined ? { content: String(req.body.content).slice(0, 50_000) } : {}),\n    updated_at: new Date().toISOString(),\n  };\n  notes[index] = updated;\n  await saveNotes(notes);\n  res.json(updated);\n});\n\napp.delete('/api/notes/:id', async (req, res) => {\n  const notes = await loadNotes();\n  await saveNotes(notes.filter((n) => n.id !== req.params.id));\n  res.json({ deleted: true });\n});\n\napp.get('/health', (_req, res) => {\n  res.json({ status: 'ok' });\n});\n\napp.listen(PORT, () => {\n  console.log(`ORA Notes listening on :${PORT} (storage via ${IORA_HOME})`);\n});\n",
      'package.json': "{\n  \"name\": \"ora-notes\",\n  \"version\": \"1.0.0\",\n  \"private\": true,\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\"\n  },\n  \"dependencies\": {\n    \"express\": \"^4.19.2\"\n  }\n}",
      'public/index.html': "<!DOCTYPE html>\n<html lang=\"de\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n  <title>Notizen</title>\n  <style>\n    :root { color-scheme: dark; }\n    * { box-sizing: border-box; margin: 0; padding: 0; }\n    body {\n      font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;\n      background: #0b0d12; color: #e5e7eb; min-height: 100vh;\n    }\n    header {\n      display: flex; align-items: center; justify-content: space-between;\n      padding: 1.25rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.08);\n    }\n    header h1 { font-size: 1.25rem; font-weight: 600; }\n    header button, .note button {\n      background: rgba(255,255,255,0.08); color: #e5e7eb; border: 1px solid rgba(255,255,255,0.12);\n      border-radius: 0.75rem; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.85rem;\n      transition: background 0.15s;\n    }\n    header button:hover, .note button:hover { background: rgba(255,255,255,0.14); }\n    main { max-width: 46rem; margin: 0 auto; padding: 1.5rem; }\n    .editor {\n      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);\n      border-radius: 1rem; padding: 1rem; margin-bottom: 1.5rem;\n    }\n    .editor input, .editor textarea {\n      width: 100%; background: rgba(0,0,0,0.3); color: #e5e7eb; border: 1px solid rgba(255,255,255,0.1);\n      border-radius: 0.6rem; padding: 0.6rem 0.75rem; margin-bottom: 0.6rem; font-size: 0.9rem;\n    }\n    .editor textarea { min-height: 5rem; resize: vertical; }\n    .editor button.primary { background: #22d3ee; color: #082f36; border: none; font-weight: 600; }\n    .note {\n      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);\n      border-radius: 1rem; padding: 1rem; margin-bottom: 0.75rem;\n    }\n    .note h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0.4rem; }\n    .note p { font-size: 0.88rem; color: rgba(255,255,255,0.75); white-space: pre-wrap; word-break: break-word; }\n    .note time { display: block; font-size: 0.72rem; color: rgba(255,255,255,0.4); margin-top: 0.6rem; }\n    .note .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }\n    .empty { text-align: center; color: rgba(255,255,255,0.35); padding: 3rem 0; }\n  </style>\n</head>\n<body>\n  <header>\n    <h1>\u270e Notizen</h1>\n    <button id=\"newBtn\">Neue Notiz</button>\n  </header>\n  <main>\n    <div class=\"editor\" id=\"editor\" hidden>\n      <input id=\"titleInput\" placeholder=\"Titel\" />\n      <textarea id=\"contentInput\" placeholder=\"Inhalt\u2026\"></textarea>\n      <button class=\"primary\" id=\"saveBtn\">Speichern</button>\n      <button id=\"cancelBtn\">Abbrechen</button>\n    </div>\n    <div id=\"list\"></div>\n  </main>\n  <script>\n    const list = document.getElementById('list');\n    const editor = document.getElementById('editor');\n    const titleInput = document.getElementById('titleInput');\n    const contentInput = document.getElementById('contentInput');\n    let editingId = null;\n\n    async function api(path, options) {\n      const res = await fetch('/api' + path, {\n        headers: { 'Content-Type': 'application/json' },\n        ...options,\n      });\n      if (!res.ok) throw new Error('HTTP ' + res.status);\n      return res.json();\n    }\n\n    async function load() {\n      const notes = await api('/notes');\n      list.innerHTML = '';\n      if (notes.length === 0) {\n        list.innerHTML = '<div class=\"empty\">Noch keine Notizen \u2014 erstelle deine erste.</div>';\n        return;\n      }\n      for (const note of notes) {\n        const el = document.createElement('div');\n        el.className = 'note';\n        el.innerHTML = `\n          <h2></h2><p></p>\n          <time></time>\n          <div class=\"actions\">\n            <button data-act=\"edit\">Bearbeiten</button>\n            <button data-act=\"delete\" style=\"color:#f87171\">L\u00f6schen</button>\n          </div>`;\n        el.querySelector('h2').textContent = note.title;\n        el.querySelector('p').textContent = note.content || '';\n        el.querySelector('time').textContent = new Date(note.updated_at).toLocaleString();\n        el.querySelector('[data-act=\"edit\"]').onclick = () => edit(note);\n        el.querySelector('[data-act=\"delete\"]').onclick = async () => {\n          await api('/notes/' + note.id, { method: 'DELETE' });\n          load();\n        };\n        list.appendChild(el);\n      }\n    }\n\n    function edit(note) {\n      editingId = note.id;\n      titleInput.value = note.title;\n      contentInput.value = note.content || '';\n      editor.hidden = false;\n      titleInput.focus();\n    }\n\n    document.getElementById('newBtn').onclick = () => {\n      editingId = null;\n      titleInput.value = '';\n      contentInput.value = '';\n      editor.hidden = false;\n      titleInput.focus();\n    };\n    document.getElementById('cancelBtn').onclick = () => { editor.hidden = true; editingId = null; };\n    document.getElementById('saveBtn').onclick = async () => {\n      const body = { title: titleInput.value, content: contentInput.value };\n      if (editingId) await api('/notes/' + editingId, { method: 'PUT', body: JSON.stringify(body) });\n      else await api('/notes', { method: 'POST', body: JSON.stringify(body) });\n      editor.hidden = true;\n      editingId = null;\n      load();\n    };\n\n    load();\n  </script>\n</body>\n</html>\n",
      'build.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\necho "no build step needed."\n',
    }),
  },
  {
    id: "ora-shopping",
    name: "Einkaufsliste",
    developer: 'IORA Team',
    description: "Gemeinsame Einkaufsliste \u2013 Artikel mit Menge und Erledigt-H\u00e4kchen, gespeichert \u00fcber das ORA App Storage.",
    version: '1.0.0',
    category: "Haushalt",
    permissions: ['AppStorageRead', 'AppStorageWrite', 'AppStorageDelete', 'AppStorageManage'],
    iconUrl: svgIcon('#0ea5e9', "E"),
    buildZip: () => buildAppZip({
      'manifest.json': "{\n  \"id\": \"ora-shopping\",\n  \"name\": \"Einkaufsliste\",\n  \"version\": \"1.0.0\",\n  \"developer\": \"IORA Team\",\n  \"description\": \"Gemeinsame Einkaufsliste \u2013 Artikel mit Menge und Erledigt-H\u00e4kchen, gespeichert \u00fcber das ORA App Storage.\",\n  \"icon\": \"https://img.icons8.com/color/256/shopping-cart.png\",\n  \"type\": \"app\",\n  \"permissions\": [\n    \"AppStorageRead\",\n    \"AppStorageWrite\",\n    \"AppStorageDelete\",\n    \"AppStorageManage\"\n  ],\n  \"storage\": {\n    \"enabled\": true,\n    \"quota\": {\n      \"max_file_storage_bytes\": 5242880,\n      \"max_kv_entries\": 100,\n      \"max_file_size_bytes\": 1048576\n    }\n  },\n  \"custom_pages\": [\n    {\n      \"id\": \"ora-shopping-main\",\n      \"title\": \"Einkaufsliste\",\n      \"icon\": \"ShoppingCart\",\n      \"url\": \"/apps/ora-shopping/\",\n      \"show_in_nav\": true,\n      \"order\": 211\n    }\n  ],\n  \"docker\": {\n    \"auto_build\": true,\n    \"base_image\": \"node:18-alpine\",\n    \"working_dir\": \"/app\",\n    \"install_cmd\": \"npm install\",\n    \"start_cmd\": \"node server.js\",\n    \"internal_ports\": [\n      {\n        \"port\": 3000,\n        \"protocol\": \"tcp\",\n        \"description\": \"HTTP API und Web-UI\"\n      }\n    ],\n    \"environment\": {\n      \"NODE_ENV\": \"production\"\n    },\n    \"health_check\": {\n      \"endpoint\": \"/health\",\n      \"interval\": 30,\n      \"timeout\": 10,\n      \"retries\": 3\n    }\n  },\n  \"store_metadata\": {\n    \"category\": \"Haushalt\",\n    \"tags\": [\n      \"einkauf\",\n      \"liste\",\n      \"haushalt\"\n    ],\n    \"min_iora_version\": \"2.0.0\",\n    \"license\": \"MIT\"\n  }\n}",
      'server.js': "/**\n * ORA Shopping List \u2014 installable lifestyle app (Package 6).\n * Persists data via the ORA App Storage KV API using the app token.\n */\nconst express = require('express');\nconst path = require('path');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\nconst IORA_HOME = process.env.IORA_HOME_URL || 'http://iora-home:3001';\nconst APP_ID = process.env.IORA_APP_ID || 'ora-shopping';\nconst KV_KEY = 'items';\n\napp.use(express.json({ limit: '1mb' }));\napp.use(express.static(path.join(__dirname, 'public')));\n\nfunction headers() {\n  const h = { 'Content-Type': 'application/json' };\n  if (process.env.IORA_API_KEY) h['Authorization'] = 'Bearer ' + process.env.IORA_API_KEY;\n  return h;\n}\n\nasync function loadData() {\n  try {\n    const r = await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, { headers: headers() });\n    if (!r.ok) return [];\n    const data = await r.json();\n    return Array.isArray(data.value) ? data.value : [];\n  } catch { return []; }\n}\n\nasync function saveData(data) {\n  await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, {\n    method: 'PUT', headers: headers(),\n    body: JSON.stringify({ key: KV_KEY, value: data }),\n  });\n}\n\napp.get('/api/items', async (_req, res) => res.json(await loadData()));\napp.post('/api/items', async (req, res) => {\n  const items = await loadData();\n  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), created_at: new Date().toISOString(), ...(req.body || {}) };\n  items.push(item);\n  await saveData(items);\n  res.status(201).json(item);\n});\napp.put('/api/items/:id', async (req, res) => {\n  const items = await loadData();\n  const index = items.findIndex((i) => i.id === req.params.id);\n  if (index === -1) return res.status(404).json({ error: 'not found' });\n  items[index] = { ...items[index], ...(req.body || {}), updated_at: new Date().toISOString() };\n  await saveData(items);\n  res.json(items[index]);\n});\napp.delete('/api/items/:id', async (req, res) => {\n  const items = await loadData();\n  await saveData(items.filter((i) => i.id !== req.params.id));\n  res.json({ deleted: true });\n});\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\napp.listen(PORT, () => console.log(`ORA Shopping List listening on :${PORT} (storage via ${IORA_HOME})`));\n",
      'package.json': "{\n  \"name\": \"ora-shopping\",\n  \"version\": \"1.0.0\",\n  \"private\": true,\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\"\n  },\n  \"dependencies\": {\n    \"express\": \"^4.19.2\"\n  }\n}",
      'public/index.html': "<!DOCTYPE html>\n<html lang=\"de\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Einkaufsliste</title>\n<style>\n  *{box-sizing:border-box;margin:0;padding:0} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d12;color:#e5e7eb;min-height:100vh}\n  header{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,.08)} header h1{font-size:1.25rem;font-weight:600}\n  main{max-width:40rem;margin:0 auto;padding:1.5rem} .add{display:flex;gap:.5rem;margin-bottom:1.5rem}\n  .add input{flex:1;background:rgba(0,0,0,.3);color:#e5e7eb;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;padding:.7rem .9rem;font-size:.95rem}\n  .add button{background:#22d3ee;color:#082f36;border:none;border-radius:.75rem;padding:.7rem 1.2rem;font-weight:600;cursor:pointer}\n  .item{display:flex;align-items:center;gap:.75rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:.9rem;padding:.85rem 1rem;margin-bottom:.6rem}\n  .item input[type=checkbox]{width:1.1rem;height:1.1rem;accent-color:#22d3ee}\n  .item span{flex:1;font-size:.95rem} .item.done span{text-decoration:line-through;color:rgba(255,255,255,.35)}\n  .item .qty{color:rgba(255,255,255,.45);font-size:.8rem} .item button{background:none;border:none;color:#f87171;cursor:pointer;font-size:1rem}\n  .empty{text-align:center;color:rgba(255,255,255,.35);padding:3rem 0} .progress{font-size:.8rem;color:rgba(255,255,255,.45);margin-bottom:1rem}\n</style></head><body>\n<header><h1>\ud83d\uded2 Einkaufsliste</h1><span class=\"progress\" id=\"progress\"></span></header>\n<main>\n  <div class=\"add\"><input id=\"name\" placeholder=\"Artikel\u2026\" /><input id=\"qty\" placeholder=\"Menge\" style=\"width:6rem\" /><button onclick=\"addItem()\">Hinzuf\u00fcgen</button></div>\n  <div id=\"list\"></div>\n</main>\n<script>\n  async function api(p, o) { const r = await fetch('/api'+p, { headers: {'Content-Type':'application/json'}, ...o }); if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); }\n  async function load() {\n    const items = await api('/items');\n    const list = document.getElementById('list');\n    list.innerHTML = '';\n    const done = items.filter(i => i.done).length;\n    document.getElementById('progress').textContent = items.length ? done + ' / ' + items.length + ' erledigt' : '';\n    if (!items.length) { list.innerHTML = '<div class=\"empty\">Leere Liste \u2014 f\u00fcge Artikel hinzu.</div>'; return; }\n    for (const item of items) {\n      const el = document.createElement('div');\n      el.className = 'item' + (item.done ? ' done' : '');\n      el.innerHTML = '<input type=\"checkbox\" ' + (item.done ? 'checked' : '') + '><span></span><span class=\"qty\"></span><button>\u2715</button>';\n      el.querySelector('span').textContent = item.name;\n      el.querySelector('.qty').textContent = item.qty || '';\n      el.querySelector('input').onchange = async (e) => { await api('/items/'+item.id, { method:'PUT', body: JSON.stringify({ done: e.target.checked }) }); load(); };\n      el.querySelector('button').onclick = async () => { await api('/items/'+item.id, { method:'DELETE' }); load(); };\n      list.appendChild(el);\n    }\n  }\n  async function addItem() {\n    const name = document.getElementById('name').value.trim();\n    const qty = document.getElementById('qty').value.trim();\n    if (!name) return;\n    await api('/items', { method:'POST', body: JSON.stringify({ name, qty, done: false }) });\n    document.getElementById('name').value = ''; document.getElementById('qty').value = '';\n    load();\n  }\n  load();\n</script></body></html>\n",
      'build.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\necho "no build step needed."\n',
    }),
  },
  {
    id: "ora-calendar",
    name: "Kalender",
    developer: 'IORA Team',
    description: "Einfacher Familien-Kalender \u2013 Termine mit Datum und Uhrzeit, gespeichert \u00fcber das ORA App Storage.",
    version: '1.0.0',
    category: "Organisation",
    permissions: ['AppStorageRead', 'AppStorageWrite', 'AppStorageDelete', 'AppStorageManage'],
    iconUrl: svgIcon('#0ea5e9', "K"),
    buildZip: () => buildAppZip({
      'manifest.json': "{\n  \"id\": \"ora-calendar\",\n  \"name\": \"Kalender\",\n  \"version\": \"1.0.0\",\n  \"developer\": \"IORA Team\",\n  \"description\": \"Einfacher Familien-Kalender \u2013 Termine mit Datum und Uhrzeit, gespeichert \u00fcber das ORA App Storage.\",\n  \"icon\": \"https://img.icons8.com/color/256/calendar.png\",\n  \"type\": \"app\",\n  \"permissions\": [\n    \"AppStorageRead\",\n    \"AppStorageWrite\",\n    \"AppStorageDelete\",\n    \"AppStorageManage\"\n  ],\n  \"storage\": {\n    \"enabled\": true,\n    \"quota\": {\n      \"max_file_storage_bytes\": 5242880,\n      \"max_kv_entries\": 100,\n      \"max_file_size_bytes\": 1048576\n    }\n  },\n  \"custom_pages\": [\n    {\n      \"id\": \"ora-calendar-main\",\n      \"title\": \"Kalender\",\n      \"icon\": \"Calendar\",\n      \"url\": \"/apps/ora-calendar/\",\n      \"show_in_nav\": true,\n      \"order\": 212\n    }\n  ],\n  \"docker\": {\n    \"auto_build\": true,\n    \"base_image\": \"node:18-alpine\",\n    \"working_dir\": \"/app\",\n    \"install_cmd\": \"npm install\",\n    \"start_cmd\": \"node server.js\",\n    \"internal_ports\": [\n      {\n        \"port\": 3000,\n        \"protocol\": \"tcp\",\n        \"description\": \"HTTP API und Web-UI\"\n      }\n    ],\n    \"environment\": {\n      \"NODE_ENV\": \"production\"\n    },\n    \"health_check\": {\n      \"endpoint\": \"/health\",\n      \"interval\": 30,\n      \"timeout\": 10,\n      \"retries\": 3\n    }\n  },\n  \"store_metadata\": {\n    \"category\": \"Organisation\",\n    \"tags\": [\n      \"kalender\",\n      \"termin\",\n      \"familie\"\n    ],\n    \"min_iora_version\": \"2.0.0\",\n    \"license\": \"MIT\"\n  }\n}",
      'server.js': "/**\n * ORA Calendar \u2014 installable lifestyle app (Package 6).\n * Persists data via the ORA App Storage KV API using the app token.\n */\nconst express = require('express');\nconst path = require('path');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\nconst IORA_HOME = process.env.IORA_HOME_URL || 'http://iora-home:3001';\nconst APP_ID = process.env.IORA_APP_ID || 'ora-calendar';\nconst KV_KEY = 'events';\n\napp.use(express.json({ limit: '1mb' }));\napp.use(express.static(path.join(__dirname, 'public')));\n\nfunction headers() {\n  const h = { 'Content-Type': 'application/json' };\n  if (process.env.IORA_API_KEY) h['Authorization'] = 'Bearer ' + process.env.IORA_API_KEY;\n  return h;\n}\n\nasync function loadData() {\n  try {\n    const r = await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, { headers: headers() });\n    if (!r.ok) return [];\n    const data = await r.json();\n    return Array.isArray(data.value) ? data.value : [];\n  } catch { return []; }\n}\n\nasync function saveData(data) {\n  await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, {\n    method: 'PUT', headers: headers(),\n    body: JSON.stringify({ key: KV_KEY, value: data }),\n  });\n}\n\napp.get('/api/items', async (_req, res) => res.json(await loadData()));\napp.post('/api/items', async (req, res) => {\n  const items = await loadData();\n  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), created_at: new Date().toISOString(), ...(req.body || {}) };\n  items.push(item);\n  await saveData(items);\n  res.status(201).json(item);\n});\napp.put('/api/items/:id', async (req, res) => {\n  const items = await loadData();\n  const index = items.findIndex((i) => i.id === req.params.id);\n  if (index === -1) return res.status(404).json({ error: 'not found' });\n  items[index] = { ...items[index], ...(req.body || {}), updated_at: new Date().toISOString() };\n  await saveData(items);\n  res.json(items[index]);\n});\napp.delete('/api/items/:id', async (req, res) => {\n  const items = await loadData();\n  await saveData(items.filter((i) => i.id !== req.params.id));\n  res.json({ deleted: true });\n});\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\napp.listen(PORT, () => console.log(`ORA Calendar listening on :${PORT} (storage via ${IORA_HOME})`));\n",
      'package.json': "{\n  \"name\": \"ora-calendar\",\n  \"version\": \"1.0.0\",\n  \"private\": true,\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\"\n  },\n  \"dependencies\": {\n    \"express\": \"^4.19.2\"\n  }\n}",
      'public/index.html': "<!DOCTYPE html>\n<html lang=\"de\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Kalender</title>\n<style>\n  *{box-sizing:border-box;margin:0;padding:0} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d12;color:#e5e7eb;min-height:100vh}\n  header{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,.08)} header h1{font-size:1.25rem;font-weight:600}\n  main{max-width:42rem;margin:0 auto;padding:1.5rem} .add{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}\n  .add input,.add button{border-radius:.75rem;padding:.7rem .9rem;font-size:.9rem} .add input{background:rgba(0,0,0,.3);color:#e5e7eb;border:1px solid rgba(255,255,255,.1);flex:1;min-width:8rem}\n  .add input[type=date]{flex:0 0 auto;width:9.5rem} .add button{background:#22d3ee;color:#082f36;border:none;font-weight:600;cursor:pointer}\n  .day{margin-bottom:1.25rem} .day h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.45);margin-bottom:.5rem}\n  .event{display:flex;align-items:center;gap:.75rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:.9rem;padding:.85rem 1rem;margin-bottom:.5rem}\n  .event .time{color:#22d3ee;font-size:.85rem;min-width:3.2rem} .event span{flex:1;font-size:.95rem} .event button{background:none;border:none;color:#f87171;cursor:pointer}\n  .empty{text-align:center;color:rgba(255,255,255,.35);padding:3rem 0}\n</style></head><body>\n<header><h1>\ud83d\udcc5 Kalender</h1></header>\n<main>\n  <div class=\"add\"><input id=\"title\" placeholder=\"Termin\u2026\" /><input type=\"date\" id=\"date\" /><input type=\"time\" id=\"time\" value=\"18:00\" style=\"flex:0 0 auto;width:7rem\" /><button onclick=\"addEvent()\">Hinzuf\u00fcgen</button></div>\n  <div id=\"list\"></div>\n</main>\n<script>\n  async function api(p, o) { const r = await fetch('/api'+p, { headers: {'Content-Type':'application/json'}, ...o }); if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); }\n  async function load() {\n    const events = await api('/items');\n    const list = document.getElementById('list');\n    list.innerHTML = '';\n    const byDate = {};\n    for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);\n    const dates = Object.keys(byDate).sort();\n    if (!dates.length) { list.innerHTML = '<div class=\"empty\">Keine Termine \u2014 f\u00fcge deinen ersten hinzu.</div>'; return; }\n    for (const date of dates) {\n      const day = document.createElement('div'); day.className = 'day';\n      day.innerHTML = '<h2></h2>';\n      day.querySelector('h2').textContent = new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long' });\n      for (const e of byDate[date].sort((a,b) => (a.time||'').localeCompare(b.time||''))) {\n        const el = document.createElement('div'); el.className = 'event';\n        el.innerHTML = '<span class=\"time\"></span><span></span><button>\u2715</button>';\n        el.querySelector('.time').textContent = e.time || '';\n        el.querySelector('span').textContent = e.title;\n        el.querySelector('button').onclick = async () => { await api('/items/'+e.id, { method:'DELETE' }); load(); };\n        day.appendChild(el);\n      }\n      list.appendChild(day);\n    }\n  }\n  async function addEvent() {\n    const title = document.getElementById('title').value.trim();\n    const date = document.getElementById('date').value;\n    const time = document.getElementById('time').value;\n    if (!title || !date) return;\n    await api('/items', { method:'POST', body: JSON.stringify({ title, date, time }) });\n    document.getElementById('title').value = '';\n    load();\n  }\n  document.getElementById('date').valueAsDate = new Date();\n  load();\n</script></body></html>\n",
      'build.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\necho "no build step needed."\n',
    }),
  },
]
