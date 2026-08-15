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

/** Gamepad glyph on a space-blue tile for the Games category. */
function gamepadSvg(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0b0d1f"/>` +
    `</linearGradient></defs>` +
    `<rect width="64" height="64" rx="14" fill="url(#g)"/>` +
    `<circle cx="12" cy="12" r="1.4" fill="#fff" opacity="0.9"/>` +
    `<circle cx="22" cy="7" r="1" fill="#fff" opacity="0.6"/>` +
    `<circle cx="52" cy="10" r="1.2" fill="#fff" opacity="0.7"/>` +
    `<circle cx="57" cy="20" r="1" fill="#fff" opacity="0.5"/>` +
    `<path d="M12 28h40a10 10 0 0 1 10 10v6a10 10 0 0 1-10 10H12a10 10 0 0 1-10-10v-6a10 10 0 0 1 10-10z" fill="#22d3ee"/>` +
    `<rect x="15" y="37" width="10" height="3.4" rx="1.7" fill="#06252c"/>` +
    `<rect x="18.3" y="33.7" width="3.4" height="10" rx="1.7" fill="#06252c"/>` +
    `<circle cx="42" cy="38.5" r="2.6" fill="#06252c"/>` +
    `<circle cx="49" cy="43.5" r="2.6" fill="#06252c"/>` +
    `</svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/** Astro Forge — installable 3D idle mining game (Games category). */
const astroForgeManifest = {
  id: 'ora-astro-forge',
  name: 'Astro Forge',
  version: '1.0.0',
  developer: 'IORA Team',
  description: '3D-Idle-Game: Mine Asteroiden, baue deine Bohrflotte aus, erobere neue Planeten und prestigiere durch Wurmlöcher. Fortschritt wird über das ORA App Storage gespeichert — auch offline wird weiter gefördert.',
  icon: gamepadSvg(),
  type: 'app',
  permissions: ['AppStorageRead', 'AppStorageWrite', 'AppStorageDelete', 'AppStorageManage'],
  storage: {
    enabled: true,
    quota: {
      max_file_storage_bytes: 5242880,
      max_kv_entries: 100,
      max_file_size_bytes: 1048576,
    },
  },
  custom_pages: [
    {
      id: 'ora-astro-forge-main',
      title: 'Astro Forge',
      icon: 'GameController',
      url: '/apps/ora-astro-forge/',
      show_in_nav: true,
      order: 220,
    },
  ],
  docker: {
    auto_build: true,
    base_image: 'node:18-alpine',
    working_dir: '/app',
    install_cmd: 'npm install',
    start_cmd: 'node server.js',
    internal_ports: [
      {
        port: 3000,
        // Fixed host port from the app range (10000-20000): permanently
        // reserved for this app, never collides with the backend (3001)
        // or other apps.
        external: 19000,
        protocol: 'tcp',
        description: 'HTTP API und Web-UI',
      },
    ],
    environment: {
      NODE_ENV: 'production',
    },
    health_check: {
      endpoint: '/health',
      interval: 30,
      timeout: 10,
      retries: 3,
    },
  },
  store_metadata: {
    category: 'Games',
    tags: ['game', 'idle', '3d', 'space', 'mining'],
    screenshots: [],
    min_iora_version: '2.0.0',
    license: 'MIT',
  },
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
    openPort: 19001,
    buildZip: () => buildAppZip({
      'manifest.json': "{\n  \"id\": \"ora-notes\",\n  \"name\": \"Notizen\",\n  \"version\": \"1.0.0\",\n  \"developer\": \"IORA Team\",\n  \"description\": \"Einfache Notizen-App \u2013 jede Notiz wird \u00fcber das ORA App Storage (KV) gespeichert. Zeigt, wie eine installierbare App das App-Framework nutzt.\",\n  \"icon\": \"https://img.icons8.com/color/256/notebook.png\",\n  \"type\": \"app\",\n  \"permissions\": [\n    \"AppStorageRead\",\n    \"AppStorageWrite\",\n    \"AppStorageDelete\",\n    \"AppStorageManage\"\n  ],\n  \"storage\": {\n    \"enabled\": true,\n    \"quota\": {\n      \"max_file_storage_bytes\": 5242880,\n      \"max_kv_entries\": 100,\n      \"max_file_size_bytes\": 1048576\n    }\n  },\n  \"custom_pages\": [\n    {\n      \"id\": \"ora-notes-main\",\n      \"title\": \"Notizen\",\n      \"icon\": \"NotePencil\",\n      \"url\": \"/apps/ora-notes/\",\n      \"show_in_nav\": true,\n      \"order\": 210\n    }\n  ],\n  \"settings_schema\": {\n    \"title\": \"Notizen Einstellungen\",\n    \"description\": \"Einstellungen der Notizen-App\",\n    \"fields\": [\n      {\n        \"key\": \"sort_newest_first\",\n        \"label\": \"Neueste zuerst\",\n        \"description\": \"Neueste Notizen oben anzeigen\",\n        \"type\": \"boolean\",\n        \"default\": true\n      }\n    ]\n  },\n  \"docker\": {\n    \"auto_build\": true,\n    \"base_image\": \"node:18-alpine\",\n    \"working_dir\": \"/app\",\n    \"install_cmd\": \"npm install\",\n    \"start_cmd\": \"node server.js\",\n    \"internal_ports\": [\n      {\n        \"port\": 3000,\n        \"external\": 19001,\n        \"protocol\": \"tcp\",\n        \"description\": \"HTTP API und Web-UI\"\n      }\n    ],\n    \"environment\": {\n      \"NODE_ENV\": \"production\"\n    },\n    \"health_check\": {\n      \"endpoint\": \"/health\",\n      \"interval\": 30,\n      \"timeout\": 10,\n      \"retries\": 3\n    }\n  },\n  \"store_metadata\": {\n    \"category\": \"Produktivit\u00e4t\",\n    \"tags\": [\"notizen\", \"notes\", \"produktivit\u00e4t\"],\n    \"screenshots\": [],\n    \"min_iora_version\": \"2.0.0\",\n    \"homepage\": \"https://github.com/kaimdt/ora\",\n    \"source_url\": \"https://github.com/kaimdt/ora\",\n    \"license\": \"MIT\"\n  }\n}\n",
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
    openPort: 19002,
    buildZip: () => buildAppZip({
      'manifest.json': "{\n  \"id\": \"ora-shopping\",\n  \"name\": \"Einkaufsliste\",\n  \"version\": \"1.0.0\",\n  \"developer\": \"IORA Team\",\n  \"description\": \"Gemeinsame Einkaufsliste \u2013 Artikel mit Menge und Erledigt-H\u00e4kchen, gespeichert \u00fcber das ORA App Storage.\",\n  \"icon\": \"https://img.icons8.com/color/256/shopping-cart.png\",\n  \"type\": \"app\",\n  \"permissions\": [\n    \"AppStorageRead\",\n    \"AppStorageWrite\",\n    \"AppStorageDelete\",\n    \"AppStorageManage\"\n  ],\n  \"storage\": {\n    \"enabled\": true,\n    \"quota\": {\n      \"max_file_storage_bytes\": 5242880,\n      \"max_kv_entries\": 100,\n      \"max_file_size_bytes\": 1048576\n    }\n  },\n  \"custom_pages\": [\n    {\n      \"id\": \"ora-shopping-main\",\n      \"title\": \"Einkaufsliste\",\n      \"icon\": \"ShoppingCart\",\n      \"url\": \"/apps/ora-shopping/\",\n      \"show_in_nav\": true,\n      \"order\": 211\n    }\n  ],\n  \"docker\": {\n    \"auto_build\": true,\n    \"base_image\": \"node:18-alpine\",\n    \"working_dir\": \"/app\",\n    \"install_cmd\": \"npm install\",\n    \"start_cmd\": \"node server.js\",\n    \"internal_ports\": [\n      {\n        \"port\": 3000,\n        \"external\": 19002,\n        \"protocol\": \"tcp\",\n        \"description\": \"HTTP API und Web-UI\"\n      }\n    ],\n    \"environment\": {\n      \"NODE_ENV\": \"production\"\n    },\n    \"health_check\": {\n      \"endpoint\": \"/health\",\n      \"interval\": 30,\n      \"timeout\": 10,\n      \"retries\": 3\n    }\n  },\n  \"store_metadata\": {\n    \"category\": \"Haushalt\",\n    \"tags\": [\n      \"einkauf\",\n      \"liste\",\n      \"haushalt\"\n    ],\n    \"min_iora_version\": \"2.0.0\",\n    \"license\": \"MIT\"\n  }\n}",
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
    openPort: 19003,
    buildZip: () => buildAppZip({
      'manifest.json': "{\n  \"id\": \"ora-calendar\",\n  \"name\": \"Kalender\",\n  \"version\": \"1.0.0\",\n  \"developer\": \"IORA Team\",\n  \"description\": \"Einfacher Familien-Kalender \u2013 Termine mit Datum und Uhrzeit, gespeichert \u00fcber das ORA App Storage.\",\n  \"icon\": \"https://img.icons8.com/color/256/calendar.png\",\n  \"type\": \"app\",\n  \"permissions\": [\n    \"AppStorageRead\",\n    \"AppStorageWrite\",\n    \"AppStorageDelete\",\n    \"AppStorageManage\"\n  ],\n  \"storage\": {\n    \"enabled\": true,\n    \"quota\": {\n      \"max_file_storage_bytes\": 5242880,\n      \"max_kv_entries\": 100,\n      \"max_file_size_bytes\": 1048576\n    }\n  },\n  \"custom_pages\": [\n    {\n      \"id\": \"ora-calendar-main\",\n      \"title\": \"Kalender\",\n      \"icon\": \"Calendar\",\n      \"url\": \"/apps/ora-calendar/\",\n      \"show_in_nav\": true,\n      \"order\": 212\n    }\n  ],\n  \"docker\": {\n    \"auto_build\": true,\n    \"base_image\": \"node:18-alpine\",\n    \"working_dir\": \"/app\",\n    \"install_cmd\": \"npm install\",\n    \"start_cmd\": \"node server.js\",\n    \"internal_ports\": [\n      {\n        \"port\": 3000,\n        \"external\": 19003,\n        \"protocol\": \"tcp\",\n        \"description\": \"HTTP API und Web-UI\"\n      }\n    ],\n    \"environment\": {\n      \"NODE_ENV\": \"production\"\n    },\n    \"health_check\": {\n      \"endpoint\": \"/health\",\n      \"interval\": 30,\n      \"timeout\": 10,\n      \"retries\": 3\n    }\n  },\n  \"store_metadata\": {\n    \"category\": \"Organisation\",\n    \"tags\": [\n      \"kalender\",\n      \"termin\",\n      \"familie\"\n    ],\n    \"min_iora_version\": \"2.0.0\",\n    \"license\": \"MIT\"\n  }\n}",
      'server.js': "/**\n * ORA Calendar \u2014 installable lifestyle app (Package 6).\n * Persists data via the ORA App Storage KV API using the app token.\n */\nconst express = require('express');\nconst path = require('path');\n\nconst app = express();\nconst PORT = process.env.PORT || 3000;\nconst IORA_HOME = process.env.IORA_HOME_URL || 'http://iora-home:3001';\nconst APP_ID = process.env.IORA_APP_ID || 'ora-calendar';\nconst KV_KEY = 'events';\n\napp.use(express.json({ limit: '1mb' }));\napp.use(express.static(path.join(__dirname, 'public')));\n\nfunction headers() {\n  const h = { 'Content-Type': 'application/json' };\n  if (process.env.IORA_API_KEY) h['Authorization'] = 'Bearer ' + process.env.IORA_API_KEY;\n  return h;\n}\n\nasync function loadData() {\n  try {\n    const r = await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, { headers: headers() });\n    if (!r.ok) return [];\n    const data = await r.json();\n    return Array.isArray(data.value) ? data.value : [];\n  } catch { return []; }\n}\n\nasync function saveData(data) {\n  await fetch(`${IORA_HOME}/api/apps/${APP_ID}/storage/kv/${KV_KEY}`, {\n    method: 'PUT', headers: headers(),\n    body: JSON.stringify({ key: KV_KEY, value: data }),\n  });\n}\n\napp.get('/api/items', async (_req, res) => res.json(await loadData()));\napp.post('/api/items', async (req, res) => {\n  const items = await loadData();\n  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), created_at: new Date().toISOString(), ...(req.body || {}) };\n  items.push(item);\n  await saveData(items);\n  res.status(201).json(item);\n});\napp.put('/api/items/:id', async (req, res) => {\n  const items = await loadData();\n  const index = items.findIndex((i) => i.id === req.params.id);\n  if (index === -1) return res.status(404).json({ error: 'not found' });\n  items[index] = { ...items[index], ...(req.body || {}), updated_at: new Date().toISOString() };\n  await saveData(items);\n  res.json(items[index]);\n});\napp.delete('/api/items/:id', async (req, res) => {\n  const items = await loadData();\n  await saveData(items.filter((i) => i.id !== req.params.id));\n  res.json({ deleted: true });\n});\napp.get('/health', (_req, res) => res.json({ status: 'ok' }));\napp.listen(PORT, () => console.log(`ORA Calendar listening on :${PORT} (storage via ${IORA_HOME})`));\n",
      'package.json': "{\n  \"name\": \"ora-calendar\",\n  \"version\": \"1.0.0\",\n  \"private\": true,\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\"\n  },\n  \"dependencies\": {\n    \"express\": \"^4.19.2\"\n  }\n}",
      'public/index.html': "<!DOCTYPE html>\n<html lang=\"de\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Kalender</title>\n<style>\n  *{box-sizing:border-box;margin:0;padding:0} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d12;color:#e5e7eb;min-height:100vh}\n  header{display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,.08)} header h1{font-size:1.25rem;font-weight:600}\n  main{max-width:42rem;margin:0 auto;padding:1.5rem} .add{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}\n  .add input,.add button{border-radius:.75rem;padding:.7rem .9rem;font-size:.9rem} .add input{background:rgba(0,0,0,.3);color:#e5e7eb;border:1px solid rgba(255,255,255,.1);flex:1;min-width:8rem}\n  .add input[type=date]{flex:0 0 auto;width:9.5rem} .add button{background:#22d3ee;color:#082f36;border:none;font-weight:600;cursor:pointer}\n  .day{margin-bottom:1.25rem} .day h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.45);margin-bottom:.5rem}\n  .event{display:flex;align-items:center;gap:.75rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:.9rem;padding:.85rem 1rem;margin-bottom:.5rem}\n  .event .time{color:#22d3ee;font-size:.85rem;min-width:3.2rem} .event span{flex:1;font-size:.95rem} .event button{background:none;border:none;color:#f87171;cursor:pointer}\n  .empty{text-align:center;color:rgba(255,255,255,.35);padding:3rem 0}\n</style></head><body>\n<header><h1>\ud83d\udcc5 Kalender</h1></header>\n<main>\n  <div class=\"add\"><input id=\"title\" placeholder=\"Termin\u2026\" /><input type=\"date\" id=\"date\" /><input type=\"time\" id=\"time\" value=\"18:00\" style=\"flex:0 0 auto;width:7rem\" /><button onclick=\"addEvent()\">Hinzuf\u00fcgen</button></div>\n  <div id=\"list\"></div>\n</main>\n<script>\n  async function api(p, o) { const r = await fetch('/api'+p, { headers: {'Content-Type':'application/json'}, ...o }); if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); }\n  async function load() {\n    const events = await api('/items');\n    const list = document.getElementById('list');\n    list.innerHTML = '';\n    const byDate = {};\n    for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);\n    const dates = Object.keys(byDate).sort();\n    if (!dates.length) { list.innerHTML = '<div class=\"empty\">Keine Termine \u2014 f\u00fcge deinen ersten hinzu.</div>'; return; }\n    for (const date of dates) {\n      const day = document.createElement('div'); day.className = 'day';\n      day.innerHTML = '<h2></h2>';\n      day.querySelector('h2').textContent = new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday:'long', day:'numeric', month:'long' });\n      for (const e of byDate[date].sort((a,b) => (a.time||'').localeCompare(b.time||''))) {\n        const el = document.createElement('div'); el.className = 'event';\n        el.innerHTML = '<span class=\"time\"></span><span></span><button>\u2715</button>';\n        el.querySelector('.time').textContent = e.time || '';\n        el.querySelector('span').textContent = e.title;\n        el.querySelector('button').onclick = async () => { await api('/items/'+e.id, { method:'DELETE' }); load(); };\n        day.appendChild(el);\n      }\n      list.appendChild(day);\n    }\n  }\n  async function addEvent() {\n    const title = document.getElementById('title').value.trim();\n    const date = document.getElementById('date').value;\n    const time = document.getElementById('time').value;\n    if (!title || !date) return;\n    await api('/items', { method:'POST', body: JSON.stringify({ title, date, time }) });\n    document.getElementById('title').value = '';\n    load();\n  }\n  document.getElementById('date').valueAsDate = new Date();\n  load();\n</script></body></html>\n",
      'build.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\necho "no build step needed."\n',
    }),
  },
  {
    id: 'ora-astro-forge',
    name: 'Astro Forge',
    developer: 'IORA Team',
    description: '3D-Idle-Game: Mine Asteroiden, baue deine Bohrflotte aus, erobere neue Planeten und prestigiere durch Wurmlöcher. Fortschritt wird über das ORA App Storage gespeichert — auch offline wird weiter gefördert.',
    version: '1.0.0',
    category: 'Games',
    permissions: ['AppStorageRead', 'AppStorageWrite', 'AppStorageDelete', 'AppStorageManage'],
    iconUrl: gamepadSvg(),
    openPort: 19000,
    buildZip: () => buildAppZip({
      'manifest.json': JSON.stringify(astroForgeManifest, null, 2),
      'server.js': `/**
 * Astro Forge — installable 3D idle mining game.
 *
 * The game itself is a static web app; this Express server only relays the
 * savegame between the browser and the ORA App Storage KV API
 * (GET/PUT /api/apps/<app-id>/storage/kv/savegame) using the app token
 * injected by the supervisor. The app never talks to the ORA database
 * directly — only through the app-scoped storage API.
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IORA_HOME = process.env.IORA_HOME_URL || 'http://iora-home:3001';
const APP_ID = process.env.IORA_APP_ID || 'ora-astro-forge';
const KV_KEY = 'savegame';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.IORA_API_KEY) h['Authorization'] = 'Bearer ' + process.env.IORA_API_KEY;
  return h;
}

app.get('/api/save', async (_req, res) => {
  try {
    const r = await fetch(IORA_HOME + '/api/apps/' + APP_ID + '/storage/kv/' + KV_KEY, { headers: headers() });
    if (!r.ok) return res.json(null);
    const data = await r.json();
    return res.json(data && data.value !== undefined ? data.value : null);
  } catch {
    return res.json(null);
  }
});

app.put('/api/save', async (req, res) => {
  try {
    const r = await fetch(IORA_HOME + '/api/apps/' + APP_ID + '/storage/kv/' + KV_KEY, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ key: KV_KEY, value: req.body || {} }),
    });
    if (!r.ok) return res.status(502).json({ error: 'storage error' });
    return res.json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'storage unavailable' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log('Astro Forge listening on :' + PORT + ' (storage via ' + IORA_HOME + ')');
});
`,
      'package.json': JSON.stringify({
        name: 'ora-astro-forge',
        version: '1.0.0',
        private: true,
        main: 'server.js',
        scripts: { start: 'node server.js' },
        dependencies: { express: '^4.19.2' },
      }, null, 2),
      'build.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\necho "no build step needed."\n',
      'public/index.html': `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Astro Forge</title>
<style>
  :root { color-scheme: dark; --acc:#22d3ee; --ore:#c9a06b; --cry:#c4b5fd; --dm:#f59e0b; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #05060f; color: #e5e7eb; overflow: hidden; }
  header { position: fixed; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; background: rgba(9,11,20,0.75); backdrop-filter: blur(10px); border-bottom: 1px solid rgba(255,255,255,0.07); z-index: 20; }
  header h1 { font-size: 1.05rem; font-weight: 700; letter-spacing: 0.02em; display: flex; align-items: center; gap: 9px; }
  header .planet { font-size: 0.78rem; color: rgba(255,255,255,0.55); border: 1px solid rgba(255,255,255,0.12); border-radius: 999px; padding: 4px 12px; }
  #stage { position: fixed; top: 52px; bottom: 0; left: 0; right: 360px; cursor: crosshair; }
  #stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: manipulation; }
  #floatLayer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .floater { position: absolute; font-weight: 700; font-size: 0.95rem; color: #fcd34d; text-shadow: 0 1px 6px rgba(0,0,0,0.6); animation: floatUp 1s ease-out forwards; white-space: nowrap; }
  @keyframes floatUp { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-46px); opacity: 0; } }
  #hud { position: absolute; top: 14px; left: 14px; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
  .chip { display: flex; align-items: center; gap: 8px; background: rgba(9,11,20,0.62); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; padding: 7px 12px; font-size: 0.88rem; }
  .chip .val { font-weight: 700; font-variant-numeric: tabular-nums; }
  .chip .rate { color: rgba(255,255,255,0.45); font-size: 0.72rem; margin-left: 2px; }
  #hint { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); font-size: 0.75rem; color: rgba(255,255,255,0.4); pointer-events: none; }
  #panel { position: fixed; top: 52px; bottom: 0; right: 0; width: 360px; background: rgba(9,11,20,0.72); backdrop-filter: blur(12px); border-left: 1px solid rgba(255,255,255,0.07); display: flex; flex-direction: column; z-index: 10; }
  #tabs { display: flex; gap: 4px; padding: 10px 12px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
  #tabs button { flex: 1; background: none; border: none; color: rgba(255,255,255,0.5); font-size: 0.72rem; padding: 8px 2px; cursor: pointer; border-radius: 8px 8px 0 0; border-bottom: 2px solid transparent; transition: color 0.15s; }
  #tabs button.on { color: #e5e7eb; border-bottom-color: var(--acc); }
  #tabBody { flex: 1; overflow-y: auto; padding: 12px; }
  .row { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; }
  .row .info { flex: 1; min-width: 0; }
  .row .name { font-size: 0.86rem; font-weight: 600; }
  .row .desc { font-size: 0.72rem; color: rgba(255,255,255,0.45); margin-top: 2px; }
  .row .cost { font-size: 0.74rem; color: var(--ore); margin-top: 3px; font-variant-numeric: tabular-nums; }
  .row .owned { font-size: 0.7rem; color: rgba(255,255,255,0.4); margin-top: 2px; }
  .btn { border: none; border-radius: 9px; padding: 8px 12px; font-size: 0.78rem; font-weight: 700; cursor: pointer; background: linear-gradient(135deg, #22d3ee, #0891b2); color: #06252c; white-space: nowrap; transition: filter 0.15s, transform 0.1s; }
  .btn:hover { filter: brightness(1.12); }
  .btn:active { transform: scale(0.96); }
  .btn.off { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.32); cursor: default; }
  .btn.violet { background: linear-gradient(135deg, #a78bfa, #6d28d9); color: #1a0b3a; }
  .qty { display: flex; gap: 4px; margin-bottom: 10px; }
  .qty button { flex: 1; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 5px; font-size: 0.72rem; cursor: pointer; }
  .qty button.on { background: rgba(34,211,238,0.15); color: var(--acc); border-color: rgba(34,211,238,0.4); }
  .section { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.35); margin: 12px 2px 8px; }
  #stats { border-top: 1px solid rgba(255,255,255,0.07); padding: 10px 14px; font-size: 0.7rem; color: rgba(255,255,255,0.4); display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; }
  #stats button { margin-left: auto; background: none; border: 1px solid rgba(248,113,113,0.35); color: #f87171; border-radius: 8px; padding: 4px 10px; font-size: 0.7rem; cursor: pointer; }
  #offlineModal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(2,3,8,0.72); backdrop-filter: blur(6px); z-index: 50; }
  #offlineModal .box { background: #10131f; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 22px 26px; max-width: 380px; text-align: center; }
  #offlineModal h2 { font-size: 1rem; margin-bottom: 8px; }
  #offlineModal p { font-size: 0.85rem; color: rgba(255,255,255,0.6); margin-bottom: 6px; }
  #offlineModal .gain { font-size: 1.3rem; font-weight: 800; color: #fcd34d; margin: 10px 0 16px; }
  @media (max-width: 920px) {
    #stage { right: 0; bottom: 46%; }
    #panel { top: auto; width: 100%; height: 46%; border-left: none; border-top: 1px solid rgba(255,255,255,0.07); }
  }
</style>
</head>
<body>
<header>
  <h1><span id="logo"></span>Astro Forge</h1>
  <span class="planet" id="planetName">Asteroid</span>
</header>
<div id="stage">
  <canvas id="gl"></canvas>
  <div id="floatLayer"></div>
  <div id="hud">
    <div class="chip"><span id="oreIcon"></span><span class="val" id="oreVal">0</span><span class="rate" id="oreRate"></span></div>
    <div class="chip"><span id="cryIcon"></span><span class="val" id="cryVal">0</span></div>
    <div class="chip"><span id="dmIcon"></span><span class="val" id="dmVal">0</span><span class="rate" id="dmRate"></span></div>
  </div>
  <div id="hint">Klicke auf den Asteroiden, um Erz abzubauen</div>
</div>
<div id="panel">
  <div id="tabs">
    <button data-tab="prod" class="on">Produktion</button>
    <button data-tab="up">Upgrades</button>
    <button data-tab="planet">Planeten</button>
    <button data-tab="crystal">Kristalle</button>
    <button data-tab="prestige">Prestige</button>
  </div>
  <div id="tabBody"></div>
  <div id="stats"><span id="statsText"></span><button id="resetBtn">Spielstand löschen</button></div>
</div>
<div id="offlineModal" hidden>
  <div class="box">
    <h2>Willkommen zurück</h2>
    <p id="offlineText"></p>
    <div class="gain" id="offlineGain"></div>
    <button class="btn" id="offlineOk">Übernehmen</button>
  </div>
</div>
<script>
'use strict';
/* ============ Astro Forge — 3D Idle Mining Game ============ */
var canvas = document.getElementById('gl');
var floatLayer = document.getElementById('floatLayer');
var oreVal = document.getElementById('oreVal');
var oreRateEl = document.getElementById('oreRate');
var cryVal = document.getElementById('cryVal');
var dmVal = document.getElementById('dmVal');
var dmRateEl = document.getElementById('dmRate');
var planetName = document.getElementById('planetName');
var tabBody = document.getElementById('tabBody');
var statsText = document.getElementById('statsText');
var offlineModal = document.getElementById('offlineModal');
var offlineText = document.getElementById('offlineText');
var offlineGainEl = document.getElementById('offlineGain');

/* ---------- number formatting ---------- */
var fmtUnits = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
function fmt(n) {
  if (!isFinite(n)) return 'Unendlich';
  if (n < 0) return '-' + fmt(-n);
  if (n < 1000) {
    if (n < 100 && n % 1 !== 0) return n.toFixed(1);
    return Math.floor(n).toString();
  }
  var i = 0, u = '';
  while (n >= 1000 && i < fmtUnits.length - 1) { n /= 1000; i++; u = fmtUnits[i]; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.floor(n).toString()) + ' ' + u;
}
function fmtTime(s) {
  s = Math.floor(s);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  if (m > 0) return m + 'm ' + sec + 's';
  return sec + 's';
}

/* ---------- inline icons (no external assets) ---------- */
function oreIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3 18.5 9 16 20 8 20 5.5 9Z" fill="#c9a06b"/><path d="M12 3 5.5 9 12 11Z" fill="#e2bb85"/><path d="M12 3 18.5 9 12 11Z" fill="#8a6a45"/></svg>'; }
function crystalIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 2 20 9 12 22 4 9Z" fill="#8b5cf6"/><path d="M12 2 20 9 12 12Z" fill="#c4b5fd"/><path d="M4 9 12 12 12 22Z" fill="#a78bfa"/></svg>'; }
function dmIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#f59e0b" stroke-width="2.4"/><circle cx="12" cy="12" r="3.6" fill="#f59e0b"/></svg>'; }
function logoIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#22d3ee"/><ellipse cx="12" cy="12" rx="10.5" ry="3.8" fill="none" stroke="#22d3ee" stroke-width="1.5" opacity="0.85" transform="rotate(-18 12 12)"/></svg>'; }
document.getElementById('oreIcon').innerHTML = oreIcon();
document.getElementById('cryIcon').innerHTML = crystalIcon();
document.getElementById('dmIcon').innerHTML = dmIcon();
document.getElementById('logo').innerHTML = logoIcon();

/* ---------- game data ---------- */
var TIERS = [
  { name: 'Asteroid', cost: 0, mult: 1, radius: 1.0, amp: 0.30, freq: 3.2, sub: 3, colors: ['#8a7f72', '#6f6658', '#a99c8a'], banded: false, ring: false, bg: [0.010, 0.012, 0.030] },
  { name: 'Mond', cost: 250000, mult: 2.5, radius: 1.05, amp: 0.13, freq: 4.0, sub: 3, colors: ['#b8bcc2', '#8f949d', '#d6d9de'], banded: false, ring: false, bg: [0.012, 0.014, 0.035] },
  { name: 'Mars', cost: 2500000, mult: 6, radius: 1.1, amp: 0.17, freq: 3.0, sub: 3, colors: ['#b3541e', '#8c3a12', '#d97a3a'], banded: false, ring: false, bg: [0.030, 0.012, 0.010] },
  { name: 'Venus', cost: 25000000, mult: 15, radius: 1.12, amp: 0.09, freq: 2.0, sub: 3, colors: ['#d9a441', '#b57a26', '#f0c96a'], banded: false, ring: false, bg: [0.028, 0.016, 0.008] },
  { name: 'Terra', cost: 250000000, mult: 40, radius: 1.15, amp: 0.12, freq: 2.6, sub: 3, colors: ['#2e7d5b', '#1e5a9e', '#3fae7c'], banded: false, ring: false, bg: [0.010, 0.020, 0.032] },
  { name: 'Gasriese', cost: 2500000000, mult: 100, radius: 1.30, amp: 0.03, freq: 1.0, sub: 3, colors: ['#c98d4b', '#a86a34', '#e8c9a0'], banded: true, ring: true, bg: [0.030, 0.020, 0.012] },
  { name: 'Eiswelt', cost: 25000000000, mult: 250, radius: 1.15, amp: 0.14, freq: 3.6, sub: 3, colors: ['#7fd4e8', '#4fa8c9', '#c9f2fb'], banded: false, ring: false, bg: [0.010, 0.024, 0.040] },
  { name: 'Kristallwelt', cost: 250000000000, mult: 650, radius: 1.2, amp: 0.20, freq: 4.4, sub: 3, colors: ['#8b5cf6', '#6d28d9', '#c4b5fd'], banded: false, ring: false, bg: [0.022, 0.010, 0.042] },
  { name: 'Diamantkern', cost: 2500000000000, mult: 1600, radius: 1.1, amp: 0.07, freq: 5.0, sub: 3, colors: ['#93c5fd', '#dbeafe', '#60a5fa'], banded: false, ring: true, bg: [0.016, 0.026, 0.046] },
  { name: 'Neutronenstern', cost: 25000000000000, mult: 4000, radius: 0.9, amp: 0.03, freq: 6.0, sub: 3, colors: ['#fbbf24', '#f59e0b', '#fde68a'], banded: false, ring: false, bg: [0.040, 0.026, 0.008] },
  { name: 'Singularität', cost: 250000000000000, mult: 10000, radius: 0.85, amp: 0.02, freq: 8.0, sub: 3, colors: ['#0b0b14', '#151a2c', '#232a44'], banded: false, ring: true, bg: [0.008, 0.006, 0.020] }
];
var BLD = [
  { name: 'Bohr-Drohne', base: 15, rate: 0.1, desc: 'Autonome Drohne, fördert Erz pro Sekunde' },
  { name: 'Bohr-Roboter', base: 100, rate: 1, desc: 'Schwerer Minenroboter mit Laserkopf' },
  { name: 'Fusionsreaktor', base: 1100, rate: 8, desc: 'Energie für die gesamte Bohrflotte' },
  { name: 'Quantenbohrer', base: 12000, rate: 47, desc: 'Bohrt auf Quantenebene durchs Gestein' },
  { name: 'Orbital-Raffinerie', base: 130000, rate: 260, desc: 'Verarbeitet Erz direkt im Orbit' },
  { name: 'Asteroidenfänger', base: 1400000, rate: 1400, desc: 'Schleppt ganze Asteroiden zur Verarbeitung' },
  { name: 'Antimaterie-Kern', base: 20000000, rate: 7800, desc: 'Annihilationsreaktor, riesige Ausbeute' },
  { name: 'Dyson-Segment', base: 330000000, rate: 44000, desc: 'Erntet die Energie eines ganzen Sterns' }
];
var UP = [
  { name: 'Bohrkopf-Verstärkung', desc: 'Verdoppelt deine Klick-Ausbeute', base: 100, growth: 5, max: 8 },
  { name: 'Effizienz-Protokolle', desc: 'Verdoppelt die gesamte Produktion', base: 1000, growth: 10, max: 8 },
  { name: 'Kritische Detonation', desc: '10% Chance auf 10-fache Klick-Ausbeute', base: 25000, growth: 1, max: 1 },
  { name: 'Offline-Protokolle', desc: '+25% Offline-Ertrag (Basis 50%)', base: 5000, growth: 20, max: 3 }
];
var CUP = [
  { name: 'Kristall-Turbinen', desc: 'Verdoppelt die gesamte Produktion', costs: [1, 3, 9, 27] },
  { name: 'Kristall-Spitzen', desc: 'Verdoppelt deine Klick-Ausbeute', costs: [1, 3, 9, 27] },
  { name: 'Glücks-Magnet', desc: '+50% Chance auf Kristallfunde', costs: [2, 8, 32, 128] },
  { name: 'Tiefschlaf-Reaktor', desc: '+4 Stunden Offline-Dauer', costs: [3, 15, 75, 375] }
];
var GROWTH = 1.15;
var PRESTIGE_REQ = 1e10;

/* ---------- game state ---------- */
var S = null;
function freshState() {
  return { v: 1, ore: 0, crystals: 0, darkMatter: 0, totalOre: 0, clicks: 0, playtime: 0, planet: 0, buildings: [0, 0, 0, 0, 0, 0, 0, 0], upgrades: [0, 0, 0, 0], crystalUp: [0, 0, 0, 0], lastSave: Date.now() };
}
function planetMult() { return TIERS[S.planet].mult; }
function prodMult() {
  return Math.pow(2, S.upgrades[1]) * Math.pow(2, S.crystalUp[0]) * planetMult() * (1 + S.darkMatter * 0.02);
}
function prodRate() {
  var sum = 0;
  for (var i = 0; i < BLD.length; i++) sum += S.buildings[i] * BLD[i].rate;
  return sum * prodMult();
}
function clickPower() { return Math.pow(2, S.upgrades[0]) * Math.pow(2, S.crystalUp[1]); }
function offlineCap() { return 28800 + S.crystalUp[3] * 14400; }
function offlineMult() { return 0.5 + S.upgrades[3] * 0.25; }
function crystalLuck() { return 1 + S.crystalUp[2] * 0.5; }
function buildingCost(i, n, owned) {
  var c = 0;
  for (var j = 0; j < n; j++) c += BLD[i].base * Math.pow(GROWTH, owned + j);
  return c;
}
function maxAffordable(i) {
  var inside = S.ore * (GROWTH - 1) / (BLD[i].base * Math.pow(GROWTH, S.buildings[i])) + 1;
  if (inside < GROWTH) return 0;
  return Math.floor(Math.log(inside) / Math.log(GROWTH));
}
function upgradeCost(i) { return UP[i].base * Math.pow(UP[i].growth, S.upgrades[i]); }
function prestigeGain() { return Math.floor(Math.sqrt(S.totalOre / PRESTIGE_REQ)); }

/* ---------- WebGL helpers ---------- */
var gl = null;
var meshProgram, pointProgram;
var aMeshPos, aMeshNrm, aMeshCol, uMeshMVP, uMeshModel, uMeshLight1, uMeshLight2, uMeshCam, uMeshAlpha;
var aPointPos, aPointCol, aPointSize, uPointMVP;
var starMesh, planetMesh, ringMesh, droneMesh, particleBuf;
var currentVP = null;
var particles = [];
var camPar = { x: 0, y: 0 };
var camCur = { x: 0, y: 0 };
var rot = 0, time = 0;
var qty = 1, currentTab = 'prod', dirty = true;
var L1 = [0.5, 0.76, 0.42];
var L2 = [-0.62, 0.18, 0.52];

var MESH_VS = 'attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; uniform mat4 uMVP; uniform mat4 uModel; uniform vec3 uLight1; uniform vec3 uLight2; uniform vec3 uCam; varying vec3 vCol; void main() { vec3 wp = (uModel * vec4(aPos, 1.0)).xyz; vec3 n = normalize(mat3(uModel) * aNrm); float d1 = max(dot(n, uLight1), 0.0); float d2 = max(dot(n, uLight2), 0.0); float rim = pow(1.0 - max(dot(n, normalize(uCam - wp)), 0.0), 2.5) * 0.35; float l = clamp(0.32 + d1 * 0.72 + d2 * 0.22 + rim, 0.0, 1.35); vCol = aCol * l; gl_Position = uMVP * vec4(aPos, 1.0); }';
var MESH_FS = 'precision mediump float; varying vec3 vCol; uniform float uAlpha; void main() { gl_FragColor = vec4(vCol, uAlpha); }';
var POINT_VS = 'attribute vec3 aPos; attribute vec4 aCol; attribute float aSize; uniform mat4 uMVP; varying vec4 vCol; void main() { vCol = aCol; gl_PointSize = aSize; gl_Position = uMVP * vec4(aPos, 1.0); }';
var POINT_FS = 'precision mediump float; varying vec4 vCol; void main() { vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; gl_FragColor = vCol; }';

function m4mul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) {
    for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}
function m4persp(fovy, aspect, near, far) {
  var f = 1 / Math.tan(fovy / 2);
  var nf = 1 / (near - far);
  var o = new Array(16);
  for (var i = 0; i < 16; i++) o[i] = 0;
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) * nf; o[11] = -1;
  o[14] = 2 * far * near * nf;
  return o;
}
function m4translate(x, y, z) {
  var o = new Array(16);
  for (var i = 0; i < 16; i++) o[i] = 0;
  o[0] = 1; o[5] = 1; o[10] = 1; o[15] = 1;
  o[12] = x; o[13] = y; o[14] = z;
  return o;
}
function m4scale(x, y, z) {
  var o = new Array(16);
  for (var i = 0; i < 16; i++) o[i] = 0;
  o[0] = x; o[5] = y; o[10] = z; o[15] = 1;
  return o;
}
function m4rotX(a) {
  var c = Math.cos(a), s = Math.sin(a);
  var o = new Array(16);
  for (var i = 0; i < 16; i++) o[i] = 0;
  o[0] = 1; o[5] = c; o[6] = s; o[9] = -s; o[10] = c; o[15] = 1;
  return o;
}
function m4rotY(a) {
  var c = Math.cos(a), s = Math.sin(a);
  var o = new Array(16);
  for (var i = 0; i < 16; i++) o[i] = 0;
  o[0] = c; o[2] = -s; o[5] = 1; o[8] = s; o[10] = c; o[15] = 1;
  return o;
}
function m4lookAt(eye, center, up) {
  var zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  var o = new Array(16);
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}
function m4invert(m) {
  var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  var a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  var a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  var a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  var b00 = a00 * a11 - a01 * a10;
  var b01 = a00 * a12 - a02 * a10;
  var b02 = a00 * a13 - a03 * a10;
  var b03 = a01 * a12 - a02 * a11;
  var b04 = a01 * a13 - a03 * a11;
  var b05 = a02 * a13 - a03 * a12;
  var b06 = a20 * a31 - a21 * a30;
  var b07 = a20 * a32 - a22 * a30;
  var b08 = a20 * a33 - a23 * a30;
  var b09 = a21 * a32 - a22 * a31;
  var b10 = a21 * a33 - a23 * a31;
  var b11 = a22 * a33 - a23 * a32;
  var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  var o = new Array(16);
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
function m4apply(m, v) {
  var w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15];
  return [
    (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) / w,
    (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) / w,
    (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) / w
  ];
}
function hash3(x, y, z, seed) {
  var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, seed) {
  var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  var fx = x - ix, fy = y - iy, fz = z - iz;
  var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  var c000 = hash3(ix, iy, iz, seed), c100 = hash3(ix + 1, iy, iz, seed);
  var c010 = hash3(ix, iy + 1, iz, seed), c110 = hash3(ix + 1, iy + 1, iz, seed);
  var c001 = hash3(ix, iy, iz + 1, seed), c101 = hash3(ix + 1, iy, iz + 1, seed);
  var c011 = hash3(ix, iy + 1, iz + 1, seed), c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  var x00 = c000 + (c100 - c000) * sx, x10 = c010 + (c110 - c010) * sx;
  var x01 = c001 + (c101 - c001) * sx, x11 = c011 + (c111 - c011) * sx;
  var y0 = x00 + (x10 - x00) * sy, y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}
function fbm(x, y, z, seed) {
  var v = 0, a = 0.5;
  for (var o = 0; o < 3; o++) {
    v += a * vnoise(x, y, z, seed + o * 101);
    x *= 2; y *= 2; z *= 2; a *= 0.5;
  }
  return v;
}
function compileShader(type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function makeProgram(vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, compileShader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function makeMesh(positions, colors) {
  var n = positions.length / 3;
  var normals = new Float32Array(n * 3);
  for (var t = 0; t < n; t += 3) {
    var ux = positions[(t + 1) * 3] - positions[t * 3];
    var uy = positions[(t + 1) * 3 + 1] - positions[t * 3 + 1];
    var uz = positions[(t + 1) * 3 + 2] - positions[t * 3 + 2];
    var vx = positions[(t + 2) * 3] - positions[t * 3];
    var vy = positions[(t + 2) * 3 + 1] - positions[t * 3 + 1];
    var vz = positions[(t + 2) * 3 + 2] - positions[t * 3 + 2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    for (var j = 0; j < 3; j++) {
      normals[(t + j) * 3] = nx; normals[(t + j) * 3 + 1] = ny; normals[(t + j) * 3 + 2] = nz;
    }
  }
  var posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  var nrmBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  var colBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
  return { pos: posBuf, nrm: nrmBuf, col: colBuf, count: n };
}
function makePoints(positions, colors, sizes) {
  var n = positions.length / 3;
  var data = new Float32Array(n * 8);
  for (var i = 0; i < n; i++) {
    data[i * 8] = positions[i * 3];
    data[i * 8 + 1] = positions[i * 3 + 1];
    data[i * 8 + 2] = positions[i * 3 + 2];
    data[i * 8 + 3] = colors[i * 4];
    data[i * 8 + 4] = colors[i * 4 + 1];
    data[i * 8 + 5] = colors[i * 4 + 2];
    data[i * 8 + 6] = colors[i * 4 + 3];
    data[i * 8 + 7] = sizes[i];
  }
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return { buf: buf, count: n };
}
function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}
function cl(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/* ---------- geometry builders ---------- */
function buildPlanet() {
  var tier = TIERS[S.planet];
  var t = (1 + Math.sqrt(5)) / 2;
  var verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  for (var i = 0; i < verts.length; i++) {
    var v = verts[i];
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    verts[i] = [v[0] / l, v[1] / l, v[2] / l];
  }
  var faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  var cache = {};
  function mid(a, b) {
    var key = a < b ? a + '_' + b : b + '_' + a;
    if (cache[key] !== undefined) return cache[key];
    var va = verts[a], vb = verts[b];
    var m = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
    var l = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
    m = [m[0] / l, m[1] / l, m[2] / l];
    verts.push(m);
    cache[key] = verts.length - 1;
    return verts.length - 1;
  }
  for (var s = 0; s < tier.sub; s++) {
    var nf = [];
    for (var f = 0; f < faces.length; f++) {
      var a = faces[f][0], b = faces[f][1], c = faces[f][2];
      var ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca]); nf.push([b, bc, ab]); nf.push([c, ca, bc]); nf.push([ab, bc, ca]);
    }
    faces = nf;
  }
  var cs = [hexRgb(tier.colors[0]), hexRgb(tier.colors[1]), hexRgb(tier.colors[2])];
  var pos = [], col = [];
  for (var f2 = 0; f2 < faces.length; f2++) {
    var vA = verts[faces[f2][0]], vB = verts[faces[f2][1]], vC = verts[faces[f2][2]];
    function disp(v) {
      var n = fbm(v[0] * tier.freq + 7.3, v[1] * tier.freq + 3.1, v[2] * tier.freq + 9.7, 13);
      return tier.radius * (1 + (n - 0.5) * 2 * tier.amp);
    }
    var pA = [vA[0] * disp(vA), vA[1] * disp(vA), vA[2] * disp(vA)];
    var pB = [vB[0] * disp(vB), vB[1] * disp(vB), vB[2] * disp(vB)];
    var pC = [vC[0] * disp(vC), vC[1] * disp(vC), vC[2] * disp(vC)];
    var jitter = (hash3(f2 + 1, f2 * 2 + 5, f2 * 3 + 9, 91) - 0.5) * 0.16;
    var r, g, b;
    if (tier.banded) {
      var lat = (pA[1] + pB[1] + pC[1]) / 3 / tier.radius;
      var band = 0.5 + 0.5 * Math.sin(lat * 5.5 + Math.sin(lat * 13) * 0.8);
      var k = band * 2;
      var i0 = Math.min(2, Math.max(0, Math.floor(k)));
      var i1 = Math.min(2, i0 + 1);
      var fK = k - i0;
      r = cl((cs[i0][0] + (cs[i1][0] - cs[i0][0]) * fK) * (1 + jitter));
      g = cl((cs[i0][1] + (cs[i1][1] - cs[i0][1]) * fK) * (1 + jitter));
      b = cl((cs[i0][2] + (cs[i1][2] - cs[i0][2]) * fK) * (1 + jitter));
    } else {
      var pick = hash3(f2 * 5 + 1, f2 * 7 + 3, f2 * 11 + 7, 53);
      var pi = pick < 0.55 ? 0 : pick < 0.85 ? 1 : 2;
      r = cl(cs[pi][0] * (1 + jitter));
      g = cl(cs[pi][1] * (1 + jitter));
      b = cl(cs[pi][2] * (1 + jitter));
    }
    pos.push(pA[0], pA[1], pA[2], pB[0], pB[1], pB[2], pC[0], pC[1], pC[2]);
    col.push(r, g, b, r, g, b, r, g, b);
  }
  return makeMesh(new Float32Array(pos), new Float32Array(col));
}
function buildRing() {
  var tier = TIERS[S.planet];
  var inner = tier.radius * 1.45, outer = tier.radius * 2.05;
  var seg = 90, pos = [], col = [];
  var cs = hexRgb(tier.colors[1]);
  for (var i = 0; i < seg; i++) {
    var a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    var x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1);
    var j = (hash3(i, 3, 7, 31) - 0.5) * 0.2;
    var cr = cl(cs[0] * (1 + j)), cg = cl(cs[1] * (1 + j)), cb = cl(cs[2] * (1 + j));
    pos.push(x0 * inner, 0, z0 * inner, x1 * inner, 0, z1 * inner, x0 * outer, 0, z0 * outer);
    pos.push(x1 * inner, 0, z1 * inner, x1 * outer, 0, z1 * outer, x0 * outer, 0, z0 * outer);
    for (var k = 0; k < 6; k++) col.push(cr, cg, cb);
  }
  return makeMesh(new Float32Array(pos), new Float32Array(col));
}
function buildDrone() {
  var v = [[0, 1.4, 0], [0.9, -0.6, 0.7], [-0.9, -0.6, 0.7], [0, -0.6, -0.9]];
  var faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];
  var pos = [], col = [];
  for (var f = 0; f < 4; f++) {
    var a = v[faces[f][0]], b = v[faces[f][1]], c = v[faces[f][2]];
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    var shade = 1 - f * 0.12;
    for (var k = 0; k < 3; k++) col.push(0.16 * shade, 0.83 * shade, 0.93 * shade);
  }
  return makeMesh(new Float32Array(pos), new Float32Array(col));
}
function buildStars() {
  var count = 480, pos = [], col = [], size = [];
  for (var i = 0; i < count; i++) {
    var a = Math.random() * Math.PI * 2;
    var b = Math.acos(2 * Math.random() - 1);
    var r = 7 + Math.random() * 3;
    pos.push(r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a));
    var t = Math.random();
    if (t < 0.2) col.push(0.7, 0.8, 1.0, 0.9);
    else if (t < 0.4) col.push(1.0, 0.9, 0.7, 0.9);
    else col.push(1, 1, 1, 0.75);
    size.push(0.8 + Math.random() * 2.4);
  }
  return makePoints(pos, col, size);
}
function rebuildPlanet() {
  planetMesh = buildPlanet();
  ringMesh = TIERS[S.planet].ring ? buildRing() : null;
  particles.length = 0;
}
function buildScene() {
  starMesh = buildStars();
  rebuildPlanet();
  droneMesh = buildDrone();
}

/* ---------- GL setup + rendering ---------- */
function setupGL() {
  gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl');
  if (!gl) {
    tabBody.innerHTML = '<div class="row"><div class="info"><div class="name">WebGL nicht verfügbar</div><div class="desc">Dein Browser unterstützt kein WebGL. Bitte verwende einen aktuellen Browser.</div></div></div>';
    return false;
  }
  var l1n = Math.sqrt(L1[0] * L1[0] + L1[1] * L1[1] + L1[2] * L1[2]);
  var l2n = Math.sqrt(L2[0] * L2[0] + L2[1] * L2[1] + L2[2] * L2[2]);
  L1 = [L1[0] / l1n, L1[1] / l1n, L1[2] / l1n];
  L2 = [L2[0] / l2n, L2[1] / l2n, L2[2] / l2n];
  meshProgram = makeProgram(MESH_VS, MESH_FS);
  pointProgram = makeProgram(POINT_VS, POINT_FS);
  aMeshPos = gl.getAttribLocation(meshProgram, 'aPos');
  aMeshNrm = gl.getAttribLocation(meshProgram, 'aNrm');
  aMeshCol = gl.getAttribLocation(meshProgram, 'aCol');
  uMeshMVP = gl.getUniformLocation(meshProgram, 'uMVP');
  uMeshModel = gl.getUniformLocation(meshProgram, 'uModel');
  uMeshLight1 = gl.getUniformLocation(meshProgram, 'uLight1');
  uMeshLight2 = gl.getUniformLocation(meshProgram, 'uLight2');
  uMeshCam = gl.getUniformLocation(meshProgram, 'uCam');
  uMeshAlpha = gl.getUniformLocation(meshProgram, 'uAlpha');
  aPointPos = gl.getAttribLocation(pointProgram, 'aPos');
  aPointCol = gl.getAttribLocation(pointProgram, 'aCol');
  aPointSize = gl.getAttribLocation(pointProgram, 'aSize');
  uPointMVP = gl.getUniformLocation(pointProgram, 'uMVP');
  particleBuf = gl.createBuffer();
  resize();
  return true;
}
function resize() {
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
}
function bindMesh(mesh) {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos);
  gl.enableVertexAttribArray(aMeshPos);
  gl.vertexAttribPointer(aMeshPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nrm);
  gl.enableVertexAttribArray(aMeshNrm);
  gl.vertexAttribPointer(aMeshNrm, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.col);
  gl.enableVertexAttribArray(aMeshCol);
  gl.vertexAttribPointer(aMeshCol, 3, gl.FLOAT, false, 0, 0);
}
function bindPoints(buf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(aPointPos);
  gl.vertexAttribPointer(aPointPos, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(aPointCol);
  gl.vertexAttribPointer(aPointCol, 4, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(aPointSize);
  gl.vertexAttribPointer(aPointSize, 1, gl.FLOAT, false, 32, 28);
}
function draw() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  var bg = TIERS[S.planet].bg;
  gl.clearColor(bg[0], bg[1], bg[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  var aspect = canvas.width / Math.max(1, canvas.height);
  var proj = m4persp(Math.PI / 4, aspect, 0.1, 40);
  var eye = [camCur.x * 0.35, 0.28 + camCur.y * 0.25 + Math.sin(time * 0.5) * 0.05, 3.35];
  var view = m4lookAt(eye, [0, 0, 0], [0, 1, 0]);
  currentVP = m4mul(proj, view);
  gl.useProgram(pointProgram);
  gl.uniformMatrix4fv(uPointMVP, false, m4mul(currentVP, m4rotY(time * 0.004)));
  bindPoints(starMesh.buf);
  gl.drawArrays(gl.POINTS, 0, starMesh.count);
  gl.useProgram(meshProgram);
  gl.uniform3fv(uMeshLight1, L1);
  gl.uniform3fv(uMeshLight2, L2);
  gl.uniform3fv(uMeshCam, eye);
  gl.enable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  var model = m4mul(m4rotY(rot), m4rotX(0.42));
  gl.uniformMatrix4fv(uMeshMVP, false, m4mul(currentVP, model));
  gl.uniformMatrix4fv(uMeshModel, false, model);
  gl.uniform1f(uMeshAlpha, 1);
  bindMesh(planetMesh);
  gl.drawArrays(gl.TRIANGLES, 0, planetMesh.count);
  if (ringMesh) {
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(uMeshAlpha, 0.5);
    var rModel = m4mul(m4rotY(rot * 0.4), m4rotX(1.15));
    gl.uniformMatrix4fv(uMeshMVP, false, m4mul(currentVP, rModel));
    gl.uniformMatrix4fv(uMeshModel, false, rModel);
    bindMesh(ringMesh);
    gl.drawArrays(gl.TRIANGLES, 0, ringMesh.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }
  var drones = Math.min(S.buildings[0], 24);
  if (drones > 0) {
    gl.uniform1f(uMeshAlpha, 1);
    for (var i = 0; i < drones; i++) {
      var a = time * (0.5 + (i % 5) * 0.13) + i * 6.28318 / drones;
      var rr = 1.5 + (i % 4) * 0.14;
      var dy = Math.sin(time * 0.7 + i * 1.3) * 0.18;
      var dModel = m4mul(m4translate(Math.cos(a) * rr, dy, Math.sin(a) * rr), m4rotY(-a));
      dModel = m4mul(dModel, m4scale(0.055, 0.055, 0.055));
      gl.uniformMatrix4fv(uMeshMVP, false, m4mul(currentVP, dModel));
      gl.uniformMatrix4fv(uMeshModel, false, dModel);
      bindMesh(droneMesh);
      gl.drawArrays(gl.TRIANGLES, 0, droneMesh.count);
    }
  }
  if (particles.length > 0) {
    gl.useProgram(pointProgram);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    var data = new Float32Array(particles.length * 8);
    for (var p2 = 0; p2 < particles.length; p2++) {
      var pt = particles[p2];
      var lf = 1 - pt.life / pt.max;
      data[p2 * 8] = pt.p[0];
      data[p2 * 8 + 1] = pt.p[1];
      data[p2 * 8 + 2] = pt.p[2];
      data[p2 * 8 + 3] = pt.c[0] * lf;
      data[p2 * 8 + 4] = pt.c[1] * lf;
      data[p2 * 8 + 5] = pt.c[2] * lf;
      data[p2 * 8 + 6] = pt.c[3] * lf;
      data[p2 * 8 + 7] = pt.s * lf * 3;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.uniformMatrix4fv(uPointMVP, false, currentVP);
    bindPoints(particleBuf);
    gl.drawArrays(gl.POINTS, 0, particles.length);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
function updateParticles(dt) {
  for (var i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.life += dt;
    if (p.life >= p.max) { particles.splice(i, 1); continue; }
    var pl = Math.sqrt(p.p[0] * p.p[0] + p.p[1] * p.p[1] + p.p[2] * p.p[2]) || 1;
    p.v[0] += (-p.p[0] / pl * 1.8) * dt;
    p.v[1] += (-p.p[1] / pl * 1.8 - 0.6) * dt;
    p.v[2] += (-p.p[2] / pl * 1.8) * dt;
    p.p[0] += p.v[0] * dt;
    p.p[1] += p.v[1] * dt;
    p.p[2] += p.v[2] * dt;
  }
}
function pickPlanet(mx, my) {
  if (!currentVP) return null;
  var rect = canvas.getBoundingClientRect();
  var x = ((mx - rect.left) / rect.width) * 2 - 1;
  var y = 1 - ((my - rect.top) / rect.height) * 2;
  var inv = m4invert(currentVP);
  if (!inv) return null;
  var p0 = m4apply(inv, [x, y, -1]);
  var p1 = m4apply(inv, [x, y, 0.999]);
  var dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  var dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  var r = TIERS[S.planet].radius * 1.02;
  var b = 2 * (p0[0] * dx + p0[1] * dy + p0[2] * dz);
  var c = p0[0] * p0[0] + p0[1] * p0[1] + p0[2] * p0[2] - r * r;
  var disc = b * b - 4 * c;
  if (disc < 0) return null;
  var t1 = (-b - Math.sqrt(disc)) / 2;
  if (t1 < 0) t1 = (-b + Math.sqrt(disc)) / 2;
  if (t1 < 0) return null;
  return [p0[0] + dx * t1, p0[1] + dy * t1, p0[2] + dz * t1];
}
function floatText(cx, cy, text, color) {
  var rect = canvas.getBoundingClientRect();
  var el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  if (color) el.style.color = color;
  el.style.left = (cx - rect.left) + 'px';
  el.style.top = (cy - rect.top) + 'px';
  floatLayer.appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
}
function autoCrystalText() {
  var rect = canvas.getBoundingClientRect();
  floatText(rect.left + rect.width * (0.25 + Math.random() * 0.5), rect.top + rect.height * 0.3, '+1 Kristall', '#c4b5fd');
}

/* ---------- interactions ---------- */
canvas.addEventListener('pointerdown', function (e) {
  if (!planetMesh || !gl) return;
  var hit = pickPlanet(e.clientX, e.clientY);
  if (!hit) return;
  var gain = clickPower();
  var crit = S.upgrades[2] > 0 && Math.random() < 0.1;
  if (crit) gain = gain * 10;
  S.ore += gain;
  S.totalOre += gain;
  S.clicks++;
  for (var i = 0; i < 12; i++) {
    var ang = Math.random() * 6.28318;
    var elev = (Math.random() - 0.5) * 3.14159;
    var ddx = Math.cos(ang) * Math.cos(elev);
    var ddy = Math.sin(elev);
    var ddz = Math.sin(ang) * Math.cos(elev);
    var pl = Math.sqrt(hit[0] * hit[0] + hit[1] * hit[1] + hit[2] * hit[2]) || 1;
    var nx = hit[0] / pl, ny = hit[1] / pl, nz = hit[2] / pl;
    particles.push({
      p: [hit[0], hit[1], hit[2]],
      v: [nx * 0.9 + ddx * 0.9, ny * 0.9 + ddy * 0.9 + 0.5, nz * 0.9 + ddz * 0.9],
      life: 0,
      max: 0.55 + Math.random() * 0.25,
      s: 2 + Math.random() * 2.5,
      c: crit ? [1.0, 0.6, 0.15, 1] : [0.95, 0.8, 0.4, 1]
    });
  }
  floatText(e.clientX, e.clientY, '+' + fmt(gain) + (crit ? ' KRITISCH' : ''));
  if (Math.random() < 0.005 * crystalLuck()) {
    S.crystals++;
    floatText(e.clientX, e.clientY - 24, '+1 Kristall', '#c4b5fd');
  }
  dirty = true;
});
canvas.addEventListener('pointermove', function (e) {
  camPar.x = (e.clientX / window.innerWidth - 0.5) * 2;
  camPar.y = (e.clientY / window.innerHeight - 0.5) * 2;
});
window.addEventListener('resize', resize);

/* ---------- UI rendering ---------- */
function updateHud() {
  oreVal.textContent = fmt(S.ore);
  oreRateEl.textContent = '+' + fmt(prodRate()) + '/s';
  cryVal.textContent = fmt(S.crystals);
  dmVal.textContent = fmt(S.darkMatter);
  dmRateEl.textContent = '+' + S.darkMatter * 2 + '% Produktion';
  planetName.textContent = TIERS[S.planet].name;
  statsText.textContent = 'Gesamt: ' + fmt(S.totalOre) + ' Erz · Klicks: ' + fmt(S.clicks) + ' · Spielzeit: ' + fmtTime(S.playtime);
}
function prodTab() {
  var h = '<div class="qty">';
  h += '<button data-qty="1"' + (qty === 1 ? ' class="on"' : '') + '>1×</button>';
  h += '<button data-qty="10"' + (qty === 10 ? ' class="on"' : '') + '>10×</button>';
  h += '<button data-qty="max"' + (qty === 'max' ? ' class="on"' : '') + '>Max</button>';
  h += '</div>';
  for (var i = 0; i < BLD.length; i++) {
    var owned = S.buildings[i];
    var n = qty === 'max' ? maxAffordable(i) : qty;
    var cost = buildingCost(i, n, owned);
    var afford = n > 0 && S.ore >= cost;
    h += '<div class="row"><div class="info">' +
      '<div class="name">' + BLD[i].name + '</div>' +
      '<div class="desc">' + BLD[i].desc + '</div>' +
      '<div class="owned">Stufe ' + owned + ' · +' + fmt(BLD[i].rate * prodMult()) + '/s je Einheit</div>' +
      '<div class="cost">Kosten: ' + fmt(cost) + ' Erz</div>' +
      '</div>' +
      '<button class="btn' + (afford ? '' : ' off') + '" data-act="bld" data-i="' + i + '"' + (afford ? '' : ' disabled') + '>Kaufen ×' + n + '</button>' +
      '</div>';
  }
  return h;
}
function upTab() {
  var h = '<div class="section">Bohr-Upgrades</div>';
  for (var i = 0; i < UP.length; i++) {
    var lvl = S.upgrades[i];
    var maxed = lvl >= UP[i].max;
    var cost = maxed ? 0 : upgradeCost(i);
    var afford = !maxed && S.ore >= cost;
    h += '<div class="row"><div class="info">' +
      '<div class="name">' + UP[i].name + '</div>' +
      '<div class="desc">' + UP[i].desc + '</div>' +
      '<div class="owned">Stufe ' + lvl + ' / ' + UP[i].max + '</div>' +
      (maxed ? '<div class="cost">Maximiert</div>' : '<div class="cost">Kosten: ' + fmt(cost) + ' Erz</div>') +
      '</div>' +
      '<button class="btn' + (afford ? '' : ' off') + '" data-act="up" data-i="' + i + '"' + (afford ? '' : ' disabled') + '>' + (maxed ? 'MAX' : 'Kaufen') + '</button>' +
      '</div>';
  }
  return h;
}
function planetTab() {
  var h = '<div class="section">Bergbau-Ziele</div>';
  for (var i = 0; i < TIERS.length; i++) {
    var t = TIERS[i];
    if (i < S.planet) {
      h += '<div class="row"><div class="info"><div class="name">' + t.name + '</div><div class="desc">Produktion ×' + t.mult + '</div></div><span style="color:rgba(255,255,255,0.35);font-size:0.72rem">Erreicht</span></div>';
    } else if (i === S.planet) {
      h += '<div class="row"><div class="info"><div class="name">' + t.name + '</div><div class="desc">Produktion ×' + t.mult + '</div></div><span style="color:#22d3ee;font-size:0.72rem">Aktuell</span></div>';
    } else {
      var next = i === S.planet + 1;
      var afford = next && S.ore >= t.cost;
      h += '<div class="row"><div class="info"><div class="name">' + t.name + '</div><div class="desc">Produktion ×' + t.mult + '</div><div class="cost">Kosten: ' + fmt(t.cost) + ' Erz</div></div>' +
        '<button class="btn' + (afford ? '' : ' off') + '" data-act="planet" data-i="' + i + '"' + (afford ? '' : ' disabled') + '>' + (next ? 'Anfliegen' : 'Gesperrt') + '</button></div>';
    }
  }
  return h;
}
function crystalTab() {
  var h = '<div class="section">Kristall-Upgrades</div>';
  h += '<div class="row"><div class="info"><div class="desc">Kristalle findest du beim Klicken und durch deine Drohnen. Sie bleiben auch nach einem Wurmlochsprung erhalten.</div></div></div>';
  for (var i = 0; i < CUP.length; i++) {
    var lvl = S.crystalUp[i];
    var maxed = lvl >= CUP[i].costs.length;
    var cost = maxed ? 0 : CUP[i].costs[lvl];
    var afford = !maxed && S.crystals >= cost;
    h += '<div class="row"><div class="info">' +
      '<div class="name">' + CUP[i].name + '</div>' +
      '<div class="desc">' + CUP[i].desc + '</div>' +
      '<div class="owned">Stufe ' + lvl + ' / ' + CUP[i].costs.length + '</div>' +
      (maxed ? '<div class="cost">Maximiert</div>' : '<div class="cost" style="color:#c4b5fd">Kosten: ' + cost + ' Kristalle</div>') +
      '</div>' +
      '<button class="btn violet' + (afford ? '' : ' off') + '" data-act="cup" data-i="' + i + '"' + (afford ? '' : ' disabled') + '>' + (maxed ? 'MAX' : 'Kaufen') + '</button>' +
      '</div>';
  }
  return h;
}
function prestigeTab() {
  var gain = prestigeGain();
  var ready = gain >= 1;
  var h = '<div class="section">Wurmlochsprung</div>';
  h += '<div class="row"><div class="info">' +
    '<div class="name">Dunkle Materie: ' + fmt(S.darkMatter) + '</div>' +
    '<div class="desc">Jede Einheit Dunkle Materie erhöht deine gesamte Produktion dauerhaft um +2%.</div>' +
    '<div class="owned">Gesamt abgebaut: ' + fmt(S.totalOre) + ' / ' + fmt(PRESTIGE_REQ) + '</div>' +
    '<div class="cost">Nächster Sprung: +' + fmt(gain) + ' Dunkle Materie</div>' +
    '</div>' +
    '<button class="btn violet' + (ready ? '' : ' off') + '" data-act="prestige"' + (ready ? '' : ' disabled') + '>Springen</button>' +
    '</div>';
  h += '<div class="row"><div class="info"><div class="desc">Ein Sprung setzt Erz, Gebäude, Upgrades und Planeten zurück. Kristalle, Kristall-Upgrades und Dunkle Materie bleiben erhalten.</div></div></div>';
  return h;
}
function renderTabs() {
  var html = '';
  if (currentTab === 'prod') html = prodTab();
  else if (currentTab === 'up') html = upTab();
  else if (currentTab === 'planet') html = planetTab();
  else if (currentTab === 'crystal') html = crystalTab();
  else html = prestigeTab();
  tabBody.innerHTML = html;
}
var tabsEl = document.getElementById('tabs');
tabsEl.addEventListener('click', function (e) {
  var btn = e.target.closest ? e.target.closest('button[data-tab]') : null;
  if (!btn) return;
  currentTab = btn.getAttribute('data-tab');
  var all = tabsEl.querySelectorAll('button');
  for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === btn);
  dirty = true;
});
tabBody.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('[data-act],[data-qty]') : null;
  if (!el) return;
  if (el.hasAttribute('data-qty')) {
    var v = el.getAttribute('data-qty');
    qty = v === 'max' ? 'max' : parseInt(v, 10);
    dirty = true;
    return;
  }
  var act = el.getAttribute('data-act');
  var i = parseInt(el.getAttribute('data-i') || '0', 10);
  if (act === 'bld') buyBuilding(i);
  else if (act === 'up') buyUpgrade(i);
  else if (act === 'planet') buyPlanet(i);
  else if (act === 'cup') buyCrystalUp(i);
  else if (act === 'prestige') doPrestige();
});
document.getElementById('resetBtn').addEventListener('click', resetGame);
document.getElementById('offlineOk').addEventListener('click', function () { offlineModal.hidden = true; });

/* ---------- game actions ---------- */
function buyBuilding(i) {
  var n = qty === 'max' ? maxAffordable(i) : qty;
  var cost = buildingCost(i, n, S.buildings[i]);
  if (n <= 0 || S.ore < cost) return;
  S.ore -= cost;
  S.buildings[i] += n;
  dirty = true;
}
function buyUpgrade(i) {
  if (S.upgrades[i] >= UP[i].max) return;
  var cost = upgradeCost(i);
  if (S.ore < cost) return;
  S.ore -= cost;
  S.upgrades[i]++;
  dirty = true;
}
function buyPlanet(i) {
  if (i !== S.planet + 1) return;
  var cost = TIERS[i].cost;
  if (S.ore < cost) return;
  S.ore -= cost;
  S.planet = i;
  rebuildPlanet();
  dirty = true;
}
function buyCrystalUp(i) {
  var lvl = S.crystalUp[i];
  if (lvl >= CUP[i].costs.length) return;
  var cost = CUP[i].costs[lvl];
  if (S.crystals < cost) return;
  S.crystals -= cost;
  S.crystalUp[i]++;
  dirty = true;
}
function doPrestige() {
  var gain = prestigeGain();
  if (gain < 1) return;
  if (!confirm('Wurmlochsprung durchführen und +' + fmt(gain) + ' Dunkle Materie erhalten? Erz, Gebäude, Upgrades und Planeten werden zurückgesetzt. Kristalle bleiben erhalten.')) return;
  S.darkMatter += gain;
  S.ore = 0;
  S.totalOre = 0;
  S.buildings = [0, 0, 0, 0, 0, 0, 0, 0];
  S.upgrades = [0, 0, 0, 0];
  S.planet = 0;
  rebuildPlanet();
  save();
  dirty = true;
}
function resetGame() {
  if (!confirm('Gesamten Spielstand wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return;
  S = freshState();
  rebuildPlanet();
  save();
  dirty = true;
}

/* ---------- persistence ---------- */
function save() {
  S.lastSave = Date.now();
  fetch('/api/save', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(S),
    keepalive: true
  }).catch(function () {});
}
function applySave(d) {
  if (typeof d.ore === 'number') S.ore = d.ore;
  if (typeof d.crystals === 'number') S.crystals = d.crystals;
  if (typeof d.darkMatter === 'number') S.darkMatter = d.darkMatter;
  if (typeof d.totalOre === 'number') S.totalOre = d.totalOre;
  if (typeof d.clicks === 'number') S.clicks = d.clicks;
  if (typeof d.playtime === 'number') S.playtime = d.playtime;
  if (typeof d.planet === 'number') S.planet = Math.min(Math.max(0, Math.floor(d.planet)), TIERS.length - 1);
  if (Array.isArray(d.buildings)) {
    for (var i = 0; i < BLD.length; i++) S.buildings[i] = Math.max(0, Math.floor(d.buildings[i] || 0));
  }
  if (Array.isArray(d.upgrades)) {
    for (var j = 0; j < UP.length; j++) S.upgrades[j] = Math.min(UP[j].max, Math.max(0, Math.floor(d.upgrades[j] || 0)));
  }
  if (Array.isArray(d.crystalUp)) {
    for (var k = 0; k < CUP.length; k++) S.crystalUp[k] = Math.min(CUP[k].costs.length, Math.max(0, Math.floor(d.crystalUp[k] || 0)));
  }
}
function showOffline(gain, secs) {
  offlineText.textContent = 'Deine Flotte hat während deiner Abwesenheit (' + fmtTime(secs) + ') weitergefördert:';
  offlineGainEl.textContent = '+' + fmt(gain) + ' Erz';
  offlineModal.hidden = false;
}

/* ---------- main loop ---------- */
var last = 0, hudClock = 0, saveClock = 0, tickClock = 0, hiddenAt = 0;
function frame(now) {
  var dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  rot += dt * 0.18;
  camCur.x += (camPar.x - camCur.x) * Math.min(1, dt * 6);
  camCur.y += (camPar.y - camCur.y) * Math.min(1, dt * 6);
  var rate = prodRate();
  if (rate > 0) {
    S.ore += rate * dt;
    S.totalOre += rate * dt;
  }
  S.playtime += dt;
  tickClock += dt;
  while (tickClock >= 1) {
    tickClock -= 1;
    var chance = 0.0015 * crystalLuck() * (1 + S.buildings[0] * 0.01);
    if (Math.random() < chance) {
      S.crystals++;
      autoCrystalText();
      dirty = true;
    }
  }
  updateParticles(dt);
  draw();
  hudClock += dt;
  if (hudClock >= 0.1) {
    hudClock = 0;
    updateHud();
    if (dirty) { dirty = false; renderTabs(); }
  }
  saveClock += dt;
  if (saveClock >= 15) { saveClock = 0; save(); }
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    hiddenAt = Date.now();
    save();
  } else if (hiddenAt) {
    var away = Math.min((Date.now() - hiddenAt) / 1000, offlineCap());
    hiddenAt = 0;
    if (away > 3) {
      var gain = prodRate() * away * offlineMult();
      if (gain >= 1) {
        S.ore += gain;
        S.totalOre += gain;
        showOffline(gain, Math.floor(away));
        dirty = true;
      }
    }
  }
});
window.addEventListener('pagehide', function () { save(); });

/* ---------- boot ---------- */
async function init() {
  if (!setupGL()) return;
  var d = null;
  try {
    var r = await fetch('/api/save');
    if (r.ok) d = await r.json();
  } catch (err) { d = null; }
  S = freshState();
  var offlineSec = 0, offlineGain = 0;
  if (d && d.v === 1) {
    applySave(d);
    var away = Math.min(Math.max(0, (Date.now() - (d.lastSave || Date.now())) / 1000), offlineCap());
    offlineSec = Math.floor(away);
    if (away > 5) offlineGain = prodRate() * away * offlineMult();
  }
  S.ore += offlineGain;
  S.totalOre += offlineGain;
  buildScene();
  renderTabs();
  updateHud();
  if (offlineGain >= 1) showOffline(offlineGain, offlineSec);
  last = performance.now();
  requestAnimationFrame(frame);
}
init();
</script>
</body>
</html>
`,
    }),
  },
]
