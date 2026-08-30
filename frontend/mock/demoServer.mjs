// ============================================================================
// demoServer.mjs – rumahl OS frontend demo backend (Vite dev middleware)
// ============================================================================
// Allows running the frontend WITHOUT the rumahl backend / dev VM:
//   pnpm|npm run dev:demo   ->  Vite on :5173 with this middleware.
//
// It answers every /api/*, /health and /uploads request the frontend makes at
// boot with valid-shaped mock data, and seeds a demo auth session so the app
// boots straight into the OS launcher with demo entities. The WebSocket is
// intentionally not served — in demo mode the frontend skips /ws and relies on
// HTTP polling in the entity store. Nothing here touches a real backend.
//
// Semantics: read-only endpoints return data; mutating endpoints gracefully
// ACK (200/201) so Settings/Compose flows don't error. Data is NOT persisted.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'

// ── Demo identity ──────────────────────────────────────────────────────────
const DEMO_TOKEN = 'demo-access-token'
const DEMO_REFRESH = 'demo-refresh-token'

const DEMO_USER = {
  id: 'demo-user',
  username: 'demo',
  display_name: 'Demo Benutzer',
  role: 'admin',
  is_admin: true,
  profile_type: 'standard',
  restrictions: null,
  refreshed_token: DEMO_TOKEN,
}

// ── Demo HomeAssistant states (mirrors generateMockStates) ─────────────────
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
function demoStates() {
  const t = now
  return [
    { entity_id: 'weather.home', state: 'sunny', last_changed: iso(t), last_updated: iso(t), attributes: { temperature: 20, humidity: 65, friendly_name: 'Kissing', forecast: [ { datetime: iso(t), temperature: 20, condition: 'sunny' }, { datetime: iso(t + 86400000), temperature: 22, condition: 'cloudy' }, { datetime: iso(t + 172800000), temperature: 19, condition: 'rainy' }, { datetime: iso(t + 259200000), temperature: 21, condition: 'cloudy' }, { datetime: iso(t + 345600000), temperature: 23, condition: 'sunny' } ] } },
    { entity_id: 'light.living_room', state: 'on', last_changed: iso(t), last_updated: iso(t), attributes: { brightness: 200, rgb_color: [255, 180, 120], friendly_name: 'Wohnzimmer', color_mode: 'rgb', supported_color_modes: ['rgb', 'color_temp'] } },
    { entity_id: 'light.bedroom', state: 'off', last_changed: iso(t), last_updated: iso(t), attributes: { brightness: 0, rgb_color: [255, 255, 255], friendly_name: 'Schlafzimmer' } },
    { entity_id: 'light.kitchen', state: 'on', last_changed: iso(t), last_updated: iso(t), attributes: { brightness: 255, color_temp: 370, friendly_name: 'Küche', color_mode: 'color_temp' } },
    { entity_id: 'light.office', state: 'on', last_changed: iso(t), last_updated: iso(t), attributes: { brightness: 180, rgb_color: [200, 220, 255], friendly_name: 'Büro' } },
    { entity_id: 'light.hallway', state: 'off', last_changed: iso(t), last_updated: iso(t), attributes: { brightness: 0, color_temp: 300, friendly_name: 'Flur' } },
    { entity_id: 'climate.living_room', state: 'heat', last_changed: iso(t), last_updated: iso(t), attributes: { temperature: 21, current_temperature: 20.5, hvac_action: 'heating', friendly_name: 'Heizung Wohnzimmer' } },
    { entity_id: 'climate.bedroom', state: 'auto', last_changed: iso(t), last_updated: iso(t), attributes: { temperature: 19, current_temperature: 19.2, hvac_action: 'idle', friendly_name: 'Heizung Schlafzimmer' } },
    { entity_id: 'switch.living_room_outlet', state: 'on', last_changed: iso(t), last_updated: iso(t), attributes: { friendly_name: 'Steckdose Wohnzimmer' } },
    { entity_id: 'switch.coffee_maker', state: 'off', last_changed: iso(t), last_updated: iso(t), attributes: { friendly_name: 'Kaffeemaschine' } },
    { entity_id: 'sensor.living_room_temperature', state: '22.5', last_changed: iso(t), last_updated: iso(t), attributes: { unit_of_measurement: '°C', device_class: 'temperature', friendly_name: 'Temperatur Wohnzimmer' } },
    { entity_id: 'sensor.living_room_humidity', state: '58', last_changed: iso(t), last_updated: iso(t), attributes: { unit_of_measurement: '%', device_class: 'humidity', friendly_name: 'Luftfeuchtigkeit Wohnzimmer' } },
    { entity_id: 'sensor.energy_consumption', state: '1.2', last_changed: iso(t), last_updated: iso(t), attributes: { unit_of_measurement: 'kW', device_class: 'power', friendly_name: 'Energieverbrauch' } },
  ]
}

// ── Demo themes (returned as { builtin, installed } — the shape the app
//    actually expects; data.builtin / data.installed are read directly). ──────
const DEMO_THEMES = {
  builtin: [
    { id: 'auto', name: 'Automatisch', description: 'Wechselt nach Tageszeit', version: '1.0.0', developer: 'rumahl', icon: 'ArrowsClockwise', system: true, css_variables: {} },
    { id: 'day', name: 'Tag', description: 'Helles Design', version: '1.0.0', developer: 'rumahl', icon: 'CloudSun', system: true, css_variables: {} },
    { id: 'day-classic', name: 'Klassisch', description: 'Dunkler Hintergrund', version: '1.0.0', developer: 'rumahl', icon: 'Monitor', system: true, css_variables: {} },
    { id: 'evening', name: 'Abend', description: 'Warme Töne', version: '1.0.0', developer: 'rumahl', icon: 'SunDim', system: true, css_variables: {} },
    { id: 'night', name: 'Nacht', description: 'Dunkles Design', version: '1.0.0', developer: 'rumahl', icon: 'MoonStars', system: true, css_variables: {} },
    { id: 'sleep', name: 'Schlaf', description: 'OLED Schwarz', version: '1.0.0', developer: 'rumahl', icon: 'Moon', system: true, css_variables: {} },
  ],
  installed: [
    { id: 'organic', name: 'Organisch', description: 'Weiche Grüntöne für ein ruhiges Ambiente', version: '1.2.0', developer: 'rumahl', icon: 'PaintBrush', enabled: true, order: 1, css_variables: { background: '#182229', accent: '#58d695' } },
    { id: 'ocean', name: 'Ozean', description: 'Entspannte Blau- und Cyan-Töne', version: '1.0.3', developer: 'rumahl', icon: 'Palette', enabled: true, order: 2, css_variables: { background: '#121a24', accent: '#31b8c6' } },
    { id: 'sunset', name: 'Sonnenuntergang', description: 'Warme Orange- und Violett-Töne', version: '0.9.0', developer: 'rumahl', icon: 'Sun', enabled: false, order: 3, css_variables: { background: '#241a2e', accent: '#ff9748' } },
  ],
}

// ── Demo installed / catalog apps (launcher + app store) ────────────────────
const DEMO_APPS = [
  { id: 'rumahl-notes', name: 'Notizen', description: 'Schnelle Notizen erstellen und verwalten', version: '2.1.0', developer: 'rumahl', review_rating: 4.8, installation_count: 1520, category: 'Produktivität', enabled: true, running: true, status: 'running', installed: true, installed_at: '2026-01-15T10:00:00Z', icon: 'Notebook', is_bundle: false, docker: false, system: false, health: 'ok', appId: 'rumahl-notes', pageId: 'rumahl-notes', short_name: 'Notes' },
  { id: 'rumahl-calendar', name: 'Kalender', description: 'Termine und Ereignisse auf einen Blick', version: '1.8.2', developer: 'rumahl', review_rating: 4.6, installation_count: 980, category: 'Produktivität', enabled: true, running: true, status: 'running', installed: true, installed_at: '2026-02-03T10:00:00Z', icon: 'CalendarBlank', is_bundle: false, docker: false, system: false, health: 'ok', appId: 'rumahl-calendar', pageId: 'rumahl-calendar', short_name: 'Calendar' },
  { id: 'rumahl-music', name: 'Musik', description: 'Stream und steuere deine Musiksammlung', version: '1.4.0', developer: 'rumahl', review_rating: 4.9, installation_count: 2040, category: 'Medien', enabled: true, running: true, status: 'running', installed: true, installed_at: '2026-02-20T10:00:00Z', icon: 'MusicNotes', is_bundle: false, docker: true, system: false, health: 'ok', appId: 'rumahl-music', pageId: 'rumahl-music', short_name: 'Music' },
  { id: 'rumahl-browser', name: 'Browser', description: 'Web-Browser für alle Apps', version: '2.3.1', developer: 'rumahl', review_rating: 4.7, installation_count: 3100, category: 'System', enabled: true, running: true, status: 'running', installed: true, installed_at: '2026-03-01T10:00:00Z', icon: 'Compass', is_bundle: false, docker: true, system: true, health: 'ok', appId: 'rumahl-browser', pageId: 'rumahl-browser', short_name: 'Browser' },
  { id: 'rumahl-shopping', name: 'Einkaufsliste', description: 'Gemeinsame Einkaufslisten führen', version: '1.1.0', developer: 'rumahl', review_rating: 4.3, installation_count: 610, category: 'Lifestyle', enabled: false, running: false, status: 'stopped', installed: true, installed_at: '2026-03-12T10:00:00Z', icon: 'Cart', is_bundle: false, docker: false, system: false, health: 'stopped', appId: 'rumahl-shopping', pageId: 'rumahl-shopping', short_name: 'Shopping' },
]

// ── Demo files (OS "Bilder"/files) — the monstera wallpaper lives under Bilder
//    by default; future wallpapers land here automatically via /api/files. ─────
const MONSTERA_PATH = path.resolve(process.cwd(), 'public', 'assets', 'wallpapers', 'monstera.jpg')
const DEMO_FILES = [
  {
    id: 'file-monstera',
    original_name: 'MidnightMonstera.jpg',
    mime_type: 'image/jpeg',
    size_bytes: fs.existsSync(MONSTERA_PATH) ? fs.statSync(MONSTERA_PATH).size : 0,
    updated_at: new Date().toISOString(),
    is_folder: false,
    file_type: 'image',
  },
]

// ── Demo pages (dashboard) — backend shape { page, widgets } ────────────────
const DEMO_PAGES = [
  {
    page: {
      page_id: 'demo-landing',
      name: 'Übersicht',
      icon: 'Layout',
      page_type: 'dashboard',
      page_source_kind: 'rumahl',
      page_source_id: null,
      show_in_nav: true,
      position: 0,
      display_mode: 'page',
      parent_page_id: null,
      modal_settings: null,
    },
    widgets: [],
  },
]


// ── Helpers ─────────────────────────────────────────────────────────────────
function json(res, payload, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}
const ok = (res, payload = null) => json(res, payload ?? { ok: true })
const ack = (res) => json(res, { ok: true, status: 'ok' }, 200)

// Match a route pattern with optional :params. Returns match object or null.
function matchRoute(pathname, route) {
  const parts = route.split('/').filter(Boolean)
  const segs = pathname.split('/').filter(Boolean)
  if (parts.length !== segs.length) return null
  const params = {}
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segs[i])
    else if (parts[i] !== segs[i]) return null
  }
  return params
}

// ── Router ──────────────────────────────────────────────────────────────────
const GET_201 = [
  {
    route: '/api/system/stats',
    handler: (res) => json(res, {
      cpu: { usage_percent: 12, cores: 4 },
      memory: { usage_percent: 38, total_bytes: 8589934592, used_bytes: 3264175145 },
      uptime_seconds: 86400,
      database: { size_bytes: 52428800, history_rows: 1200 },
      backend: { version: '2.0.0-demo', entity_count: 13, connected_clients: 1, cache_metrics: { update_count: 10, last_update_ms: 100, cache_hits: 5, cache_misses: 2 } },
      ha_connected: true,
      ha_ws_connected: true,
    }),
  },
  { route: '/api/system/ha-info', handler: (res) => json(res, { ha_connected: true, ha_ws_connected: true, entity_count: 13, ha_version: '2026.1', domains: [{ domain: 'light', count: 5 }, { domain: 'climate', count: 2 }, { domain: 'switch', count: 2 }, { domain: 'sensor', count: 3 }], history_entries_24h: 500 }) },
  { route: '/api/os/control/system', handler: (res) => json(res, { hostname: 'rumahl-demo', os_name: 'rumahl OS', os_version: '2.0.0-demo', kernel_version: '6.1.0' }) },
  { route: '/api/integration/ha/configured', handler: (res) => json(res, { configured: true }) },
  { route: '/api/maintenance/status', handler: (res) => json(res, { maintenance: false, mode: null, can_bypass: true }) },
  { route: '/api/maintenance', handler: (res) => json(res, { maintenance_mode: false }) },
  { route: '/api/os/permissions', handler: (res) => json(res, { AppStorage: ['read', 'write', 'delete', 'manage'], AppDatabaseSqlite: ['manage'], AppSchedule: ['create', 'read', 'update', 'delete'], Messaging: ['publish', 'subscribe', 'wildcard', 'direct'], Webhook: ['create', 'read', 'update', 'delete', 'manage'], Theme: ['read', 'write'] }) },
  { route: '/api/admin/settings', handler: (res) => json(res, [
    { key: 'backend.url', value: '', label: 'Backend URL', category: 'backend', type: 'text', required: false, is_set: false },
    { key: 'backend.assist_url', value: '', label: 'Assist URL', category: 'backend', type: 'text', required: false, is_set: false },
  ]) },
  { route: '/api/themes', handler: (res) => json(res, DEMO_THEMES) },
  { route: '/api/config/profiles', handler: (res) => json(res, []) },
  { route: '/api/config/system/preferences', handler: (res) => json(res, {}) },
  { route: '/api/supervisor/apps', handler: (res) => json(res, DEMO_APPS) },
  { route: '/api/appstore/jobs', handler: (res) => json(res, []) },
  { route: '/api/appstore/installed', handler: (res) => json(res, DEMO_APPS) },
  { route: '/api/appstore/catalog', handler: (res) => json(res, DEMO_APPS) },
  { route: '/api/states', handler: (res) => json(res, demoStates()) },
  { route: '/api/pages', handler: (res) => json(res, DEMO_PAGES) },
  { route: '/api/automations', handler: (res) => json(res, [
    { id: 'automation-morning', name: 'Guten Morgen', description: 'Licht & Heizung beim Aufstehen', enabled: true, triggers: [{ id: 't1', type: 'time', at: '07:00' }], actions: [{ id: 'a1', type: 'call_service', service: 'light.turn_on' }], last_run_at: new Date().toISOString(), next_run_at: new Date(Date.now() + 86400000).toISOString(), runs: [] },
    { id: 'automation-evening', name: 'Abendmodus', description: 'Fahre das Licht herunter', enabled: true, triggers: [{ id: 't1', type: 'time', at: '21:30' }], actions: [], last_run_at: new Date().toISOString(), next_run_at: new Date(Date.now() + 86400000).toISOString(), runs: [] },
  ]) },
  { route: '/api/files/shortcuts', handler: (res) => json(res, []) },
  { route: '/api/config/users/demo', handler: (res) => json(res, DEMO_USER) },
  { route: '/api/config/preferences/demo-user', handler: (res) => json(res, [
    { preference_key: 'rumahl-os-session-locked', preference_value: false },
    { preference_key: 'global_custom_css', preference_value: '' },
  ]) },
  { route: '/api/config/users/by-id/demo-user', handler: (res) => json(res, DEMO_USER) },
  { route: '/api/auth/verify', handler: (res) => json(res, DEMO_USER) },
  { route: '/api/auth/me', handler: (res) => json(res, DEMO_USER) },
  { route: '/api/auth/users', handler: (res) => json(res, [
    { id: 'demo-user', username: 'demo', display_name: 'Demo Benutzer', avatar_url: null, has_pin: false },
    { id: 'demo-child', username: 'kinder', display_name: 'Kind', avatar_url: null, has_pin: true },
  ]) },
  { route: '/api/notifications', handler: (res) => json(res, [
    { id: 'n1', title: 'System aktualisiert', message: 'rumahl OS wurde auf Version 2.0.0 aktualisiert.', level: 'info', source: 'system', read: false, created_at: new Date().toISOString() },
    { id: 'n2', title: 'Neues Gerät erkannt', message: 'Ein neues Smart-Home-Gerät wurde im Netzwerk gefunden.', level: 'warning', source: 'discovery', read: false, created_at: new Date().toISOString() },
    { id: 'n3', title: 'Backup abgeschlossen', message: 'Das nächtliche Backup war erfolgreich.', level: 'success', source: 'system', read: true, created_at: new Date(Date.now() - 86400000).toISOString() },
  ]) },
  { route: '/api/notifications/unread-count', handler: (res) => json(res, { count: 2 }) },
  { route: '/api/alert/active', handler: (res) => json(res, { active: false }) },
  { route: '/api/system-events/client', handler: (res) => json(res, { ok: true }) },
  { route: '/api/clipboard', handler: (res) => json(res, { entries: [] }) },
  { route: '/api/config/users', handler: (res) => json(res, []) },
  { route: '/api/config/app-settings', handler: (res) => json(res, []) },
  { route: '/api/config/system/preferences', handler: (res) => json(res, [
    { preference_key: 'global_custom_css', preference_value: '' },
    { preference_key: 'user_custom_css', preference_value: '' },
    { preference_key: 'rumahl-os-accent-icons', preference_value: false },
  ]) },
  { route: '/api/admin/system-notifications', handler: (res) => json(res, []), },
  { route: '/api/admin/notifications', handler: (res) => json(res, []) },
  { route: '/api/config/users', handler: (res) => json(res, [DEMO_USER]) },
  { route: '/api/config/users/demo-user/profiles', handler: (res) => json(res, [{ id: 'demo-user', name: 'Demo Profil', profile_type: 'user', owner_id: 'demo-user' }]) },
  { route: '/api/config/profiles', handler: (res) => json(res, []) },
  { route: '/api/config/profiles/demo-user/pages', handler: (res) => json(res, DEMO_PAGES) },
  { route: '/api/config/profiles/demo-user/layouts', handler: (res) => json(res, []) },
  { route: '/api/config/profiles/demo-user/page-settings', handler: (res) => json(res, []) },
  { route: '/api/config/devices', handler: (res) => json(res, []) },
  { route: '/api/apps/pages', handler: (res) => json(res, DEMO_APPS.map((a) => ({ id: a.pageId, appId: a.id, title: a.name, description: a.description, page_type: 'app', entities: {}, widgets: [], sub_pages: [], settings: {} }))) },
  { route: '/api/session/windows', handler: (res) => json(res, []) },
  { route: '/api/media/config', handler: (res) => json(res, { jellyfin_url: '', jellyfin_api_key: '', jellyfin_user_id: '', plex_url: '', plex_token: '' }) },
  { route: '/api/media/hub', handler: (res) => json(res, { jellyfin: { reachable: false, name: null }, plex: { reachable: false, name: null } }) },
  { route: '/api/remote/status', handler: (res) => json(res, { tailscale: { installed: false, online: false, hostname: null, ip: null }, wireguard: { installed: false, interfaces: [] } }) },
  { route: '/api/remote/config', handler: (res) => json(res, { external_url: '' }) },
]

// Handlers for GET routes that need a dynamic id match (served before the
// generic fallback). Return { route, handler, match }.
const GET_DYNAMIC = [
  { suffix: '/api/config/preferences/', fn: (res, id) => json(res, []) },
  { suffix: '/api/themes/css/', fn: (res, id) => json(res, { css: '', variables: {} }) },
  { suffix: '/api/themes/user/', fn: (res, rest) => json(res, { theme_id: 'auto', settings: {} }) },
]

function handleGet(pathname, res) {
  // Static GET routes
  for (const r of GET_201) {
    if (r.route === pathname) return r.handler(res)
  }
  // Match dynamic GET routes by prefix
  for (const d of GET_DYNAMIC) {
    if (pathname.startsWith(d.suffix)) {
      const rest = pathname.slice(d.suffix.length)
      return d.fn(res, rest)
    }
  }
  // System stats / diagnostics fallbacks
  if (pathname.startsWith('/health')) return json(res, { status: 'ok', version: '2.0.0-demo' })
  if (pathname.startsWith('/api/system-events')) return json(res, { ok: true })
  if (pathname.match(/^\/api\/themes\/user\//)) return json(res, { theme_id: 'auto', settings: {} })
  if (pathname.match(/^\/api\/themes\/css\//)) return json(res, { css: '', variables: {} })
  if (pathname.match(/^\/api\/config\/preferences\//)) return json(res, [])
  if (pathname.match(/^\/api\/config\/users\/[^/]+\/profiles/)) return json(res, [])
  if (pathname.match(/^\/api\/config\/profiles\/[^/]+\/pages/)) return json(res, DEMO_PAGES)
  if (pathname.match(/^\/api\/config\/profiles\/[^/]+\/(layouts|page-settings|timestamps)/)) return json(res, [])
  if (pathname.match(/^\/api\/config\/devices\/[^/]+/)) return json(res, { id: 'demo-device', name: 'Demo Gerät', type: 'demo' })
  if (pathname.match(/^\/api\/config\/profiles\/[^/]+/)) return json(res, {
    id: 'demo-user',
    name: 'Demo',
    owner_id: 'demo-user',
    profile_type: 'user',
    pages: DEMO_PAGES,
    background: {
      background_type: 'static',
      config: { type: 'static', url: '/assets/wallpapers/monstera.jpg', position: 'center', size: 'cover', fixed: true, opacity: 100, blur: 0, brightness: 100 },
      is_active: true,
    },
  })
  if (pathname.match(/^\/api\/config\/users\//)) return json(res, DEMO_USER)
  // Files: list the demo files (Bilder) and serve their binary download.
  if (pathname === '/api/files') return json(res, { files: DEMO_FILES })
  if (pathname.startsWith('/api/files/system-folder')) {
    const name = decodeURIComponent((pathname.match(/name=([^&]+)/) || [])[1] || '')
    return json(res, { folder: { id: `sf-${name.toLowerCase()}` } })
  }
  if (pathname.match(/^\/api\/files\/([^/]+)\/download/)) {
    const fileId = decodeURIComponent(pathname.match(/^\/api\/files\/([^/]+)\/download/)[1])
    const entry = DEMO_FILES.find((f) => f.id === fileId)
    if (entry && fs.existsSync(MONSTERA_PATH)) {
      const buf = fs.readFileSync(MONSTERA_PATH)
      res.statusCode = 200
      res.setHeader('Content-Type', entry.mime_type || 'application/octet-stream')
      res.setHeader('Content-Length', String(buf.length))
      return res.end(buf)
    }
    return json(res, { error: 'not found' }, 404)
  }
  if (pathname.match(/^\/api\/files\//)) return json(res, [])
  // Generic fallback: most boot/list GET endpoints expect an array. Return an
  // empty array so consumers (notifications, entities, pages, apps, ...) never
  // crash with "<x>.filter is not a function".
  return json(res, [])
}

function handlePost(pathname, body, res) {
  if (pathname === '/api/auth/login') return json(res, { token: DEMO_TOKEN, refresh_token: DEMO_REFRESH, user: DEMO_USER })
  if (pathname === '/api/auth/guest') return json(res, { token: DEMO_TOKEN, refresh_token: DEMO_REFRESH, user: DEMO_USER })
  if (pathname === '/api/auth/register') return json(res, { token: DEMO_TOKEN, refresh_token: DEMO_REFRESH, user: DEMO_USER })
  if (pathname === '/api/auth/refresh') return json(res, { access_token: DEMO_TOKEN, refresh_token: DEMO_REFRESH })
  if (pathname === '/api/auth/pin-login') return json(res, { token: DEMO_TOKEN, refresh_token: DEMO_REFRESH, user: DEMO_USER })
  if (pathname === '/api/config/profiles' || pathname.match(/^\/api\/config\/profiles\b/)) return json(res, { id: 'demo-user', name: 'Demo Profil', profile_type: 'user', owner_id: 'demo-user' }, 201)
  if (pathname.match(/^\/api\/services\//)) return json(res, { ok: true })
  if (pathname === '/api/files/shortcuts') return json(res, { id: 'demo-shortcut', ok: true }, 201)
  if (pathname.match(/^\/api\/files\//)) return json(res, { id: 'demo-file', ok: true }, 201)
  if (pathname === '/api/appstore/install') return json(res, { ok: true, id: 'demo-app', status: 'installed' })
  return ack(res)
}

function handlePut(pathname, body, res) {
  if (pathname.match(/^\/api\/themes\/user\//)) return json(res, { ok: true })
  if (pathname.match(/^\/api\/config\/preferences\//)) return json(res, { ok: true })
  if (pathname.match(/^\/api\/config\/users\//)) return json(res, DEMO_USER)
  if (pathname === '/api/config/system/preferences') return json(res, { ok: true })
  if (pathname.match(/^\/api\/admin\/settings/)) return json(res, { ok: true })
  return ack(res)
}

function handleDelete(pathname, res) {
  return ack(res)
}

// ── Vite plugin export ───────────────────────────────────────────────────────
export default function demoServerPlugin() {
  return {
    name: 'rumahl-demo-backend',
    configureServer(server) {
      // HTTP API mock
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://demo.local')
        const pathname = url.pathname
        if (!pathname.startsWith('/api')) return next()

        // Read body for POST/PUT
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body = null
          try { body = raw ? JSON.parse(raw) : null } catch { /* keep null */ }
          if (req.method === 'GET') return handleGet(pathname, res)
          if (req.method === 'POST') return handlePost(pathname, body, res)
          if (req.method === 'PUT') return handlePut(pathname, body, res)
          if (req.method === 'DELETE') return handleDelete(pathname, res)
          return ack(res)
        })
      })

      // /health + /uploads stubs
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://demo.local')
        if (url.pathname.startsWith('/health')) return json(res, { status: 'ok', version: '2.0.0-demo' })
        if (url.pathname.startsWith('/uploads')) return json(res, { ok: true })
        return next()
      })
    },
  }
}


