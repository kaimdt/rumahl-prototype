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

const browserManifest = {
  id: 'webbrowser',
  name: 'IORA Browser',
  version: '1.0.0',
  developer: 'IORA OS',
  description: 'Ein vollwertiger Firefox-Browser, der als Container auf deinem IORA OS läuft — mit Web-Oberfläche erreichbar, inklusive KasmVNC-Fernzugriff.',
  type: 'app',
  icon: 'browser',
  permissions: ['NetworkLocalAccess'],
  // The embedded VNC viewer needs clipboard + fullscreen + pointer lock.
  display: {
    mode: 'embedded',
    isolation: 'strict',
    permissions: ['clipboard-read', 'clipboard-write', 'fullscreen'],
  },
  docker: {
    auto_build: false,
    image: 'jlesage/firefox:latest',
    internal_ports: [
      { port: 5800, protocol: 'tcp', external: 8580 },
      { port: 5900, protocol: 'tcp', external: 8590 },
    ],
    volumes: ['firefox_config:/config', '/dev/shm:/dev/shm'],
    restart: 'unless-stopped',
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
    id: 'webbrowser',
    name: 'IORA Browser',
    developer: 'IORA OS',
    description: 'Vollwertiger Firefox im Container auf deinem Server — öffne ihn im Browser-Fenster und surfe wie auf einem eigenen Rechner. Läuft auch dann weiter, wenn du die Seite schließt.',
    version: '1.0.0',
    category: 'Browser',
    permissions: ['NetworkLocalAccess'],
    openPort: 8580,
    iconUrl: globeSvg(),
    buildZip: () => buildZipFor(browserManifest),
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
]
