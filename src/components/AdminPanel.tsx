import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Users, Key, HardDrive, CloudArrowUp,
  Cpu, WifiHigh, Cube, Gear, ListBullets, Database,
  ArrowClockwise, Copy, Trash, Plus,
  Warning, Power, PencilSimple, LockKey, UserMinus,
  MagnifyingGlass, ToggleLeft, ToggleRight,
  FilmSlate, Archive, Globe, Play, X,
  Bluetooth, Tree, LinkSimple, AppleLogo, Pulse, Wrench,
  CloudWarning, ShieldWarning, Siren,
  WebhooksLogo, Broadcast, Lightning, Eye, PaperPlaneTilt, CheckCircle, XCircle, Clock,
  MagnifyingGlassPlus, Timer, ChartLine, BookOpen, CalendarBlank, TrendUp, Heartbeat, Dog, CaretDown, CaretUp,
  Gauge, ListChecks, Robot, Hand, Queue, CircleNotch
} from '@phosphor-icons/react'
import { Tip } from '@/components/ui/tip'
import { toast } from 'sonner'
import { SystemInfoTab, PluginsTab, RegistrationManagementTab, SecurityMonitorTab, UpdateManagementTab, WidgetManagementTab, AppStoreTab } from './AdminPanelTabs'
import { InfrastructureVisualization } from './InfrastructureVisualization'

interface CloudSettings {
  connectorHost: string
  useTls: boolean
  privatePort: number
  publicProxyPort: number
  enableReverseProxy: boolean
  requireVpnOnly: boolean
}

interface AdminUser {
  id: string
  username: string
  display_name?: string
  avatar_url?: string
  role: string
  is_admin: boolean
  has_password: boolean
  has_pin: boolean
  created_at: string
  updated_at: string
}

interface ApiKeyEntry {
  id: string
  user_id: string
  name: string
  key_prefix: string
  permissions: string
  rate_limit: number
  last_used_at?: string
  expires_at?: string
  is_active: boolean
  created_at: string
}

interface ApiKeyWithSecret extends ApiKeyEntry {
  key: string
}

type Tab = 'services' | 'tasks' | 'control-mode' | 'system' | 'system-info' | 'network' | 'infrastructure' | 'users' | 'api-keys' | 'webhooks' | 'ha-config' | 'ha-connection' | 'integrations' | 'mqtt' | 'matter' | 'zigbee' | 'zwave' | 'ble' | 'homekit' | 'scenes' | 'automations' | 'backups' | 'cloud-settings' | 'logs' | 'realtime' | 'database' | 'warnings' | 'entities' | 'scheduler' | 'analytics' | 'logbook' | 'calendars' | 'system-notifications' | 'apps' | 'plugins' | 'registrations' | 'security-monitor' | 'updates' | 'widgets'

const tabs: { id: Tab; label: string; icon: typeof ShieldCheck; description: string }[] = [
  { id: 'services', label: 'Dienste', icon: Gauge, description: 'Alle IORA-Dienste überwachen — Status, Erreichbarkeit und Uptime aller Microservices' },
  { id: 'tasks', label: 'Aufgaben', icon: ListChecks, description: 'Hintergrund-Aufgaben und Warteschlangen überwachen, Aufgaben manuell auslösen oder deaktivieren' },
  { id: 'control-mode', label: 'Betriebsmodus', icon: Robot, description: 'Zwischen autonomem, manuellem und überwachtem Betriebsmodus wechseln' },
  { id: 'system', label: 'System', icon: Cpu, description: 'CPU, RAM, Speicher, Uptime und System-Auslastung überwachen' },
  { id: 'system-info', label: 'System Info', icon: Heartbeat, description: 'Detaillierte Systeminformationen von IORA OS — CPU, RAM, Festplatten und Netzwerk' },
  { id: 'network', label: 'Netzwerk', icon: Globe, description: 'Netzwerk-Informationen und IP-Konfiguration verwalten' },
  { id: 'infrastructure', label: 'Infrastruktur', icon: TrendUp, description: 'Live-Visualisierung der gesamten IORA-Infrastruktur mit Service-Status und Datenflüssen' },
  { id: 'users', label: 'Benutzer', icon: Users, description: 'Benutzerkonten verwalten, Rollen zuweisen und Zugänge kontrollieren' },
  { id: 'apps', label: 'Apps', icon: Cube, description: 'Docker-basierte Apps verwalten — installieren, starten, stoppen und deinstallieren' },
  { id: 'plugins', label: 'Plugins', icon: Lightning, description: 'Code-Erweiterungen verwalten — Plugins on-demand in Sandbox ausführen' },
  { id: 'registrations', label: 'Registrierungen', icon: ShieldCheck, description: 'App- und Plugin-Registrierungen genehmigen, ablehnen oder widerrufen' },
  { id: 'security-monitor', label: 'Sicherheit', icon: ShieldWarning, description: 'Sicherheitswarnungen, Ressourcennutzung und Anomalie-Erkennung überwachen' },
  { id: 'updates', label: 'Updates', icon: CloudArrowUp, description: 'Verfügbare Updates prüfen, installieren oder zurückrollen' },
  { id: 'widgets', label: 'Widgets', icon: Cube, description: 'Registrierte Widgets von Apps und Plugins verwalten' },
  { id: 'api-keys', label: 'API Keys', icon: Key, description: 'API-Schlüssel erstellen und verwalten für externe Zugriffe' },
  { id: 'webhooks', label: 'Webhooks', icon: WebhooksLogo, description: 'Ausgehende Webhooks registrieren für Echtzeit-Event-Zustellung mit HMAC-Signaturen' },
  { id: 'ha-config', label: 'HA Config', icon: Gear, description: 'Home Assistant URL und Token konfigurieren' },
  { id: 'ha-connection', label: 'HA Status', icon: Pulse, description: 'Verbindungsstatus zu Home Assistant, erkannte Integrationen und Ereignis-Log' },
  { id: 'integrations', label: 'Integrationen', icon: Cube, description: 'Alle in Home Assistant installierten Integrationen anzeigen' },
  { id: 'entities', label: 'Entities', icon: MagnifyingGlassPlus, description: 'Alle Entitäten durchsuchen, filtern und Details mit Verlaufsdaten anzeigen' },
  { id: 'mqtt', label: 'MQTT', icon: WifiHigh, description: 'MQTT-Broker verbinden, Topics abonnieren und Nachrichten senden/empfangen' },
  { id: 'zigbee', label: 'Zigbee', icon: Tree, description: 'Zigbee-Netzwerk verwalten (Zigbee2MQTT / ZHA), Geräte und Signalqualität' },
  { id: 'zwave', label: 'Z-Wave', icon: LinkSimple, description: 'Z-Wave Nodes und Netzwerk-Topologie über Z-Wave JS überwachen' },
  { id: 'matter', label: 'Matter', icon: HardDrive, description: 'Matter-Bridge konfigurieren, Geräte und Fabrics verwalten' },
  { id: 'ble', label: 'Bluetooth', icon: Bluetooth, description: 'Bluetooth/BLE-Geräte, Adapter und Signalstärke überwachen' },
  { id: 'homekit', label: 'HomeKit', icon: AppleLogo, description: 'HomeKit-Bridge konfigurieren und Zubehör-Zuordnungen verwalten' },
  { id: 'scenes', label: 'Szenen', icon: FilmSlate, description: 'Home Assistant Szenen anzeigen und aktivieren' },
  { id: 'automations', label: 'Automationen', icon: Power, description: 'Alle Automationen anzeigen, Status prüfen und letzte Auslösung sehen' },
  { id: 'scheduler', label: 'Scheduler', icon: Timer, description: 'Zeitpläne und Watchdogs für automatisierte Aktionen verwalten' },
  { id: 'analytics', label: 'Analytics', icon: ChartLine, description: 'Dashboard-Statistiken, Entity-Nutzung und System-Gesundheit überwachen' },
  { id: 'backups', label: 'Backups', icon: Archive, description: 'Dashboard-Konfiguration sichern und wiederherstellen' },
  { id: 'cloud-settings', label: 'IORA Cloud', icon: CloudArrowUp, description: 'Private API-URL und Ports für den Cloud Connector konfigurieren' },
  { id: 'logs', label: 'Logs', icon: ListBullets, description: 'System- und Home Assistant Logs in Echtzeit einsehen' },
  { id: 'logbook', label: 'Logbuch', icon: BookOpen, description: 'Home Assistant Logbuch — chronologischer Verlauf aller Zustandsänderungen und Ereignisse' },
  { id: 'calendars', label: 'Kalender', icon: CalendarBlank, description: 'Home Assistant Kalender-Entitäten und anstehende Termine anzeigen' },
  { id: 'realtime', label: 'Realtime', icon: Broadcast, description: 'SSE Event-Streams und Socket.IO-Namespace-WebSocket für Echtzeit-Daten testen und überwachen' },
  { id: 'database', label: 'Datenbank', icon: Database, description: 'SQLite-Datenbank verwalten, bereinigen und Statistiken anzeigen' },
  { id: 'warnings', label: 'Warnungen', icon: ShieldWarning, description: 'Protokoll aller Wetter- und Zivilschutzwarnungen mit Zeitstempeln' },
  { id: 'system-notifications', label: 'System-Meldungen', icon: Siren, description: 'Systemmeldungen zu Sync-Status, Datenlücken und Backend-Warnungen – nur für Admins sichtbar' },
]

type TabGroup = {
  id: string
  title: string
  icon: typeof ShieldCheck
  items: Tab[]
}

const tabGroups: TabGroup[] = [
  { id: 'core', title: 'System & Kontrolle', icon: Cpu, items: ['services', 'tasks', 'control-mode', 'system', 'system-info', 'network', 'infrastructure'] },
  { id: 'extensions', title: 'Apps & Plugins', icon: Lightning, items: ['apps', 'plugins', 'registrations', 'security-monitor', 'updates', 'widgets'] },
  { id: 'home', title: 'Home Assistant', icon: Cube, items: ['ha-config', 'ha-connection', 'integrations', 'entities', 'scenes', 'automations', 'logbook', 'calendars'] },
  { id: 'devices', title: 'Geräte & Netzwerk', icon: WifiHigh, items: ['mqtt', 'zigbee', 'zwave', 'matter', 'ble', 'homekit'] },
  { id: 'tools', title: 'Tools & Infrastruktur', icon: Wrench, items: ['api-keys', 'webhooks', 'scheduler', 'analytics', 'backups', 'cloud-settings', 'logs', 'database', 'warnings', 'system-notifications'] },
  { id: 'access', title: 'Benutzer', icon: Users, items: ['users'] },
]

const CLOUD_HOST_KEY = 'iora-cloud-connector-host'
const CLOUD_USE_TLS_KEY = 'iora-cloud-connector-use-tls'
const CLOUD_PRIVATE_PORT_KEY = 'iora-cloud-connector-private-port'
const CLOUD_PUBLIC_PORT_KEY = 'iora-cloud-connector-public-port'
const CLOUD_ENABLE_REVERSE_PROXY_KEY = 'iora-cloud-connector-enable-reverse-proxy'
const CLOUD_REQUIRE_VPN_KEY = 'iora-cloud-connector-require-vpn'

function CloudSettingsTab({ token }: { token: string }) {
  const [settings, setSettings] = useState<CloudSettings>({
    connectorHost: '',
    useTls: true,
    privatePort: 3001,
    publicProxyPort: 443,
    enableReverseProxy: true,
    requireVpnOnly: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [testInfo, setTestInfo] = useState<{ online: boolean; ha: boolean; entities: number } | null>(null)

  useEffect(() => {
    const persistedHost = localStorage.getItem(CLOUD_HOST_KEY)
    const persistedTls = localStorage.getItem(CLOUD_USE_TLS_KEY)
    const persistedPrivatePort = localStorage.getItem(CLOUD_PRIVATE_PORT_KEY)
    const persistedPublicPort = localStorage.getItem(CLOUD_PUBLIC_PORT_KEY)
    const persistedReverseProxy = localStorage.getItem(CLOUD_ENABLE_REVERSE_PROXY_KEY)
    const persistedVpnOnly = localStorage.getItem(CLOUD_REQUIRE_VPN_KEY)

    setSettings((current) => ({
      connectorHost: persistedHost ?? current.connectorHost,
      useTls: persistedTls === null ? current.useTls : persistedTls === 'true',
      privatePort: persistedPrivatePort ? Number(persistedPrivatePort) : current.privatePort,
      publicProxyPort: persistedPublicPort ? Number(persistedPublicPort) : current.publicProxyPort,
      enableReverseProxy: persistedReverseProxy === null ? current.enableReverseProxy : persistedReverseProxy === 'true',
      requireVpnOnly: persistedVpnOnly === null ? current.requireVpnOnly : persistedVpnOnly === 'true',
    }))
    setLoading(false)
  }, [])

  const saveSettings = useCallback(async () => {
    setSaving(true)
    setError(null)

    const payload = {
      connector_host: settings.connectorHost,
      use_tls: settings.useTls,
      private_port: settings.privatePort,
      public_proxy_port: settings.publicProxyPort,
      enable_reverse_proxy: settings.enableReverseProxy,
      require_vpn_only: settings.requireVpnOnly,
    }

    try {
      await adminFetch('/api/admin/iora-cloud/config', token, {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
    } catch {
      // Fallback: save locally if backend is not available
    }

    localStorage.setItem(CLOUD_HOST_KEY, settings.connectorHost)
    localStorage.setItem(CLOUD_USE_TLS_KEY, String(settings.useTls))
    localStorage.setItem(CLOUD_PRIVATE_PORT_KEY, String(settings.privatePort))
    localStorage.setItem(CLOUD_PUBLIC_PORT_KEY, String(settings.publicProxyPort))
    localStorage.setItem(CLOUD_ENABLE_REVERSE_PROXY_KEY, String(settings.enableReverseProxy))
    localStorage.setItem(CLOUD_REQUIRE_VPN_KEY, String(settings.requireVpnOnly))

    toast.success('IORA Cloud Einstellungen gespeichert')
    setSaving(false)
  }, [settings, token])

  const testConnection = useCallback(async () => {
    if (!settings.connectorHost.trim()) {
      setTestState('error')
      setTestError('Bitte eine Host-IP oder einen Hostnamen eingeben.')
      return
    }

    setTestState('testing')
    setTestError(null)
    setTestInfo(null)

    const protocol = settings.useTls ? 'https' : 'http'
    const url = `${protocol}://${settings.connectorHost}:${settings.privatePort}/health`

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTestInfo({
        online: true,
        ha: data.ha_connected ?? false,
        entities: data.entity_count ?? 0,
      })
      setTestState('success')
    } catch (err) {
      setTestState('error')
      setTestError(err instanceof Error ? err.message : 'Verbindung fehlgeschlagen')
    }
  }, [settings])

  const currentUrl = `${settings.useTls ? 'https' : 'http'}://${settings.connectorHost}${settings.privatePort ? `:${settings.privatePort}` : ''}`

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-center gap-3 mb-4">
          <CloudArrowUp size={18} className="text-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">IORA Cloud Connector</p>
            <p className="text-xs text-foreground/60">Konfiguriere den Connector mit IP, Ports und Verschlüsselung.</p>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">Connector Host / IP</label>
            <input
              type="text"
              value={settings.connectorHost}
              onChange={(event) => setSettings({ ...settings, connectorHost: event.target.value })}
              placeholder="10.0.0.2"
              className="w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">Protokoll</label>
              <select
                value={settings.useTls ? 'https' : 'http'}
                onChange={(event) => setSettings({ ...settings, useTls: event.target.value === 'https' })}
                className="w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
              >
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">Privater API Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={settings.privatePort}
                onChange={(event) => setSettings({ ...settings, privatePort: Number(event.target.value) || 3001 })}
                className="w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">Öffentlicher Proxy-Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={settings.publicProxyPort}
                onChange={(event) => setSettings({ ...settings, publicProxyPort: Number(event.target.value) || 443 })}
                className="w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={settings.enableReverseProxy}
                onChange={(event) => setSettings({ ...settings, enableReverseProxy: event.target.checked })}
                className="h-4 w-4 rounded border-white/10 bg-background text-accent focus:ring-accent"
              />
              Öffentlichen Reverse-Proxy aktivieren
            </label>
            <label className="flex items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={settings.requireVpnOnly}
                onChange={(event) => setSettings({ ...settings, requireVpnOnly: event.target.checked })}
                className="h-4 w-4 rounded border-white/10 bg-background text-accent focus:ring-accent"
              />
              Nur VPN/Tailscale-Zugriff auf privaten Port
            </label>
          </div>

          <div className="rounded-3xl border border-foreground/10 bg-foreground/5 p-4 text-sm text-foreground/70">
            <p className="font-semibold text-foreground">Wichtig</p>
            <p className="mt-2">Der Connector soll auf allen ihm zugewiesenen IP-Adressen hören. Der private API-Port ist für interne Cloud-Verbindungen vorgesehen, der öffentliche Proxy-Port nur für verschlüsselte Zugriffe.</p>
            <p className="mt-2">Diese Seite ist die einzige Stelle zur Einrichtung und Anpassung des IORA Cloud Connectors.</p>
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/60">Berechnete Connector-URL</label>
            <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground">{currentUrl}</div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving || loading}
              className="inline-flex items-center justify-center rounded-3xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent/95 disabled:opacity-50"
            >
              {saving ? 'Speichert…' : 'Einstellungen speichern'}
            </button>
            <button
              type="button"
              onClick={testConnection}
              disabled={!settings.connectorHost.trim() || testState === 'testing'}
              className="inline-flex items-center justify-center rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-foreground transition hover:bg-white/10 disabled:opacity-50"
            >
              {testState === 'testing' ? 'Teste Verbindung…' : 'Verbindung testen'}
            </button>
          </div>

          {testState === 'success' && testInfo && (
            <div className="rounded-3xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-foreground">
              <p className="font-semibold text-green-600">Verbindung erfolgreich</p>
              <p className="mt-2">Status: online</p>
              <p>Home Assistant: {testInfo.ha ? 'verbunden' : 'nicht verbunden'}</p>
              <p>Entitäten: {testInfo.entities}</p>
            </div>
          )}

          {testState === 'error' && (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-destructive">
              <p className="font-semibold text-red-600">Verbindung fehlgeschlagen</p>
              <p className="mt-2">{testError}</p>
            </div>
          )}

          {error && <div className="rounded-3xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}
        </div>
      </div>
    </div>
  )
}

const API_BASE = import.meta.env.VITE_BACKEND_URL || ''

export async function adminFetch(path: string, token: string, options?: RequestInit) {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = `HTTP ${res.status}`
    try {
      const json = JSON.parse(text)
      if (json?.error) message = json.error
      else if (json?.message) message = json.message
    } catch {
      if (text) message = text
    }
    console.error('Admin fetch failed:', { url, status: res.status, statusText: res.statusText, body: text })
    if (res.status === 403) {
      throw new Error('Kein Admin-Zugriff. Bitte neu einloggen.')
    }
    throw new Error(`${message} (${res.status})`)
  }
  return res.json()
}

// Simple cache so tab switches don't re-fetch
const dataCache = new Map<string, { data: unknown; ts: number }>()
const CACHE_TTL = 120_000 // 2 minutes – backend also caches, so this is safe

// Paths that change rarely and benefit from longer caching
const LONG_TTL_PATHS = new Set([
  '/api/admin/ha/config', '/api/admin/ha/services', '/api/admin/ha/integrations',
  '/api/admin/ha/supervisor', '/api/admin/ha/addons', '/api/admin/ha/backups',
  '/api/admin/ha/network', '/api/admin/ha/scenes', '/api/admin/ha/automations',
  '/api/admin/ha/mqtt', '/api/admin/ha/matter', '/api/admin/system/database',
])
const LONG_CACHE_TTL = 300_000 // 5 minutes for stable data

async function cachedFetch(path: string, token: string): Promise<unknown> {
  const ttl = LONG_TTL_PATHS.has(path) ? LONG_CACHE_TTL : CACHE_TTL
  const cached = dataCache.get(path)
  if (cached && Date.now() - cached.ts < ttl) return cached.data
  const data = await adminFetch(path, token)
  dataCache.set(path, { data, ts: Date.now() })
  return data
}

/// Prefetch data for adjacent tabs so switching feels instant
function prefetchAdjacentTabs(activeTab: string, token: string) {
  const tabDataMap: Record<string, string[]> = {
    'system': ['/api/admin/ha/config', '/api/admin/ha/supervisor'],
    'ha-config': ['/api/system/stats', '/api/system/ha-info', '/api/admin/ha/integrations'],
    'integrations': ['/api/admin/ha/config', '/api/admin/ha/mqtt'],
    'mqtt': ['/api/admin/ha/integrations', '/api/admin/ha/matter'],
    'matter': ['/api/admin/ha/mqtt', '/api/admin/ha/scenes'],
    'scenes': ['/api/admin/ha/matter', '/api/admin/ha/automations'],
    'automations': ['/api/admin/ha/scenes', '/api/admin/ha/backups'],
    'backups': ['/api/admin/ha/automations', '/api/admin/ha/network'],
    'network': ['/api/admin/ha/backups'],
    'database': ['/api/admin/system/database'],
    'webhooks': ['/api/webhooks'],
    'realtime': [],
    'entities': ['/api/entities/count'],
    'services': ['/api/admin/control/overview'],
    'tasks': ['/api/admin/control/services'],
    'control-mode': ['/api/admin/control/tasks'],
    'scheduler': ['/api/integration/schedules', '/api/integration/watchdogs'],
    'analytics': ['/api/stats/dashboard', '/api/integration/health'],
    'logbook': ['/api/admin/ha/logbook'],
    'calendars': ['/api/admin/ha/calendars'],
  }
  const paths = tabDataMap[activeTab] || []
  for (const path of paths) {
    if (!dataCache.has(path) || Date.now() - (dataCache.get(path)?.ts ?? 0) > CACHE_TTL) {
      cachedFetch(path, token).catch(() => {}) // fire-and-forget
    }
  }
}

function adminPathToTab(path: string): Tab {
  const segments = path.split('/').filter(Boolean)
  if (segments[0] !== 'admin') return 'services'
  const sub = segments[1]
  if (!sub) return 'services'
  if (sub === 'cloud') return 'cloud-settings'
  if (tabs.some((t) => t.id === sub)) return sub as Tab
  return 'services'
}

function tabToAdminPath(tab: Tab): string {
  if (tab === 'services') return '/admin'
  if (tab === 'cloud-settings') return '/admin/cloud'
  return `/admin/${tab}`
}

export function AdminPanel() {
  const { token } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>(() => adminPathToTab(window.location.pathname))
  const [expandedGroup, setExpandedGroup] = useState<string>('core')

  if (!token) return null

  // Sync admin tab state with URL
  useEffect(() => {
    const path = tabToAdminPath(activeTab)
    if (window.location.pathname !== path) {
      window.history.replaceState({}, '', path)
    }
  }, [activeTab])

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(adminPathToTab(window.location.pathname))
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Prefetch adjacent tab data when tab changes
  useEffect(() => {
    prefetchAdjacentTabs(activeTab, token)
  }, [activeTab, token])

  return (
    <div className="pb-28">
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="glass-card rounded-3xl border border-white/10 bg-white/10 p-4 shadow-xl shadow-black/5 backdrop-blur-xl">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck size={24} weight="fill" className="text-accent" />
            <div>
              <p className="text-sm font-semibold text-foreground">IORA Control Center</p>
              <p className="text-xs text-foreground/60">Admin-Funktionen nach Bereich gruppiert.</p>
            </div>
          </div>
          <div className="space-y-4">
            {tabGroups.map(group => {
              const GroupIcon = group.icon
              const isExpanded = expandedGroup === group.id
              return (
                <div key={group.id} className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setExpandedGroup(isExpanded ? '' : group.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-3xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm font-semibold text-foreground transition hover:border-white/20 hover:bg-white/10"
                  >
                    <span className="flex items-center gap-2">
                      <GroupIcon size={16} />
                      {group.title}
                    </span>
                    <span className="text-[11px] text-foreground/50">{isExpanded ? 'Verstecken' : 'Anzeigen'}</span>
                  </button>
                  <div className={`space-y-1 overflow-hidden transition-all ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    {group.items.map(tabId => {
                      const tab = tabs.find(t => t.id === tabId)
                      if (!tab) return null
                      const isActive = activeTab === tab.id
                      const Icon = tab.icon
                      return (
                        <Tip key={tab.id} content={tab.description}>
                          <button
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex w-full items-center gap-2 rounded-3xl px-4 py-2 text-left text-sm transition ${
                              isActive
                                ? 'bg-accent/20 text-accent shadow-sm shadow-accent/10'
                                : 'text-foreground/70 hover:text-foreground hover:bg-white/5'
                            }`}
                          >
                            <Icon size={14} weight={isActive ? 'fill' : 'regular'} />
                            {tab.label}
                          </button>
                        </Tip>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </aside>

        <div className="space-y-3">
          <div className="glass-card rounded-3xl border border-white/10 bg-white/10 px-5 py-4 shadow-xl shadow-black/5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              {(() => { const t = tabs.find(t => t.id === activeTab); const Icon = t?.icon ?? Cpu; return <Icon size={18} className="text-accent" /> })()}
              <div>
                <p className="text-sm font-semibold text-foreground">{tabs.find(t => t.id === activeTab)?.label}</p>
                <p className="text-xs text-foreground/60">{tabs.find(t => t.id === activeTab)?.description}</p>
              </div>
            </div>
          </div>

          <div className="glass-card rounded-3xl border border-white/10 bg-white/10 px-4 py-2.5 mb-4 flex items-center gap-2 theme-transition">
            {(() => { const t = tabs.find(t => t.id === activeTab); const Icon = t?.icon ?? Cpu; return <Icon size={15} className="text-accent shrink-0" /> })()}
            <span className="text-xs text-foreground/70">{tabs.find(t => t.id === activeTab)?.description}</span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'services' && <ServicesTab token={token} />}
              {activeTab === 'tasks' && <TasksTab token={token} />}
              {activeTab === 'control-mode' && <ControlModeTab token={token} />}
              {activeTab === 'system' && <SystemTab token={token} />}
              {activeTab === 'system-info' && <SystemInfoTab token={token} />}
              {activeTab === 'infrastructure' && <InfrastructureVisualization token={token} />}
              {activeTab === 'apps' && <AppStoreTab token={token} />}
              {activeTab === 'plugins' && <PluginsTab token={token} />}
              {activeTab === 'registrations' && <RegistrationManagementTab token={token} />}
              {activeTab === 'security-monitor' && <SecurityMonitorTab token={token} />}
              {activeTab === 'updates' && <UpdateManagementTab token={token} />}
              {activeTab === 'widgets' && <WidgetManagementTab token={token} />}
              {activeTab === 'users' && <UsersTab token={token} />}
              {activeTab === 'api-keys' && <ApiKeysTab token={token} />}
              {activeTab === 'webhooks' && <WebhooksTab token={token} />}
              {activeTab === 'ha-config' && <HaConfigTab token={token} />}
              {activeTab === 'ha-connection' && <HaConnectionTab token={token} />}
              {activeTab === 'integrations' && <IntegrationsTab token={token} />}
              {activeTab === 'entities' && <EntitiesTab token={token} />}
              {activeTab === 'mqtt' && <MqttTab token={token} />}
              {activeTab === 'zigbee' && <ZigbeeTab token={token} />}
              {activeTab === 'zwave' && <ZwaveTab token={token} />}
              {activeTab === 'matter' && <MatterTab token={token} />}
              {activeTab === 'ble' && <BleTab token={token} />}
              {activeTab === 'homekit' && <HomekitTab token={token} />}
              {activeTab === 'scenes' && <ScenesTab token={token} />}
              {activeTab === 'automations' && <AutomationsTab token={token} />}
              {activeTab === 'scheduler' && <SchedulerTab token={token} />}
              {activeTab === 'analytics' && <AnalyticsTab token={token} />}
              {activeTab === 'backups' && <BackupsTab token={token} />}
              {activeTab === 'network' && <NetworkTab token={token} />}
              {activeTab === 'cloud-settings' && <CloudSettingsTab token={token} />}
              {activeTab === 'logs' && <LogsTab token={token} />}
              {activeTab === 'logbook' && <LogbookTab token={token} />}
              {activeTab === 'calendars' && <CalendarsTab token={token} />}
              {activeTab === 'realtime' && <RealtimeTab token={token} />}
              {activeTab === 'database' && <DatabaseTab token={token} />}
              {activeTab === 'warnings' && <WarningsTab token={token} />}
              {activeTab === 'system-notifications' && <SystemNotificationsTab token={token} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ── Services Tab (Dienste-Überwachung) ──────────────────────────────────

interface ServiceStatus {
  name: string
  url: string
  status: 'online' | 'offline' | 'degraded'
  response_time_ms?: number
  version?: string
  uptime?: string
  details?: Record<string, unknown>
}

function ServicesTab({ token }: { token: string }) {
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [svc, ov] = await Promise.all([
        adminFetch('/api/admin/control/services', token),
        cachedFetch('/api/admin/control/overview', token),
      ])
      setServices((svc as { services: ServiceStatus[] }).services ?? svc as ServiceStatus[])
      setOverview(ov as Record<string, unknown>)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const onlineCount = services.filter(s => s.status === 'online').length
  const totalCount = services.length

  return (
    <div className="space-y-3">
      {/* Overview Bar */}
      <AdminCard title="Übersicht" icon={Gauge}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{onlineCount}/{totalCount}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Dienste online</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.mode as string ?? '–'}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Betriebsmodus</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.watchdog_count as number ?? 0}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Watchdogs</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{overview?.scheduled_actions as number ?? 0}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Geplante Aktionen</div>
          </div>
        </div>
      </AdminCard>

      {/* Service Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {services.map(svc => (
          <AdminCard key={svc.name}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  svc.status === 'online' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' :
                  svc.status === 'degraded' ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' :
                  'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
                }`} />
                <div>
                  <h4 className="text-sm font-semibold text-foreground">{svc.name}</h4>
                  <span className="text-[10px] text-foreground/40 font-mono">{svc.url}</span>
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full ${
                svc.status === 'online' ? 'bg-green-500/15 text-green-300' :
                svc.status === 'degraded' ? 'bg-amber-500/15 text-amber-300' :
                'bg-red-500/15 text-red-300'
              }`}>
                {svc.status === 'online' ? 'Online' : svc.status === 'degraded' ? 'Eingeschränkt' : 'Offline'}
              </span>
            </div>
            <div className="space-y-0">
              {svc.response_time_ms !== undefined && (
                <StatItem label="Antwortzeit" value={`${svc.response_time_ms}ms`} />
              )}
              {svc.version && <StatItem label="Version" value={svc.version} />}
              {svc.uptime && <StatItem label="Uptime" value={svc.uptime} />}
              {svc.details && Object.entries(svc.details).map(([k, v]) => (
                <StatItem key={k} label={k} value={String(v)} />
              ))}
            </div>
          </AdminCard>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={() => { dataCache.delete('/api/admin/control/services'); dataCache.delete('/api/admin/control/overview'); load() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Tasks Tab (Aufgaben-Überwachung & Warteschlange) ──────────────────────────

interface BackgroundTask {
  id: number
  name: string
  task_type: string
  enabled: boolean
  interval_seconds?: number
  last_run_at?: string
  last_success_at?: string
  last_error?: string
  run_count: number
  error_count: number
}

function TasksTab({ token }: { token: string }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [triggerLoading, setTriggerLoading] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'errors'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/control/tasks', token)
      setTasks(Array.isArray(data) ? data : (data as { tasks: BackgroundTask[] }).tasks ?? [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const triggerTask = async (taskId: number) => {
    setTriggerLoading(taskId)
    try {
      await adminFetch(`/api/admin/control/tasks/${taskId}/trigger`, token, { method: 'POST' })
      await load()
    } catch { /* ignore */ }
    setTriggerLoading(null)
  }

  const toggleTask = async (taskId: number) => {
    try {
      await adminFetch(`/api/admin/control/tasks/${taskId}/toggle`, token, { method: 'POST' })
      await load()
    } catch { /* ignore */ }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const filtered = tasks.filter(t =>
    filter === 'all' ? true :
    filter === 'active' ? t.enabled :
    t.error_count > 0
  )

  const totalRuns = tasks.reduce((s, t) => s + t.run_count, 0)
  const totalErrors = tasks.reduce((s, t) => s + t.error_count, 0)
  const activeCount = tasks.filter(t => t.enabled).length

  return (
    <div className="space-y-3">
      {/* Stats */}
      <AdminCard title="Aufgaben-Statistik" icon={ListChecks}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{tasks.length}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Gesamt</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-green-300">{activeCount}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Aktiv</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className="text-2xl font-bold text-foreground">{totalRuns}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Ausführungen</div>
          </div>
          <div className="text-center p-3 rounded-xl bg-foreground/3">
            <div className={`text-2xl font-bold ${totalErrors > 0 ? 'text-red-300' : 'text-foreground'}`}>{totalErrors}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">Fehler</div>
          </div>
        </div>
      </AdminCard>

      {/* Filter */}
      <div className="flex gap-1.5">
        {(['all', 'active', 'errors'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filter === f ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
            }`}>
            {f === 'all' ? 'Alle' : f === 'active' ? 'Aktiv' : 'Fehler'}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-xs text-foreground/50">Keine Aufgaben gefunden.</div>
        ) : filtered.map(task => (
          <AdminCard key={task.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${task.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
                  <h4 className="text-sm font-semibold text-foreground truncate">{task.name}</h4>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/8 text-foreground/60">{task.task_type}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2">
                  {task.interval_seconds && (
                    <div className="text-[10px] text-foreground/50">
                      <span className="text-foreground/30">Intervall:</span> {task.interval_seconds >= 3600 ? `${Math.round(task.interval_seconds/3600)}h` : task.interval_seconds >= 60 ? `${Math.round(task.interval_seconds/60)}m` : `${task.interval_seconds}s`}
                    </div>
                  )}
                  <div className="text-[10px] text-foreground/50">
                    <span className="text-foreground/30">Läufe:</span> {task.run_count}
                  </div>
                  {task.error_count > 0 && (
                    <div className="text-[10px] text-red-300">
                      <span className="text-red-300/60">Fehler:</span> {task.error_count}
                    </div>
                  )}
                  {task.last_run_at && (
                    <div className="text-[10px] text-foreground/50">
                      <span className="text-foreground/30">Letzter Lauf:</span> {new Date(task.last_run_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
                {task.last_error && (
                  <div className="mt-2 p-2 rounded-lg bg-red-500/8 border border-red-500/15 text-[10px] text-red-300 font-mono truncate">
                    {task.last_error}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Tip content={task.enabled ? 'Aufgabe deaktivieren' : 'Aufgabe aktivieren'}>
                  <button onClick={() => toggleTask(task.id)}
                    className={`p-2 rounded-lg transition-all ${task.enabled ? 'text-green-300 hover:bg-green-500/15' : 'text-foreground/40 hover:bg-foreground/8'}`}>
                    {task.enabled ? <ToggleRight size={18} weight="fill" /> : <ToggleLeft size={18} />}
                  </button>
                </Tip>
                <Tip content="Jetzt auslösen">
                  <button onClick={() => triggerTask(task.id)} disabled={triggerLoading === task.id}
                    className="p-2 rounded-lg text-foreground/60 hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-40">
                    {triggerLoading === task.id ? <CircleNotch size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>
                </Tip>
              </div>
            </div>
          </AdminCard>
        ))}
      </div>

      <div className="flex justify-end">
        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Control Mode Tab (Betriebsmodus) ──────────────────────────────────────────

const MODE_CONFIG = {
  autonomous: {
    icon: Robot,
    label: 'Autonom',
    color: 'green',
    description: 'Das System führt alle Aufgaben, Watchdogs und Automationen selbstständig aus. Eingriffe sind nicht erforderlich.',
  },
  supervised: {
    icon: Eye,
    label: 'Überwacht',
    color: 'amber',
    description: 'Automationen laufen, aber kritische Aktionen erfordern eine Bestätigung. Benachrichtigungen bei wichtigen Entscheidungen.',
  },
  manual: {
    icon: Hand,
    label: 'Manuell',
    color: 'blue',
    description: 'Alle automatischen Aktionen sind pausiert. Aufgaben müssen manuell ausgelöst werden.',
  },
} as const

type ControlMode = keyof typeof MODE_CONFIG

function ControlModeTab({ token }: { token: string }) {
  const [currentMode, setCurrentMode] = useState<ControlMode>('autonomous')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/control/mode', token) as { mode: string }
      setCurrentMode((data.mode || 'autonomous') as ControlMode)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const setMode = async (mode: ControlMode) => {
    if (mode === currentMode) return
    setSaving(true)
    try {
      await adminFetch('/api/admin/control/mode', token, {
        method: 'PUT',
        body: JSON.stringify({ mode }),
      })
      setCurrentMode(mode)
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const currentConfig = MODE_CONFIG[currentMode]

  return (
    <div className="space-y-3">
      {/* Current Mode Display */}
      <AdminCard>
        <div className="flex items-center gap-4 py-2">
          <div className={`p-4 rounded-2xl ${
            currentConfig.color === 'green' ? 'bg-green-500/15' :
            currentConfig.color === 'amber' ? 'bg-amber-500/15' :
            'bg-blue-500/15'
          }`}>
            <currentConfig.icon size={32} weight="fill" className={
              currentConfig.color === 'green' ? 'text-green-300' :
              currentConfig.color === 'amber' ? 'text-amber-300' :
              'text-blue-300'
            } />
          </div>
          <div className="flex-1">
            <div className="text-xs text-foreground/40 uppercase tracking-wider mb-0.5">Aktueller Betriebsmodus</div>
            <div className={`text-xl font-bold ${
              currentConfig.color === 'green' ? 'text-green-300' :
              currentConfig.color === 'amber' ? 'text-amber-300' :
              'text-blue-300'
            }`}>{currentConfig.label}</div>
            <p className="text-xs text-foreground/60 mt-1">{currentConfig.description}</p>
          </div>
        </div>
      </AdminCard>

      {/* Mode Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.entries(MODE_CONFIG) as [ControlMode, typeof MODE_CONFIG[ControlMode]][]).map(([mode, config]) => {
          const isActive = mode === currentMode
          const Icon = config.icon
          const colorClasses = config.color === 'green'
            ? { bg: 'bg-green-500/8', border: 'border-green-500/30', text: 'text-green-300', activeBg: 'bg-green-500/15' }
            : config.color === 'amber'
            ? { bg: 'bg-amber-500/8', border: 'border-amber-500/30', text: 'text-amber-300', activeBg: 'bg-amber-500/15' }
            : { bg: 'bg-blue-500/8', border: 'border-blue-500/30', text: 'text-blue-300', activeBg: 'bg-blue-500/15' }

          return (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              disabled={saving}
              className={`glass-card rounded-2xl p-4 text-left transition-all border-2 ${
                isActive
                  ? `${colorClasses.activeBg} ${colorClasses.border} shadow-lg`
                  : 'border-transparent hover:border-foreground/15 hover:bg-foreground/3'
              } disabled:opacity-50`}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} className={isActive ? colorClasses.text : 'text-foreground/50'} />
                <span className={`text-sm font-semibold ${isActive ? colorClasses.text : 'text-foreground/80'}`}>{config.label}</span>
                {isActive && <CheckCircle size={16} weight="fill" className={colorClasses.text + ' ml-auto'} />}
              </div>
              <p className="text-[10px] text-foreground/50 leading-relaxed">{config.description}</p>
            </button>
          )
        })}
      </div>

      {/* Info */}
      <AdminCard title="Hinweise" icon={Warning}>
        <div className="space-y-2 text-xs text-foreground/60">
          <p>• <strong className="text-foreground/80">Autonom:</strong> Empfohlen für den Normalbetrieb. Watchdogs, Scheduler und Automationen arbeiten selbstständig.</p>
          <p>• <strong className="text-foreground/80">Überwacht:</strong> Ideal für Tests oder sensible Phasen. Kritische Aktionen erfordern Bestätigung.</p>
          <p>• <strong className="text-foreground/80">Manuell:</strong> Für Wartungsarbeiten oder Fehlersuche. Alle automatischen Prozesse pausiert.</p>
          <p className="text-foreground/40 mt-2">Der Modus wird sofort über WebSocket an alle verbundenen Clients propagiert.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────

export function AdminCard({ children, title, icon: Icon, className = '' }: {
  children: React.ReactNode
  title?: string
  icon?: typeof Cpu
  className?: string
}) {
  return (
    <div className={`glass-card rounded-2xl p-4 theme-transition ${className}`}>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {Icon && <Icon size={16} className="text-accent" />}
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
      )}
      {children}
    </div>
  )
}

function StatItem({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-foreground/5 last:border-0">
      <span className="text-xs text-foreground/85">{label}</span>
      <span className="text-xs font-medium text-foreground">{value ?? '–'}</span>
    </div>
  )
}

// ── System Tab ──────────────────────────────────────────────────

function SystemTab({ token }: { token: string }) {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [haInfo, setHaInfo] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [maintenanceActive, setMaintenanceActive] = useState(false)
  const [maintenanceMsg, setMaintenanceMsg] = useState('')
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, h, m] = await Promise.all([
        cachedFetch('/api/system/stats', token),
        cachedFetch('/api/system/ha-info', token),
        adminFetch('/api/admin/maintenance', token),
      ])
      setStats(s as Record<string, unknown>)
      setHaInfo(h as Record<string, unknown>)
      const maint = m as { active: boolean; message: string }
      setMaintenanceActive(maint.active)
      setMaintenanceMsg(maint.message || '')
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleMaintenance = async () => {
    setMaintenanceLoading(true)
    try {
      const result = await adminFetch('/api/admin/maintenance', token, {
        method: 'PUT',
        body: JSON.stringify({ active: !maintenanceActive, message: maintenanceMsg }),
      })
      setMaintenanceActive(result.active)
      setMaintenanceMsg(result.message || '')
    } catch { /* ignore */ }
    setMaintenanceLoading(false)
  }

  const saveMaintenanceMessage = async () => {
    setMaintenanceLoading(true)
    try {
      const result = await adminFetch('/api/admin/maintenance', token, {
        method: 'PUT',
        body: JSON.stringify({ message: maintenanceMsg }),
      })
      setMaintenanceMsg(result.message || '')
    } catch { /* ignore */ }
    setMaintenanceLoading(false)
  }

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const cpu = stats?.cpu as Record<string, unknown> | undefined
  const memory = stats?.memory as Record<string, unknown> | undefined
  const backend = stats?.backend as Record<string, unknown> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <AdminCard title="CPU" icon={Cpu}>
        <StatItem label="Auslastung" value={`${Math.round(cpu?.usage_percent as number ?? 0)}%`} />
        <StatItem label="Kerne" value={cpu?.cores as number} />
      </AdminCard>

      <AdminCard title="Speicher" icon={HardDrive}>
        <StatItem label="Verwendet" value={`${((memory?.used_bytes as number ?? 0) / 1048576).toFixed(0)} MB`} />
        <StatItem label="Gesamt" value={`${((memory?.total_bytes as number ?? 0) / 1048576).toFixed(0)} MB`} />
        <StatItem label="Auslastung" value={`${Math.round(memory?.usage_percent as number ?? 0)}%`} />
      </AdminCard>

      <AdminCard title="Backend" icon={Gear}>
        <StatItem label="Version" value={backend?.version as string} />
        <StatItem label="Entities" value={backend?.entity_count as number} />
        <StatItem label="Clients" value={backend?.connected_clients as number} />
        <StatItem label="Uptime" value={formatUptime(stats?.uptime_seconds as number)} />
      </AdminCard>

      <AdminCard title="Home Assistant" icon={CloudArrowUp}>
        <StatItem label="Verbunden" value={stats?.ha_connected ? '✓ Ja' : '✗ Nein'} />
        <StatItem label="WebSocket" value={stats?.ha_ws_connected ? '✓ Ja' : '✗ Nein'} />
        <StatItem label="HA Version" value={(haInfo?.ha_version as string) ?? 'Unbekannt'} />
        <StatItem label="Entities" value={haInfo?.entity_count as number} />
        <StatItem label="History (24h)" value={haInfo?.history_entries_24h as number} />
      </AdminCard>

      {Array.isArray(haInfo?.domains) && (
        <AdminCard title="Entity-Domänen" icon={ListBullets} className="md:col-span-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {(haInfo.domains as Array<{ domain: string; count: number }>).slice(0, 18).map(d => (
              <div key={d.domain} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-foreground/3">
                <span className="text-foreground/80">{d.domain}</span>
                <span className="font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <AdminCard title="Wartungsmodus" icon={Wrench} className="col-span-full">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                {maintenanceActive ? (
                  <span className="flex items-center gap-1.5 text-amber-400"><Warning size={14} weight="fill" /> Aktiv</span>
                ) : (
                  <span className="text-foreground/60">Inaktiv</span>
                )}
              </div>
              <p className="text-xs text-foreground/50">
                Sperrt das Dashboard für alle Geräte. Nur Administratoren und Benutzer mit der Rolle „Wartung" können weiterhin zugreifen.
              </p>
            </div>
            <button
              onClick={toggleMaintenance}
              disabled={maintenanceLoading}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                maintenanceActive
                  ? 'bg-green-500/15 text-green-300 hover:bg-green-500/25 border border-green-500/30'
                  : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
              }`}
            >
              {maintenanceActive ? (
                <><Power size={14} /> Deaktivieren</>
              ) : (
                <><Wrench size={14} /> Aktivieren</>
              )}
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-xs text-foreground/50 mb-1 block">Wartungsnachricht</label>
              <input
                value={maintenanceMsg}
                onChange={e => setMaintenanceMsg(e.target.value)}
                placeholder="Nachricht für Benutzer..."
                className="w-full px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={saveMaintenanceMessage}
              disabled={maintenanceLoading}
              className="px-3 py-2 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition-all border border-foreground/10"
            >
              Speichern
            </button>
          </div>
        </div>
      </AdminCard>

      <div className="col-span-full flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-foreground/80 hover:text-accent hover:bg-accent/10 transition-all">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Users Tab ──────────────────────────────────────────────────

function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', new_password: '', role: '' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/users', token)
      setUsers(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleAdmin = async (userId: string, isAdmin: boolean) => {
    setActionLoading(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}/admin`, token, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: !isAdmin }),
      })
      await load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (userId: string) => {
    setActionLoading(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}`, token, { method: 'DELETE' })
      setConfirmDelete(null)
      await load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleEdit = async (userId: string) => {
    setActionLoading(userId)
    try {
      const body: Record<string, string> = {}
      if (editForm.display_name) body.display_name = editForm.display_name
      if (editForm.new_password) body.new_password = editForm.new_password
      if (editForm.role) body.role = editForm.role
      await adminFetch(`/api/admin/users/${userId}`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      setEditingUser(null)
      setEditForm({ display_name: '', new_password: '', role: '' })
      await load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const filtered = search
    ? users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) ||
        (u.display_name || '').toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <AdminCard>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users size={16} className="text-accent" />
            {users.length} Benutzer
          </div>
          <div className="flex items-center gap-2 bg-foreground/5 rounded-lg px-3 py-1.5 flex-1 max-w-xs">
            <MagnifyingGlass size={14} className="text-foreground/75" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen..."
              className="bg-transparent text-xs outline-none flex-1 text-foreground placeholder:text-foreground/85"
            />
          </div>
        </div>
      </AdminCard>

      {/* User list */}
      {filtered.map(u => (
        <AdminCard key={u.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                {(u.display_name || u.username).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{u.display_name || u.username}</div>
                <div className="text-xs text-foreground/80">@{u.username} · Erstellt: {new Date(u.created_at).toLocaleDateString('de-DE')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex gap-1 text-[10px]">
                {u.has_password && <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-semibold border border-green-500/30">PW</span>}
                {u.has_pin && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">PIN</span>}
              </div>
              <Tip content={u.is_admin ? 'Admin entfernen' : 'Zum Admin machen'}>
                <button
                  onClick={() => toggleAdmin(u.id, u.is_admin)}
                  disabled={actionLoading === u.id}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                    u.is_admin
                      ? 'bg-accent text-white shadow-sm shadow-accent/25'
                      : 'bg-foreground/10 text-foreground border border-foreground/15 hover:bg-foreground/20'
                  }`}
                >
                  {actionLoading === u.id ? <InlineSpinner size={12} /> : ({ admin: 'Admin', editor: 'Editor', viewer: 'Betrachter', maintenance: 'Wartung', user: 'User' }[u.role] || (u.is_admin ? 'Admin' : 'User'))}
                </button>
              </Tip>
              <Tip content="Bearbeiten">
                <button
                  onClick={() => { setEditingUser(editingUser === u.id ? null : u.id); setEditForm({ display_name: u.display_name || '', new_password: '', role: u.role || 'user' }) }}
                  className="p-1.5 rounded-lg text-foreground/75 hover:text-accent hover:bg-accent/10 transition-all"
                >
                  <PencilSimple size={14} />
                </button>
              </Tip>
              <Tip content="Löschen">
                <button
                  onClick={() => setConfirmDelete(confirmDelete === u.id ? null : u.id)}
                  className="p-1.5 rounded-lg text-foreground/75 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <UserMinus size={14} />
                </button>
              </Tip>
            </div>
          </div>

          {/* Edit form */}
          {editingUser === u.id && (
            <div className="mt-3 pt-3 border-t border-foreground/10 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Anzeigename</label>
                  <input
                    type="text"
                    value={editForm.display_name}
                    onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Neues Passwort</label>
                  <input
                    type="password"
                    value={editForm.new_password}
                    onChange={e => setEditForm({ ...editForm, new_password: e.target.value })}
                    placeholder="Leer = nicht ändern"
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground placeholder:text-foreground/85"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Rolle</label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                  >
                    <option value="viewer">Betrachter</option>
                    <option value="user">Benutzer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Administrator</option>
                    <option value="maintenance">Wartung</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingUser(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all">Abbrechen</button>
                <button onClick={() => handleEdit(u.id)} disabled={actionLoading === u.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent/85 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading === u.id && <InlineSpinner size={12} />} Speichern
                </button>
              </div>
            </div>
          )}

          {/* Confirm delete */}
          {confirmDelete === u.id && (
            <div className="mt-3 pt-3 border-t border-red-500/20 flex items-center justify-between">
              <span className="text-xs text-red-400">Benutzer wirklich löschen?</span>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all">Nein</button>
                <button onClick={() => handleDelete(u.id)} disabled={actionLoading === u.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white shadow-sm shadow-red-500/25 hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading === u.id && <InlineSpinner size={12} />} Ja, löschen
                </button>
              </div>
            </div>
          )}
        </AdminCard>
      ))}
    </div>
  )
}

// ── API Keys Tab ──────────────────────────────────────────────

function ApiKeysTab({ token }: { token: string }) {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState<ApiKeyWithSecret | null>(null)
  const [form, setForm] = useState({ name: '', permissions: ['read'] as string[], rate_limit: 60, expires_in_days: 0 })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/keys', token)
      setKeys(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setActionLoading('create')
    try {
      const data = await adminFetch('/api/keys', token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          permissions: form.permissions,
          rate_limit: form.rate_limit,
          expires_in_days: form.expires_in_days > 0 ? form.expires_in_days : null,
        }),
      })
      setNewKey(data)
      setShowCreate(false)
      setForm({ name: '', permissions: ['read'], rate_limit: 60, expires_in_days: 0 })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (keyId: string) => {
    setActionLoading(keyId)
    try {
      await adminFetch(`/api/keys/${keyId}`, token, { method: 'DELETE' })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* New key reveal */}
      {newKey && (
        <AdminCard className="border border-accent/30">
          <div className="flex items-start gap-2 mb-2">
            <Warning size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-400">API Key erstellt – jetzt kopieren!</p>
              <p className="text-[10px] text-foreground/75 mt-0.5">Dieser Key wird nur einmal angezeigt.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-foreground/5 rounded-lg p-2 mt-2">
            <code className="text-xs font-mono flex-1 break-all">{newKey.key}</code>
            <button onClick={() => copyToClipboard(newKey.key)} className="p-1.5 rounded hover:bg-foreground/10 transition-colors">
              <Copy size={14} />
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="mt-2 text-xs text-foreground/80 hover:text-foreground/80">
            Schließen
          </button>
        </AdminCard>
      )}

      {/* Create form */}
      <AdminCard>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-foreground">{keys.length} API Key{keys.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85 transition-all"
          >
            <Plus size={14} weight="bold" /> Neuer Key
          </button>
        </div>
      </AdminCard>

      {showCreate && (
        <AdminCard>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="z.B. Mein ESP32 Gerät"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
              />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Berechtigungen</label>
              <div className="flex gap-2">
                {['read', 'write', '*'].map(perm => (
                  <button
                    key={perm}
                    onClick={() => {
                      const perms = form.permissions.includes(perm)
                        ? form.permissions.filter(p => p !== perm)
                        : [...form.permissions, perm]
                      setForm({ ...form, permissions: perms.length ? perms : ['read'] })
                    }}
                    className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                      form.permissions.includes(perm)
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-foreground/10 text-foreground border border-foreground/15'
                    }`}
                  >
                    {perm === '*' ? 'Alle' : perm === 'read' ? 'Lesen' : 'Schreiben'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-foreground/80 mb-1 block">Rate Limit (pro Min.)</label>
                <input
                  type="number"
                  value={form.rate_limit}
                  onChange={e => setForm({ ...form, rate_limit: parseInt(e.target.value) || 60 })}
                  className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-foreground/80 mb-1 block">Gültig (Tage, 0=∞)</label>
                <input
                  type="number"
                  value={form.expires_in_days}
                  onChange={e => setForm({ ...form, expires_in_days: parseInt(e.target.value) || 0 })}
                  className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || actionLoading === 'create'}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition-all flex items-center gap-1.5"
              >
                {actionLoading === 'create' && <InlineSpinner size={12} />}
                Erstellen
              </button>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Key list */}
      {keys.map(k => {
        const permissions: string[] = (() => { try { return JSON.parse(k.permissions) } catch { return ['read'] } })()
        return (
          <AdminCard key={k.id}>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{k.name}</span>
                  {!k.is_active && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-semibold border border-red-500/30">Inaktiv</span>}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-[10px] text-foreground/80 font-mono">{k.key_prefix}...</code>
                  <span className="text-[10px] text-foreground/75">·</span>
                  {permissions.map(p => (
                    <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/75">{p}</span>
                  ))}
                  <span className="text-[10px] text-foreground/75">· {k.rate_limit}/min</span>
                </div>
                {k.last_used_at && (
                  <div className="text-[10px] text-foreground/75 mt-1">Letzt. Nutzung: {new Date(k.last_used_at).toLocaleString('de-DE')}</div>
                )}
              </div>
              <button
                onClick={() => handleDelete(k.id)}
                disabled={actionLoading === k.id}
                className="p-2 rounded-lg text-foreground/75 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40"
              >
                {actionLoading === k.id ? <InlineSpinner size={14} /> : <Trash size={14} />}
              </button>
            </div>
          </AdminCard>
        )
      })}

      {keys.length === 0 && !showCreate && (
        <AdminCard>
          <div className="text-center py-4 text-foreground/80 text-sm">
            Keine API Keys vorhanden. Erstelle einen für deine Geräte.
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── HA Config Tab ──────────────────────────────────────────────

function HaConfigTab({ token }: { token: string }) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [supervisor, setSupervisor] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          cachedFetch('/api/admin/ha/config', token),
          cachedFetch('/api/admin/ha/supervisor', token).catch(() => null),
        ])
        setConfig(c as Record<string, unknown>)
        setSupervisor(s as Record<string, unknown> | null)
      } catch (e) { setError((e as Error).message) }
      setLoading(false)
    })()
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!config) return <ErrorMessage>HA Konfiguration konnte nicht geladen werden.</ErrorMessage>

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title="Home Assistant" icon={Gear}>
        <StatItem label="Version" value={config.version as string} />
        <StatItem label="Name" value={config.location_name as string} />
        <StatItem label="Zeitzone" value={config.time_zone as string} />
        <StatItem label="Höhe" value={`${config.elevation}m`} />
        <StatItem label="Einheitensystem" value={(config.unit_system as Record<string, string>)?.temperature ?? 'N/A'} />
        <StatItem label="Sprache" value={config.language as string} />
        <StatItem label="Externe URL" value={(config.external_url as string) ?? 'Nicht gesetzt'} />
        <StatItem label="Interne URL" value={(config.internal_url as string) ?? 'Nicht gesetzt'} />
      </AdminCard>

      {Array.isArray(config.components) && (
        <AdminCard title={`Komponenten (${(config.components as string[]).length})`} icon={Cube}>
          <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
            {(config.components as string[]).sort().map(c => (
              <div key={c} className="text-xs text-foreground/80 py-0.5">{c}</div>
            ))}
          </div>
        </AdminCard>
      )}

      {supervisor && (
        <AdminCard title="Supervisor" icon={CloudArrowUp}>
          {supervisor.supervisor_available ? (
            <>
              <StatItem label="Status" value="Verfügbar" />
              {supervisor.info && Object.entries(supervisor.info as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
                <StatItem key={k} label={k} value={String(v)} />
              ))}
            </>
          ) : (
            <div className="text-xs text-foreground/80">{(supervisor as Record<string, unknown>).note as string}</div>
          )}
        </AdminCard>
      )}

      <AdminCard title="Add-ons" icon={CloudArrowUp}>
        <AddonsContent token={token} />
      </AdminCard>
    </div>
  )
}

function AddonsContent({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    cachedFetch('/api/admin/ha/addons', token).then(d => setData(d as Record<string, unknown>)).catch(() => {})
  }, [token])

  if (!data) return <div className="text-xs text-foreground/80">Laden...</div>

  if (data.addon_entities) {
    return (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {(data.addon_entities as Array<Record<string, unknown>>).map((a, i) => (
          <div key={i} className="flex justify-between items-center text-xs py-1">
            <span className="text-foreground/85 truncate">{a.friendly_name as string}</span>
            <span className="text-foreground/80">{a.installed_version as string}</span>
          </div>
        ))}
      </div>
    )
  }

  return <div className="text-xs text-foreground/80">Keine Add-on-Daten verfügbar.</div>
}

// ── Integrations Tab ──────────────────────────────────────────

function IntegrationsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/integrations', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!data) return <ErrorMessage>Integrationen konnten nicht geladen werden.</ErrorMessage>

  const domains = data.entity_domains as Record<string, number> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title={`Entity-Domänen (${data.total_entities})`} icon={Cube} className="md:col-span-2">
        {domains && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {Object.entries(domains).sort(([, a], [, b]) => b - a).map(([domain, count]) => (
              <div key={domain} className="flex justify-between items-center text-xs py-1.5 px-2.5 rounded bg-foreground/3">
                <span className="text-foreground/80">{domain}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {Array.isArray(data.components) && (
        <AdminCard title={`Geladene Komponenten (${(data.components as string[]).length})`} icon={Gear} className="md:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {(data.components as string[]).sort().map(c => (
              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/5 text-foreground/75">{c}</span>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Protocol Config Modal ─────────────────────────────────────

function ConfigModal({ open, onClose, title, icon: Icon, children }: {
  open: boolean
  onClose: () => void
  title: string
  icon: typeof Cpu
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="glass-card rounded-2xl p-5 w-full max-w-md max-h-[80vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Icon size={18} className="text-accent" />
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-foreground/10 transition">
              <X size={16} className="text-foreground/60" />
            </button>
          </div>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── MQTT Tab ──────────────────────────────────────────────────

function MqttTab({ token }: { token: string }) {
  const [haData, setHaData] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [subTopic, setSubTopic] = useState('')
  const [pubTopic, setPubTopic] = useState('')
  const [pubPayload, setPubPayload] = useState('')
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([])
  const [configured, setConfigured] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Form fields
  const [host, setHost] = useState('')
  const [port, setPort] = useState('1883')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/mqtt/status', token) as Record<string, unknown>
      setStatus(s)
    } catch {}
  }, [token])

  const refreshMessages = useCallback(async () => {
    try {
      const m = await adminFetch('/api/admin/mqtt/messages', token) as Record<string, unknown>
      setMessages((m.recent_messages ?? []) as Array<Record<string, unknown>>)
    } catch {}
  }, [token])

  useEffect(() => {
    cachedFetch('/api/admin/ha/mqtt', token)
      .then(d => setHaData(d as Record<string, unknown>))
      .catch(() => {})
    adminFetch('/api/admin/mqtt/status', token)
      .then(d => setStatus(d as Record<string, unknown>))
      .catch(() => {})
    adminFetch('/api/admin/mqtt/config', token)
      .then(d => {
        const c = d as Record<string, unknown>
        if (c.host) { setHost(c.host as string); setConfigured(true) }
        if (c.port) setPort(String(c.port))
        if (c.username) setUsername(c.username as string)
        if (c.use_tls) setUseTls(c.use_tls as boolean)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    const iv = setInterval(() => { refreshStatus(); refreshMessages() }, 5000)
    return () => clearInterval(iv)
  }, [refreshStatus, refreshMessages])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await adminFetch('/api/admin/mqtt/connect', token, {
        method: 'POST',
        body: JSON.stringify({ host, port: parseInt(port), username: username || undefined, password: password || undefined, use_tls: useTls }),
      }) as Record<string, unknown>
      if (res.success) {
        setConfigured(true)
        setShowConfig(false)
      } else {
        setError(res.error as string || 'Verbindung fehlgeschlagen')
      }
      setTimeout(refreshStatus, 1500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setActionLoading('disconnect')
    try {
      await adminFetch('/api/admin/mqtt/disconnect', token, { method: 'POST' })
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handleSubscribe = async () => {
    if (!subTopic.trim()) return
    setActionLoading('subscribe')
    try {
      await adminFetch('/api/admin/mqtt/subscribe', token, {
        method: 'POST',
        body: JSON.stringify({ topic: subTopic }),
      })
      setSubTopic('')
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handleUnsubscribe = async (topic: string) => {
    setActionLoading(`unsub-${topic}`)
    try {
      await adminFetch('/api/admin/mqtt/unsubscribe', token, {
        method: 'POST',
        body: JSON.stringify({ topic }),
      })
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handlePublish = async () => {
    if (!pubTopic.trim()) return
    setActionLoading('publish')
    try {
      await adminFetch('/api/admin/mqtt/publish', token, {
        method: 'POST',
        body: JSON.stringify({ topic: pubTopic, payload: pubPayload }),
      })
      setPubPayload('')
    } finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error && !status) return <ErrorMessage>{error}</ErrorMessage>

  const isConnected = (status as Record<string, unknown>)?.connected === true
  const statusError = status && typeof (status as Record<string, unknown>).error !== 'undefined'
    ? (String((status as Record<string, unknown>).error) || null)
    : null

  // Show inline setup if not configured
  if (!configured && !isConnected) {
    return (
      <div className="space-y-3">
        <AdminCard title="MQTT einrichten" icon={WifiHigh}>
          <p className="text-xs text-foreground/60 mb-3">Verbinde dich mit einem bestehenden MQTT-Broker um Nachrichten zu senden und empfangen.</p>
          <MqttConfigForm host={host} setHost={setHost} port={port} setPort={setPort} username={username} setUsername={setUsername} password={password} setPassword={setPassword} useTls={useTls} setUseTls={setUseTls} onConnect={handleConnect} connecting={connecting} error={error} />
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Connection Status */}
      <AdminCard title="MQTT Verbindung" icon={WifiHigh}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs font-medium text-foreground/85">{isConnected ? 'Verbunden' : 'Nicht verbunden'}</span>
            {statusError && <span className="text-[10px] text-red-400 truncate ml-2">{statusError}</span>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            {isConnected ? (
              <button onClick={handleDisconnect} disabled={actionLoading === 'disconnect'}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition disabled:opacity-40">
                {actionLoading === 'disconnect' ? <InlineSpinner size={12} /> : <Power size={12} />} Trennen
              </button>
            ) : (
              <button onClick={handleConnect} disabled={connecting || !host} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
                <Play size={12} weight="fill" /> {connecting ? 'Verbinde...' : 'Verbinden'}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Broker" value={host ? `${host}:${port}` : '–'} />
          <StatItem label="TLS" value={useTls ? 'Ja' : 'Nein'} />
          <StatItem label="Nachrichten" value={String(status?.message_count ?? 0)} />
          <StatItem label="Subscriptions" value={String((status?.subscribed_topics as string[] ?? []).length)} />
        </div>
      </AdminCard>

      {/* Subscribe & Topics */}
      {isConnected && (
        <AdminCard title="Topics & Subscriptions" icon={ListBullets}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={subTopic} onChange={e => setSubTopic(e.target.value)} placeholder="Topic (z.B. home/#)" className="flex-1 px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" onKeyDown={e => e.key === 'Enter' && handleSubscribe()} />
              <button onClick={handleSubscribe} disabled={actionLoading === 'subscribe'}
                className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
                {actionLoading === 'subscribe' ? <InlineSpinner size={12} /> : <Plus size={12} />}
              </button>
            </div>
            {((status as Record<string, unknown>)?.subscribed_topics as string[] ?? []).length > 0 && (
              <div className="space-y-1">
                {((status as Record<string, unknown>)?.subscribed_topics as string[]).map(t => (
                  <div key={t} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-foreground/5">
                    <span className="font-mono text-foreground/85">{t}</span>
                    <button onClick={() => handleUnsubscribe(t)} disabled={actionLoading === `unsub-${t}`}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40">
                      {actionLoading === `unsub-${t}` ? <InlineSpinner size={12} /> : <Trash size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AdminCard>
      )}

      {/* Publish */}
      {isConnected && (
        <AdminCard title="Nachricht senden" icon={CloudArrowUp}>
          <div className="space-y-2">
            <input value={pubTopic} onChange={e => setPubTopic(e.target.value)} placeholder="Topic" className="w-full px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
            <input value={pubPayload} onChange={e => setPubPayload(e.target.value)} placeholder="Payload (JSON oder Text)" className="w-full px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" onKeyDown={e => e.key === 'Enter' && handlePublish()} />
            <button onClick={handlePublish} disabled={!pubTopic.trim() || actionLoading === 'publish'}
              className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40 flex items-center gap-1.5">
              {actionLoading === 'publish' && <InlineSpinner size={12} />}
              Senden
            </button>
          </div>
        </AdminCard>
      )}

      {/* Recent Messages */}
      {isConnected && messages.length > 0 && (
        <AdminCard title={`Letzte Nachrichten (${messages.length})`} icon={ListBullets}>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...messages].reverse().slice(0, 30).map((m, i) => (
              <div key={i} className="text-[10px] py-1 px-2 rounded bg-foreground/5 border-b border-foreground/5 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-accent/90 truncate">{m.topic as string}</span>
                  <span className="text-foreground/40 ml-2 whitespace-nowrap">{(m.received_at as string)?.split('T')[1]?.slice(0,8)}</span>
                </div>
                <div className="text-foreground/70 font-mono truncate mt-0.5">{m.payload as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* HA MQTT Entities */}
      <AdminCard title={`HA MQTT Entities (${haData?.mqtt_entity_count ?? 0})`} icon={WifiHigh}>
        {(haData?.mqtt_entities as Array<Record<string, unknown>> ?? []).length === 0 ? (
          <div className="text-xs text-foreground/50 text-center py-4">Keine MQTT-Entities in Home Assistant.</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {(haData?.mqtt_entities as Array<Record<string, unknown>>).map((e, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85 truncate mr-2">{(e.friendly_name as string) ?? e.entity_id}</span>
                <span className="text-foreground/80 font-mono text-[10px]">{e.state as string}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="MQTT Konfiguration" icon={WifiHigh}>
        <p className="text-xs text-foreground/60 mb-3">Verbindungsdaten zum MQTT-Broker. Werden automatisch gespeichert und beim Neustart wiederhergestellt.</p>
        <MqttConfigForm host={host} setHost={setHost} port={port} setPort={setPort} username={username} setUsername={setUsername} password={password} setPassword={setPassword} useTls={useTls} setUseTls={setUseTls} onConnect={handleConnect} connecting={connecting} error={error} />
      </ConfigModal>
    </div>
  )
}

function MqttConfigForm({ host, setHost, port, setPort, username, setUsername, password, setPassword, useTls, setUseTls, onConnect, connecting, error }: {
  host: string; setHost: (v: string) => void
  port: string; setPort: (v: string) => void
  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void
  useTls: boolean; setUseTls: (v: boolean) => void
  onConnect: () => void; connecting: boolean; error: string
}) {
  return (
    <div className="space-y-2">
      {error && <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <input value={host} onChange={e => setHost(e.target.value)} placeholder="Host (z.B. 192.168.1.10)" className="col-span-2 px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
        <input value={port} onChange={e => setPort(e.target.value)} placeholder="Port" type="number" className="px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
        <label className="flex items-center gap-2 text-xs text-foreground/85 px-2">
          <input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} className="rounded accent-[var(--accent)]" />
          TLS
        </label>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Benutzername (optional)" className="px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Passwort (optional)" type="password" className="px-3 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
      </div>
      <button onClick={onConnect} disabled={connecting || !host} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
        <Play size={12} weight="fill" /> {connecting ? 'Verbinde...' : 'Verbinden & Speichern'}
      </button>
    </div>
  )
}

// ── Matter Tab ────────────────────────────────────────────────

function MatterTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ enabled: false, commission_port: 5540, discriminator: 3840, passcode: 20202021 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/matter/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({
          enabled: c.enabled as boolean ?? false,
          commission_port: c.commission_port as number ?? 5540,
          discriminator: c.discriminator as number ?? 3840,
          passcode: c.passcode as number ?? 20202021,
        })
      }
    } catch { /* endpoint optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSaveConfig = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/matter/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const fabrics = (status?.fabrics ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      {/* Status Overview */}
      <AdminCard title="Matter Status" icon={HardDrive}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/matter/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_matter_entities ?? 0)} />
          <StatItem label="Commission Port" value={String(config.commission_port)} />
          <StatItem label="Fabrics" value={String(fabrics.length)} />
        </div>
      </AdminCard>

      {/* Matter Devices */}
      {devices.length > 0 && (
        <AdminCard title={`Matter Geräte (${devices.length})`} icon={HardDrive}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.name as string}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.reachable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {d.reachable ? 'Erreichbar' : 'Offline'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  {typeof d.vendor === 'string' && <span>Hersteller: <span className="text-foreground/80">{d.vendor}</span></span>}
                  {typeof d.model === 'string' && <span>Modell: <span className="text-foreground/80">{d.model}</span></span>}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Fabrics */}
      {fabrics.length > 0 && (
        <AdminCard title={`Matter Fabrics (${fabrics.length})`} icon={Globe}>
          <div className="space-y-1.5">
            {fabrics.map((f, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85">{f.label as string}</span>
                <span className="text-foreground/60 text-[10px]">{String(f.node_count)} Nodes</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Matter Konfiguration" icon={HardDrive}>
        <p className="text-xs text-foreground/60 mb-3">Matter Bridge Einstellungen. Verbindet sich mit der bestehenden Matter-Integration in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Matter Bridge aktiviert
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Commission Port</label>
              <input value={config.commission_port} onChange={e => setConfig(c => ({ ...c, commission_port: parseInt(e.target.value) || 5540 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Discriminator</label>
              <input value={config.discriminator} onChange={e => setConfig(c => ({ ...c, discriminator: parseInt(e.target.value) || 3840 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Passcode</label>
              <input value={config.passcode} onChange={e => setConfig(c => ({ ...c, passcode: parseInt(e.target.value) || 20202021 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <button onClick={handleSaveConfig} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── HA Connection Tab ──────────────────────────────────────────

function HaConnectionTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/ha/connection', token) as Record<string, unknown>
      setStatus(s)
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const integrations = (status?.integrations ?? []) as Array<Record<string, unknown>>
  const events = (status?.events ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="Home Assistant Verbindung" icon={Pulse}>
        <div className="space-y-1">
          <StatItem label="Status" value={status?.available ? '🟢 Verbunden' : '🔴 Getrennt'} />
          <StatItem label="HA URL" value={status?.ha_url as string} />
          {typeof status?.ha_version === 'string' && <StatItem label="HA Version" value={status.ha_version} />}
          <StatItem label="Fehler in Folge" value={String(status?.failure_count ?? 0)} />
        </div>
        <button onClick={refresh} className="mt-2 flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
          <ArrowClockwise size={12} /> Aktualisieren
        </button>
      </AdminCard>

      <AdminCard title={`Erkannte Integrationen (${integrations.length})`} icon={Cube}>
        {integrations.length === 0 ? (
          <div className="text-xs text-foreground/50 py-2">Keine Integrationen erkannt</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {integrations.map(integ => (
              <span key={String(integ.domain)} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                integ.available ? 'bg-accent/10 text-accent' : 'bg-foreground/10 text-foreground/50'
              }`}>{String(integ.title || integ.domain)}</span>
            ))}
          </div>
        )}
      </AdminCard>

      {events.length > 0 && (
        <AdminCard title="Verbindungs-Ereignisse" icon={ListBullets}>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-foreground/5 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${(ev.event_type as string)?.includes('onnected') ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-foreground/70">{ev.event_type as string}</span>
                <span className="text-foreground/40 ml-auto">{ev.timestamp as string}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Zigbee Tab ────────────────────────────────────────────────

function ZigbeeTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ mode: 'auto', enabled: true, z2m_topic: 'zigbee2mqtt' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/zigbee/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({
          mode: (c.mode as string) ?? 'auto',
          enabled: (c.enabled as boolean) ?? true,
          z2m_topic: (c.z2m_topic as string) ?? 'zigbee2mqtt',
        })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/zigbee/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const network = status?.network as Record<string, unknown> | null

  return (
    <div className="space-y-3">
      {/* Status */}
      <AdminCard title="Zigbee Status" icon={Tree}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{status?.mode as string ?? 'Auto'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/zigbee/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="Modus" value={status?.detected_mode as string ?? '–'} />
          {network && <>
            <StatItem label="Kanal" value={String(network.channel ?? '–')} />
            <StatItem label="Beitritt" value={(network.permit_join as boolean) ? 'Ja' : 'Nein'} />
          </>}
        </div>
      </AdminCard>

      {/* Devices */}
      {devices.length > 0 && (
        <AdminCard title={`Zigbee Geräte (${devices.length})`} icon={Tree}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.friendly_name as string}</span>
                  {typeof d.lqi === 'number' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.lqi > 100 ? 'bg-green-500/20 text-green-400' : d.lqi > 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      LQI: {d.lqi}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  <span>Strom: <span className="text-foreground/80">{d.power_source as string}</span></span>
                  {typeof d.battery === 'number' && <span>Batterie: <span className="text-foreground/80">{d.battery}%</span></span>}
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{d.ieee_address as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Zigbee Konfiguration" icon={Tree}>
        <p className="text-xs text-foreground/60 mb-3">Verbindet sich mit der bestehenden Zigbee-Integration (Zigbee2MQTT oder ZHA) in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Zigbee aktiviert
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Modus</label>
              <select value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value }))} className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50">
                <option value="auto">Auto-Erkennung</option>
                <option value="zigbee2mqtt">Zigbee2MQTT</option>
                <option value="zha">ZHA</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Z2M Topic</label>
              <input value={config.z2m_topic} onChange={e => setConfig(c => ({ ...c, z2m_topic: e.target.value }))} className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Z-Wave Tab ────────────────────────────────────────────────

function ZwaveTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ enabled: true, zwave_js_url: '' })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/zwave/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({ enabled: (c.enabled as boolean) ?? true, zwave_js_url: (c.zwave_js_url as string) ?? '' })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/zwave/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const nodes = (status?.nodes ?? []) as Array<Record<string, unknown>>
  const network = status?.network as Record<string, unknown> | null

  return (
    <div className="space-y-3">
      <AdminCard title="Z-Wave Status" icon={LinkSimple}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{nodes.length > 0 ? 'Aktiv' : 'Keine Nodes'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/zwave/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Nodes" value={String(status?.node_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_zwave_entities ?? 0)} />
          {network && <>
            <StatItem label="Home ID" value={network.home_id as string ?? '–'} />
            <StatItem label="Controller" value={network.controller as string ?? '–'} />
          </>}
        </div>
      </AdminCard>

      {nodes.length > 0 && (
        <AdminCard title={`Z-Wave Nodes (${nodes.length})`} icon={LinkSimple}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {nodes.map((n, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{n.name as string}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${n.status === 'alive' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {n.status as string}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-2 text-[10px] text-foreground/60">
                  <span>Node: <span className="text-foreground/80">{String(n.node_id)}</span></span>
                  <span>Typ: <span className="text-foreground/80">{String(n.device_type)}</span></span>
                  {typeof n.product === 'string' && <span>Produkt: <span className="text-foreground/80">{n.product}</span></span>}
                </div>
                <div className="flex gap-2 mt-0.5">
                  {n.is_secure === true && <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400">Sicher</span>}
                  {n.is_routing === true && <span className="text-[9px] px-1 rounded bg-purple-500/10 text-purple-400">Routing</span>}
                  {n.is_beaming === true && <span className="text-[9px] px-1 rounded bg-cyan-500/10 text-cyan-400">Beaming</span>}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Z-Wave Konfiguration" icon={LinkSimple}>
        <p className="text-xs text-foreground/60 mb-3">Verbindet sich mit der bestehenden Z-Wave JS Integration in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Z-Wave aktiviert
          </label>
          <div>
            <label className="text-[10px] text-foreground/50 block mb-0.5">Z-Wave JS WebSocket URL (optional)</label>
            <input value={config.zwave_js_url} onChange={e => setConfig(c => ({ ...c, zwave_js_url: e.target.value }))} placeholder="ws://localhost:3000" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50" />
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Bluetooth Tab ─────────────────────────────────────────────

function BleTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ enabled: true })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/ble/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({ enabled: (c.enabled as boolean) ?? true })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/ble/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const adapters = (status?.adapters ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="Bluetooth Status" icon={Bluetooth}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/ble/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="Adapter" value={String(adapters.length)} />
          <StatItem label="HA Entities" value={String(status?.ha_ble_entities ?? 0)} />
        </div>
      </AdminCard>

      {adapters.length > 0 && (
        <AdminCard title="Bluetooth Adapter" icon={Bluetooth}>
          <div className="space-y-1.5">
            {adapters.map((a, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85">{a.name as string}</span>
                <span className="text-foreground/50 text-[10px]">{a.address as string}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {devices.length > 0 && (
        <AdminCard title={`BLE Geräte (${devices.length})`} icon={Bluetooth}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.name as string}</span>
                  {typeof d.rssi === 'number' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.rssi > -60 ? 'bg-green-500/20 text-green-400' : d.rssi > -80 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      {d.rssi} dBm
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  {typeof d.battery === 'number' && <span>Batterie: <span className="text-foreground/80">{d.battery}%</span></span>}
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{d.address as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Bluetooth Konfiguration" icon={Bluetooth}>
        <p className="text-xs text-foreground/60 mb-3">Nutzt die bestehende Bluetooth-Integration in Home Assistant zur Geräte-Erkennung.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Bluetooth aktiviert
          </label>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── HomeKit Tab ───────────────────────────────────────────────

function HomekitTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ enabled: false, bridge_name: 'MDT Dashboard Bridge', bridge_port: 21063 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/homekit/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        const bridge_port = typeof c.bridge_port === 'number'
          ? c.bridge_port
          : typeof c.port === 'number'
            ? c.port
            : 21063
        setConfig({
          enabled: typeof c.enabled === 'boolean' ? c.enabled : false,
          bridge_name: typeof c.bridge_name === 'string' ? c.bridge_name : 'MDT Dashboard Bridge',
          bridge_port,
        })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/homekit/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const accessories = (status?.accessories ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="HomeKit Status" icon={AppleLogo}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/homekit/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Bridge" value={status?.bridge_available ? 'Erreichbar' : 'Nicht erreichbar'} />
          <StatItem label="Zubehör" value={String(status?.accessory_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_homekit_entities ?? 0)} />
          <StatItem label="Port" value={String(config.bridge_port)} />
        </div>
      </AdminCard>

      {accessories.length > 0 && (
        <AdminCard title={`HomeKit Zubehör (${accessories.length})`} icon={AppleLogo}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {accessories.map((a, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{a.name as string}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/70">{a.accessory_type as string}</span>
                </div>
                <div className="text-[10px] text-foreground/60">
                  <span>Status: <span className="text-foreground/80">{a.state as string}</span></span>
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{a.entity_id as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="HomeKit Konfiguration" icon={AppleLogo}>
        <p className="text-xs text-foreground/60 mb-3">Nutzt die bestehende HomeKit-Integration in Home Assistant. Bridge-Einstellungen für die Zubehör-Zuordnung.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            HomeKit Bridge aktiviert
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Bridge Name</label>
              <input value={config.bridge_name} onChange={e => setConfig(c => ({ ...c, bridge_name: e.target.value }))} className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Port</label>
              <input value={config.bridge_port} onChange={e => setConfig(c => ({ ...c, bridge_port: parseInt(e.target.value) || 21063 }))} type="number" className="w-full px-2 py-1 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground focus:outline-none focus:border-accent/50" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="w-full px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Automations Tab ────────────────────────────────────────────

function AutomationsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/automations', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const automations = (data?.automations ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-2">
      <AdminCard>
        <div className="flex items-center gap-2">
          <Power size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">{automations.length} Automationen</span>
        </div>
      </AdminCard>
      {automations.map((a, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(a.friendly_name as string) ?? a.entity_id}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {a.entity_id as string}
                {typeof a.last_triggered === 'string' && ` · Letzt. Ausl.: ${new Date(a.last_triggered).toLocaleString('de-DE')}`}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              a.state === 'on' ? 'bg-green-500/10 text-green-400' : 'bg-foreground/5 text-foreground/80'
            }`}>
              {a.state === 'on' ? 'Aktiv' : 'Aus'}
            </span>
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Scenes Tab ────────────────────────────────────────────────

function ScenesTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/scenes', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const scenes = (data?.scenes ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-2">
      <AdminCard>
        <div className="flex items-center gap-2">
          <FilmSlate size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">{scenes.length} Szenen</span>
        </div>
      </AdminCard>
      {scenes.length === 0 ? (
        <AdminCard>
          <div className="text-sm text-foreground/80 text-center py-4">Keine Szenen in Home Assistant konfiguriert.</div>
        </AdminCard>
      ) : scenes.map((s, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(s.friendly_name as string) ?? s.entity_id}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {s.entity_id as string}
                {typeof s.last_activated === 'string' && ` · Letzt. Aktivierung: ${new Date(s.last_activated).toLocaleString('de-DE')}`}
              </div>
            </div>
            <Play size={16} className="text-accent/80 flex-shrink-0" />
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Backups Tab ────────────────────────────────────────────────

function BackupsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/backups', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const backups = (data?.backups ?? []) as Array<Record<string, unknown>>
  const available = data?.backups_available as boolean

  return (
    <div className="space-y-3">
      <AdminCard>
        <div className="flex items-center gap-2">
          <Archive size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">
            {available ? `${backups.length} Backup${backups.length !== 1 ? 's' : ''}` : 'Backups nicht verfügbar'}
          </span>
        </div>
        {!available && <div className="text-xs text-foreground/80 mt-2">{data?.note as string}</div>}
      </AdminCard>
      {backups.map((b, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(b.name as string) ?? `Backup ${i + 1}`}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {b.slug as string}
                {typeof b.date === 'string' && ` · ${new Date(b.date).toLocaleString('de-DE')}`}
                {typeof b.size === 'number' && ` · ${((b.size as number) / 1024 / 1024).toFixed(1)} MB`}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
              b.type === 'full' ? 'bg-accent/20 text-accent' : 'bg-foreground/10 text-foreground'
            }`}>
              {b.type === 'full' ? 'Voll' : 'Teilweise'}
            </span>
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Network Tab ────────────────────────────────────────────────

function NetworkTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/network', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const networkAvailable = data?.network_available as boolean
  const info = data?.info as Record<string, unknown> | undefined
  const connectivity = data?.connectivity as Record<string, unknown> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title="Netzwerkstatus" icon={Globe}>
        {networkAvailable && info ? (
          <>
            {Object.entries(info).filter(([k]) => typeof info[k] !== 'object').slice(0, 10).map(([k, v]) => (
              <StatItem key={k} label={k} value={String(v)} />
            ))}
          </>
        ) : (
          <>
            <div className="text-xs text-foreground/80 mb-2">{data?.note as string}</div>
            {connectivity && (
              <>
                <StatItem label="HA REST API" value={connectivity.ha_rest_api ? '✓ Verbunden' : '✗ Getrennt'} />
                <StatItem label="HA WebSocket" value={connectivity.ha_websocket ? '✓ Verbunden' : '✗ Getrennt'} />
              </>
            )}
          </>
        )}
      </AdminCard>

      {networkAvailable && info && Array.isArray(info.interfaces) && (
        <AdminCard title="Netzwerk-Interfaces" icon={WifiHigh}>
          <div className="space-y-2">
            {(info.interfaces as Array<Record<string, unknown>>).map((iface, i) => (
              <div key={i} className="p-2 rounded-lg bg-foreground/5">
                <div className="text-xs font-medium text-foreground">{String(iface.interface ?? `Interface ${i}`)}</div>
                {iface.ip_address != null && <div className="text-[10px] text-foreground/80 mt-0.5">IP: {String(iface.ip_address)}</div>}
                {iface.type != null && <div className="text-[10px] text-foreground/80">Typ: {String(iface.type)}</div>}
                {typeof iface.enabled === 'boolean' && (
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    iface.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                  }`}>
                    {iface.enabled ? 'Aktiv' : 'Inaktiv'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Logs Tab ──────────────────────────────────────────────────

interface IoraLogEntry {
  id: number
  timestamp: string
  level: string
  target: string
  message: string
  fields?: Record<string, unknown>
}

function LogsTab({ token }: { token: string }) {
  const [logs, setLogs] = useState<IoraLogEntry[]>([])
  const [haLogs, setHaLogs] = useState<Array<{ line: string; severity: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')
  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [liveMode, setLiveMode] = useState(false)
  const [activeView, setActiveView] = useState<'iora' | 'ha'>('iora')
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = { current: null as HTMLDivElement | null }

  // Load initial logs
  const load = useCallback(async () => {
    setError('')
    try {
      const [ioraData, haData] = await Promise.all([
        adminFetch('/api/admin/logs?limit=500' +
          (filter !== 'all' ? `&level=${filter}` : '') +
          (targetFilter ? `&target=${encodeURIComponent(targetFilter)}` : '') +
          (search ? `&search=${encodeURIComponent(search)}` : ''), token),
        adminFetch('/api/admin/ha/logs', token).catch(() => ({ log: [] })),
      ])
      setLogs((ioraData.entries ?? []) as IoraLogEntry[])
      setHaLogs(haData.log ?? [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token, filter, targetFilter, search])

  useEffect(() => { load() }, [load])

  // Live SSE mode
  useEffect(() => {
    if (!liveMode || activeView !== 'iora') return
    const es = new EventSource(`${API_BASE}/api/admin/logs/live${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    es.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as IoraLogEntry
        setLogs(prev => {
          const next = [entry, ...prev]
          return next.length > 1000 ? next.slice(0, 1000) : next
        })
      } catch { /* skip */ }
    })
    es.addEventListener('warning', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data)
        setError(d.message || 'Missed events')
      } catch { /* skip */ }
    })
    es.onerror = () => setLiveMode(false)
    return () => es.close()
  }, [liveMode, activeView])

  const clearLogs = async () => {
    try {
      await adminFetch('/api/admin/logs/clear', token, { method: 'POST' })
      setLogs([])
    } catch { /* ignore */ }
  }

  if (loading) return <LoadingSpinner />
  if (error && logs.length === 0) return <ErrorMessage>{error}</ErrorMessage>

  // Filter displayed logs client-side for live mode
  const displayed = liveMode ? logs.filter(e => {
    if (filter !== 'all' && e.level !== filter) return false
    if (targetFilter && !e.target.includes(targetFilter)) return false
    if (search && !e.message.toLowerCase().includes(search.toLowerCase()) && !e.target.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }) : logs

  const errorCount = logs.filter(e => e.level === 'error').length
  const warnCount = logs.filter(e => e.level === 'warn').length
  const infoCount = logs.filter(e => e.level === 'info').length

  // Get unique targets for quick filter
  const uniqueTargets = [...new Set(logs.map(e => e.target.split('::')[0]).filter(Boolean))].slice(0, 20)

  return (
    <div className="space-y-3">
      {/* View toggle + controls */}
      <AdminCard>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-foreground/5 p-0.5">
              <button onClick={() => setActiveView('iora')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'iora' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                IORA System
              </button>
              <button onClick={() => setActiveView('ha')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'ha' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                Home Assistant
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeView === 'iora' && (
              <>
                <button onClick={() => setLiveMode(!liveMode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    liveMode ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                  }`}>
                  <Broadcast size={12} weight={liveMode ? 'fill' : 'regular'} />
                  {liveMode ? 'Live' : 'Live'}
                </button>
                <Tip content="Log-Buffer leeren">
                  <button onClick={clearLogs} className="p-1.5 rounded-lg text-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition">
                    <Trash size={14} />
                  </button>
                </Tip>
              </>
            )}
            <button onClick={load} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition">
              <ArrowClockwise size={12} /> Refresh
            </button>
          </div>
        </div>
      </AdminCard>

      {activeView === 'iora' && (
        <>
          {/* Stats & Filters */}
          <AdminCard>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={() => setFilter('all')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'all' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Alle ({logs.length})
                </button>
                <button onClick={() => setFilter('error')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Error ({errorCount})
                </button>
                <button onClick={() => setFilter('warn')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'warn' ? 'bg-amber-500/20 text-amber-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Warn ({warnCount})
                </button>
                <button onClick={() => setFilter('info')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'info' ? 'bg-blue-500/20 text-blue-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Info ({infoCount})
                </button>
                <button onClick={() => setFilter('debug')} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition ${filter === 'debug' ? 'bg-purple-500/20 text-purple-400' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  Debug
                </button>
                <span className="text-[10px] text-foreground/30 mx-1">|</span>
                {uniqueTargets.slice(0, 8).map(t => (
                  <button key={t} onClick={() => setTargetFilter(targetFilter === t ? '' : t)}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition ${targetFilter === t ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/50 hover:bg-foreground/10'}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <MagnifyingGlass size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground/40" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Logs durchsuchen..."
                    className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50 font-mono" />
                </div>
                {liveMode && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-green-400 font-medium">Live-Stream aktiv</span>
                  </div>
                )}
              </div>
            </div>
          </AdminCard>

          {/* IORA Log Entries */}
          <AdminCard>
            <div ref={el => { logContainerRef.current = el }} className="max-h-[600px] overflow-y-auto font-mono text-[10px] leading-relaxed space-y-0.5">
              {displayed.length === 0 ? (
                <div className="text-foreground/50 text-center py-8">Keine Log-Einträge gefunden.</div>
              ) : displayed.map(entry => (
                <div key={entry.id} className={`group py-1 px-2 rounded flex items-start gap-2 hover:bg-foreground/5 transition-colors ${
                  entry.level === 'error' ? 'bg-red-500/5' :
                  entry.level === 'warn' ? 'bg-amber-500/3' : ''
                }`}>
                  <span className="text-foreground/30 shrink-0 w-[58px]">{entry.timestamp.split('T')[1]?.slice(0, 12) || ''}</span>
                  <span className={`shrink-0 w-[42px] font-semibold uppercase ${
                    entry.level === 'error' ? 'text-red-400' :
                    entry.level === 'warn' ? 'text-amber-400' :
                    entry.level === 'info' ? 'text-blue-400' :
                    entry.level === 'debug' ? 'text-purple-400' :
                    'text-foreground/40'
                  }`}>{entry.level}</span>
                  <span className="text-accent/60 shrink-0 max-w-[180px] truncate">{entry.target}</span>
                  <span className={`flex-1 ${
                    entry.level === 'error' ? 'text-red-300/90' :
                    entry.level === 'warn' ? 'text-amber-300/80' :
                    'text-foreground/70'
                  }`}>{entry.message}</span>
                  {entry.fields && (
                    <span className="text-foreground/25 truncate max-w-[200px] opacity-0 group-hover:opacity-100 transition-opacity">
                      {JSON.stringify(entry.fields)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </AdminCard>
        </>
      )}

      {activeView === 'ha' && (
        <>
          <AdminCard>
            <div className="max-h-[500px] overflow-y-auto font-mono text-[10px] leading-relaxed space-y-0.5">
              {haLogs.length === 0 ? (
                <div className="text-foreground/50 text-center py-6">Keine HA-Logs verfügbar.</div>
              ) : haLogs.map((entry, i) => (
                <div key={i} className={`py-0.5 px-1.5 rounded ${
                  entry.severity === 'error' ? 'text-red-400/90 bg-red-500/5' :
                  entry.severity === 'warning' ? 'text-amber-400/80 bg-amber-500/5' :
                  entry.severity === 'info' ? 'text-blue-400/70' :
                  'text-foreground/70'
                }`}>
                  {entry.line}
                </div>
              ))}
            </div>
          </AdminCard>
        </>
      )}
    </div>
  )
}

// ── Database Tab ──────────────────────────────────────────────

function DatabaseTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tempUsers, setTempUsers] = useState<Array<{id:string;username:string;description:string;permissions:string;expires_at:string;revoked:boolean;last_used_at:string|null}>>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', description: '', permissions: 'readonly', expires_in_days: 7 })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dbInfo, usersRes] = await Promise.all([
        cachedFetch('/api/admin/system/database', token),
        adminFetch('/api/admin/system/database/temp-users', token),
      ])
      setData(dbInfo as Record<string, unknown>)
      setTempUsers((usersRes as {users:typeof tempUsers}).users ?? [])
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token])

  useEffect(() => { loadData() }, [loadData])

  const handleCreateUser = async () => {
    setCreating(true)
    setCreateError('')
    try {
      await adminFetch('/api/admin/system/database/temp-users', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      })
      setShowCreateForm(false)
      setNewUser({ username: '', password: '', description: '', permissions: 'readonly', expires_in_days: 7 })
      loadData()
    } catch (e) {
      setCreateError((e as Error).message)
    }
    setCreating(false)
  }

  const handleRevokeUser = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system/database/temp-users/${id}`, token, { method: 'DELETE' })
      loadData()
    } catch { /* ignore */ }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!data) return <ErrorMessage>Datenbankinfo nicht verfügbar.</ErrorMessage>

  const tables = data.tables as Record<string, number> | undefined
  const tableSizes = data.table_sizes as Array<{name:string;size_bytes:number;size_mb:number}> | undefined
  const formatTime = (t?: string | null) => {
    if (!t) return '–'
    try { return new Date(t).toLocaleString('de-DE') } catch { return t }
  }

  return (
    <div className="space-y-4">
      {/* Database Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <AdminCard title="Datenbank-Übersicht" icon={Database}>
          <StatItem label="Engine" value={String(data.engine ?? 'PostgreSQL')} />
          <StatItem label="Version" value={String(data.version ?? '–')} />
          <StatItem label="Datenbank" value={String(data.database_name ?? '–')} />
          <StatItem label="Host" value={String(data.host ?? '–')} />
          <StatItem label="Größe" value={`${data.size_mb} MB`} />
          <StatItem label="Betriebszeit" value={String(data.uptime ?? '–')} />
        </AdminCard>

        <AdminCard title="Verbindungen" icon={Pulse}>
          <StatItem label="Aktive Verbindungen" value={String(data.active_connections ?? 0)} />
          <StatItem label="Max. Verbindungen" value={String(data.max_connections ?? '–')} />
          <StatItem label="Temp-Benutzer aktiv" value={String(data.temp_db_users_active ?? 0)} />
        </AdminCard>

        {tables && (
          <AdminCard title="Tabellen (Zeilen)" icon={ListBullets}>
            {Object.entries(tables).map(([table, count]) => (
              <StatItem key={table} label={table} value={count.toLocaleString('de-DE')} />
            ))}
          </AdminCard>
        )}
      </div>

      {/* Table Sizes */}
      {tableSizes && tableSizes.length > 0 && (
        <AdminCard title="Tabellen-Größen" icon={HardDrive}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            {tableSizes.map(t => (
              <StatItem key={t.name} label={t.name} value={t.size_mb >= 1 ? `${t.size_mb} MB` : `${(t.size_bytes / 1024).toFixed(1)} KB`} />
            ))}
          </div>
        </AdminCard>
      )}

      {/* Temp DB Users */}
      <AdminCard title="Temporäre Datenbank-Benutzer" icon={Key}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-foreground/50">Temporäre Zugangsbenutzer mit Ablaufdatum (max. 1 Monat)</p>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
            >
              <Plus size={14} /> Erstellen
            </button>
          </div>

          {showCreateForm && (
            <div className="p-3 rounded-lg bg-foreground/5 border border-foreground/10 space-y-2">
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Benutzername (a-z, 0-9, _)"
                  value={newUser.username}
                  onChange={e => setNewUser(u => ({ ...u, username: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/30"
                />
                <input
                  type="password"
                  placeholder="Passwort (min. 8 Zeichen)"
                  value={newUser.password}
                  onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/30"
                />
                <input
                  type="text"
                  placeholder="Beschreibung (optional)"
                  value={newUser.description}
                  onChange={e => setNewUser(u => ({ ...u, description: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground placeholder:text-foreground/30"
                />
                <select
                  value={newUser.permissions}
                  onChange={e => setNewUser(u => ({ ...u, permissions: e.target.value }))}
                  className="px-2 py-1.5 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground"
                >
                  <option value="readonly">Nur Lesen</option>
                  <option value="readwrite">Lesen & Schreiben</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-foreground/60">Ablauf in Tagen:</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={newUser.expires_in_days}
                  onChange={e => setNewUser(u => ({ ...u, expires_in_days: Math.min(31, Math.max(1, +e.target.value)) }))}
                  className="w-16 px-2 py-1 text-xs rounded-lg bg-foreground/5 border border-foreground/10 text-foreground"
                />
                <button
                  onClick={handleCreateUser}
                  disabled={creating || !newUser.username || !newUser.password}
                  className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Erstelle...' : 'Erstellen'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-2 py-1.5 text-xs rounded-lg text-foreground/60 hover:text-foreground/80"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {tempUsers.length === 0 && !showCreateForm && (
            <p className="text-xs text-foreground/40 text-center py-2">Keine temporären Benutzer vorhanden.</p>
          )}

          {tempUsers.map(u => (
            <div
              key={u.id}
              className={`flex items-center justify-between p-2 rounded-lg ${u.revoked ? 'bg-red-500/5 border border-red-500/10' : 'bg-foreground/5 border border-foreground/10'}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{u.username}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.permissions === 'readwrite' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'}`}>
                    {u.permissions === 'readwrite' ? 'Lesen & Schreiben' : 'Nur Lesen'}
                  </span>
                  {u.revoked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">Widerrufen</span>}
                </div>
                {u.description && <p className="text-[10px] text-foreground/40 mt-0.5">{u.description}</p>}
                <div className="flex gap-3 text-[10px] text-foreground/40 mt-0.5">
                  <span>Ablauf: {formatTime(u.expires_at)}</span>
                  {u.last_used_at && <span>Zuletzt: {formatTime(u.last_used_at)}</span>}
                </div>
              </div>
              {!u.revoked && (
                <button
                  onClick={() => handleRevokeUser(u.id)}
                  className="ml-2 p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Widerrufen"
                >
                  <UserMinus size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  )
}

// ── System Notifications Tab ──────────────────────────────────────────

interface SystemNotification {
  id: string
  category: string
  severity: string
  title: string
  message: string
  details?: Record<string, unknown>
  source: string
  acknowledged: boolean
  acknowledged_by?: string
  acknowledged_at?: string
  resolved: boolean
  resolved_at?: string
  created_at: string
}

interface SyncEntityStatus {
  entity_id: string
  friendly_name: string
  last_sync_at?: string
  oldest_data_at?: string
  newest_data_at?: string
  total_points: number
  sync_state: string
  last_error?: string
  updated_at: string
}

function SystemNotificationsTab({ token }: { token: string }) {
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [syncStatus, setSyncStatus] = useState<{ entities: SyncEntityStatus[]; total_points: number; oldest_data?: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showResolved, setShowResolved] = useState(false)
  const [activeSection, setActiveSection] = useState<'notifications' | 'sync'>('notifications')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [notifs, sync] = await Promise.all([
        adminFetch(`/api/admin/system-notifications?show_resolved=${showResolved}`, token),
        adminFetch('/api/admin/location-sync/status', token),
      ])
      setNotifications(notifs as SystemNotification[])
      setSyncStatus(sync as { entities: SyncEntityStatus[]; total_points: number; oldest_data?: string })
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token, showResolved])

  useEffect(() => { load() }, [load])

  const handleAcknowledge = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}/acknowledge`, token, { method: 'PUT' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, acknowledged: true } : n))
    } catch { /* ignore */ }
  }

  const handleResolve = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}/resolve`, token, { method: 'PUT' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, resolved: true } : n))
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}`, token, { method: 'DELETE' })
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch { /* ignore */ }
  }

  const handleClearResolved = async () => {
    try {
      await adminFetch('/api/admin/system-notifications/clear-resolved', token, { method: 'DELETE' })
      load()
    } catch { /* ignore */ }
  }

  const handleForceSync = async (entityId: string) => {
    try {
      await adminFetch(`/api/admin/location-sync/${encodeURIComponent(entityId)}/force-sync`, token, { method: 'POST' })
      load()
    } catch { /* ignore */ }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const severityColor = (s: string) => {
    switch (s) {
      case 'critical': return 'text-red-400 bg-red-500/10'
      case 'warning': return 'text-amber-400 bg-amber-500/10'
      case 'info': return 'text-blue-400 bg-blue-500/10'
      default: return 'text-foreground/60 bg-foreground/5'
    }
  }

  const syncStateColor = (s: string) => {
    switch (s) {
      case 'synced': return 'text-green-400'
      case 'syncing': return 'text-blue-400'
      case 'error': return 'text-red-400'
      case 'pending': return 'text-amber-400'
      default: return 'text-foreground/60'
    }
  }

  const formatTime = (t?: string) => {
    if (!t) return '–'
    try { return new Date(t).toLocaleString('de-DE') } catch { return t }
  }

  return (
    <div className="space-y-4">
      {/* Section Toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection('notifications')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
            activeSection === 'notifications'
              ? 'bg-accent/20 text-accent font-semibold'
              : 'text-foreground/60 hover:text-foreground/80'
          }`}
        >
          <Siren size={14} className="inline mr-1" />
          Meldungen ({notifications.length})
        </button>
        <button
          onClick={() => setActiveSection('sync')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
            activeSection === 'sync'
              ? 'bg-accent/20 text-accent font-semibold'
              : 'text-foreground/60 hover:text-foreground/80'
          }`}
        >
          <ArrowClockwise size={14} className="inline mr-1" />
          Standort-Sync ({syncStatus?.entities.length ?? 0})
        </button>
      </div>

      {/* Notifications Section */}
      {activeSection === 'notifications' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowResolved(!showResolved)}
                className="flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/80"
              >
                {showResolved ? <ToggleRight size={16} className="text-accent" /> : <ToggleLeft size={16} />}
                Erledigte anzeigen
              </button>
            </div>
            <div className="flex gap-2">
              {showResolved && (
                <button
                  onClick={handleClearResolved}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash size={12} />
                  Erledigte löschen
                </button>
              )}
              <button onClick={load} className="flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/80">
                <ArrowClockwise size={12} />
                Aktualisieren
              </button>
            </div>
          </div>

          {notifications.length === 0 ? (
            <AdminCard>
              <div className="text-center py-6 text-foreground/40 text-sm">
                <CheckCircle size={24} className="mx-auto mb-2 text-green-400" />
                Keine offenen Systemmeldungen
              </div>
            </AdminCard>
          ) : (
            <div className="space-y-2">
              {notifications.map(n => (
                <AdminCard key={n.id} className={n.resolved ? 'opacity-50' : ''}>
                  <div className="flex items-start gap-3">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${severityColor(n.severity)}`}>
                      {n.severity}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground">{n.title}</span>
                        <span className="text-[10px] text-foreground/40">{n.category}</span>
                      </div>
                      <p className="text-xs text-foreground/70 mb-2">{n.message}</p>
                      {n.details && (
                        <div className="text-[10px] text-foreground/40 bg-foreground/5 rounded px-2 py-1 mb-2 font-mono">
                          {Object.entries(n.details).map(([k, v]) => (
                            <div key={k}>{k}: {String(v)}</div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-foreground/40">
                        <span>{formatTime(n.created_at)}</span>
                        <span>{n.source}</span>
                        {n.acknowledged && <span className="text-blue-400">Bestätigt{n.acknowledged_by ? ` von ${n.acknowledged_by}` : ''}</span>}
                        {n.resolved && <span className="text-green-400">Erledigt</span>}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!n.acknowledged && (
                        <button onClick={() => handleAcknowledge(n.id)} className="p-1 rounded hover:bg-foreground/10" title="Bestätigen">
                          <Eye size={14} className="text-blue-400" />
                        </button>
                      )}
                      {!n.resolved && (
                        <button onClick={() => handleResolve(n.id)} className="p-1 rounded hover:bg-foreground/10" title="Als erledigt markieren">
                          <CheckCircle size={14} className="text-green-400" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(n.id)} className="p-1 rounded hover:bg-foreground/10" title="Löschen">
                        <Trash size={14} className="text-red-400" />
                      </button>
                    </div>
                  </div>
                </AdminCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sync Status Section */}
      {activeSection === 'sync' && syncStatus && (
        <div className="space-y-3">
          <AdminCard title="Übersicht" icon={Database}>
            <StatItem label="Gesamt-Datenpunkte" value={syncStatus.total_points.toLocaleString('de-DE')} />
            <StatItem label="Älteste Daten" value={formatTime(syncStatus.oldest_data)} />
            <StatItem label="Sync-Intervall" value="5 Minuten" />
            <StatItem label="Getrackte Entitäten" value={syncStatus.entities.length} />
          </AdminCard>

          {syncStatus.entities.length === 0 ? (
            <AdminCard>
              <div className="text-center py-6 text-foreground/40 text-sm">
                Noch keine Standort-Entitäten synchronisiert
              </div>
            </AdminCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {syncStatus.entities.map(e => (
                <AdminCard key={e.entity_id}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{e.friendly_name || e.entity_id}</div>
                      <div className="text-[10px] text-foreground/40 font-mono">{e.entity_id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase ${syncStateColor(e.sync_state)}`}>
                        {e.sync_state}
                      </span>
                      <button
                        onClick={() => handleForceSync(e.entity_id)}
                        className="p-1 rounded hover:bg-foreground/10" title="Sync erzwingen"
                      >
                        <ArrowClockwise size={14} className="text-accent" />
                      </button>
                    </div>
                  </div>
                  <StatItem label="Datenpunkte" value={e.total_points.toLocaleString('de-DE')} />
                  <StatItem label="Letzter Sync" value={formatTime(e.last_sync_at)} />
                  <StatItem label="Älteste Daten" value={formatTime(e.oldest_data_at)} />
                  <StatItem label="Neueste Daten" value={formatTime(e.newest_data_at)} />
                  {e.last_error && (
                    <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">
                      {e.last_error}
                    </div>
                  )}
                </AdminCard>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Utilities ──────────────────────────────────────────────────

export function LoadingSpinner() {
  return (
    <div className="glass-card rounded-2xl p-8 theme-transition flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
    </div>
  )
}

export function InlineSpinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <div style={{ width: size, height: size }} className={`border-2 border-current/30 border-t-current rounded-full animate-spin shrink-0 ${className}`} />
}

export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl p-4 theme-transition">
      <div className="flex items-center gap-2 text-sm text-red-400">
        <Warning size={16} className="flex-shrink-0" />
        <span>{children}</span>
      </div>
    </div>
  )
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds) return '–'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ─── Warnings Tab ──────────────────────────────────────────────────────────────

interface WarningLogEntry {
  id: number
  entity_id: string
  title: string
  message: string
  level: string
  source: string
  started_at: string
  ended_at: string | null
  attributes: Record<string, unknown> | null
  acknowledged: boolean
}

function WarningsTab({ token }: { token: string }) {
  const [warnings, setWarnings] = useState<WarningLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeOnly, setActiveOnly] = useState(false)
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchWarnings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      })
      if (activeOnly) params.set('active', 'true')
      const data = await adminFetch(`/api/admin/warnings/log?${params}`, token)
      setWarnings(data.warnings)
      setTotal(data.total)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler')
    } finally {
      setLoading(false)
    }
  }, [token, page, activeOnly])

  useEffect(() => { fetchWarnings() }, [fetchWarnings])

  const handleClearLog = async () => {
    if (!confirm('Alle Warnungsprotokolle unwiderruflich löschen?')) return
    try {
      await adminFetch('/api/admin/warnings/log', token, { method: 'DELETE' })
      setPage(0)
      fetchWarnings()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Löschen')
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  const levelIcon = (level: string) => {
    switch (level) {
      case 'critical':
      case 'emergency': return <Siren size={16} weight="fill" className="text-red-400" />
      case 'severe': return <ShieldWarning size={16} weight="fill" className="text-orange-400" />
      case 'warning': return <CloudWarning size={16} weight="fill" className="text-yellow-400" />
      default: return <Warning size={16} weight="fill" className="text-blue-400" />
    }
  }

  const levelLabel = (level: string) => {
    const labels: Record<string, string> = {
      emergency: 'Notfall',
      critical: 'Kritisch',
      severe: 'Schwer',
      warning: 'Warnung',
      info: 'Info',
    }
    return labels[level] || level
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const formatDuration = (startIso: string, endIso: string | null) => {
    const start = new Date(startIso).getTime()
    const end = endIso ? new Date(endIso).getTime() : Date.now()
    const diffMs = end - start
    const mins = Math.floor(diffMs / 60000)
    const hours = Math.floor(mins / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}T ${hours % 24}h`
    if (hours > 0) return `${hours}h ${mins % 60}m`
    return `${mins}m`
  }

  // ── Test Warning State ──
  const [testLevel, setTestLevel] = useState<string>('warning')
  const [testHeadline, setTestHeadline] = useState('')
  const [testDescription, setTestDescription] = useState('')
  const [testSending, setTestSending] = useState(false)

  const sendTestWarning = async () => {
    setTestSending(true)
    try {
      await adminFetch('/api/admin/nina/test-warning', token, {
        method: 'POST',
        body: JSON.stringify({
          level: testLevel,
          headline: testHeadline || 'Test-Warnung',
          description: testDescription || 'Dies ist eine Testwarnung des NINA-Warnsystems.',
        }),
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Senden')
    } finally {
      setTestSending(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Test Warning Section */}
      <AdminCard>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Siren size={22} weight="duotone" className="text-red-400" />
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">Testwarnung senden</h3>
              <p className="text-xs text-foreground/50">Sendet eine Testwarnung an alle verbundenen Geräte</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Level selector */}
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/60 font-medium">Warnstufe</label>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { value: 'info', label: 'Info', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
                  { value: 'warning', label: 'Warnung', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
                  { value: 'critical', label: 'Kritisch', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
                  { value: 'emergency', label: 'Notfall', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTestLevel(opt.value)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-all font-medium ${
                      testLevel === opt.value
                        ? opt.color
                        : 'bg-white/5 text-foreground/50 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Headline */}
            <div className="space-y-1.5">
              <label className="text-xs text-foreground/60 font-medium">Überschrift</label>
              <input
                type="text"
                value={testHeadline}
                onChange={e => setTestHeadline(e.target.value)}
                placeholder="Test-Warnung"
                className="w-full text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground/90 placeholder:text-foreground/30 focus:outline-none focus:border-accent/40"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs text-foreground/60 font-medium">Beschreibung</label>
            <textarea
              value={testDescription}
              onChange={e => setTestDescription(e.target.value)}
              placeholder="Dies ist eine Testwarnung des NINA-Warnsystems."
              rows={2}
              className="w-full text-xs px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-foreground/90 placeholder:text-foreground/30 focus:outline-none focus:border-accent/40 resize-none"
            />
          </div>

          {/* Send button */}
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-foreground/40">Die Testwarnung wird nach 30 Sekunden automatisch entfernt.</p>
            <button
              onClick={sendTestWarning}
              disabled={testSending}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {testSending ? (
                <ArrowClockwise size={14} className="animate-spin" />
              ) : (
                <Siren size={14} weight="fill" />
              )}
              Testwarnung senden
            </button>
          </div>
        </div>
      </AdminCard>

      {/* Header */}
      <AdminCard>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ShieldWarning size={22} weight="duotone" className="text-accent" />
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">Warnungsprotokoll</h3>
              <p className="text-xs text-foreground/50">{total} Einträge gesamt</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setActiveOnly(!activeOnly); setPage(0) }}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                activeOnly
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-white/5 text-foreground/60 border border-white/10 hover:bg-white/10'
              }`}
            >
              {activeOnly ? <ToggleRight size={14} weight="fill" /> : <ToggleLeft size={14} />}
              Nur aktive
            </button>
            <button
              onClick={() => fetchWarnings()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 text-foreground/60 border border-white/10 hover:bg-white/10 transition-colors"
            >
              <ArrowClockwise size={14} />
              Aktualisieren
            </button>
            <button
              onClick={handleClearLog}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Trash size={14} />
              Protokoll löschen
            </button>
          </div>
        </div>
      </AdminCard>

      {/* Content */}
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorMessage>{error}</ErrorMessage>
      ) : warnings.length === 0 ? (
        <AdminCard>
          <div className="text-center py-8 text-foreground/40 text-sm">
            Keine Warnungen {activeOnly ? 'aktiv' : 'protokolliert'}
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-2">
          {warnings.map(w => (
            <AdminCard key={w.id}>
              <div className="flex items-start gap-3">
                {/* Level icon */}
                <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                  {levelIcon(w.level)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground/90 truncate">{w.title || w.entity_id}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      w.level === 'critical' || w.level === 'emergency' ? 'bg-red-500/20 text-red-400' :
                      w.level === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                      w.level === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {levelLabel(w.level)}
                    </span>
                    {!w.ended_at && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium animate-pulse">
                        Aktiv
                      </span>
                    )}
                  </div>
                  {w.message && (
                    <p className="text-xs text-foreground/50 mt-1 line-clamp-2">{w.message}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[11px] text-foreground/40 flex-wrap">
                    {w.source && <span>Quelle: {w.source}</span>}
                    <span>Start: {formatDate(w.started_at)}</span>
                    {w.ended_at ? (
                      <span>Ende: {formatDate(w.ended_at)}</span>
                    ) : (
                      <span className="text-green-400/70">läuft noch</span>
                    )}
                    <span>Dauer: {formatDuration(w.started_at, w.ended_at)}</span>
                  </div>
                </div>
              </div>
            </AdminCard>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-foreground/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Zurück
              </button>
              <span className="text-xs text-foreground/50">
                Seite {page + 1} von {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-foreground/60 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Weiter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Webhooks Tab ──────────────────────────────────────────────────────────────

interface WebhookEntry {
  id: string
  name: string
  url: string
  events: string[]
  headers: Record<string, string>
  active: boolean
  created_at: string
  updated_at: string
  last_triggered_at: string | null
  trigger_count: number
  consecutive_failures: number
}

interface WebhookDelivery {
  id: number
  event_type: string
  payload: unknown
  status_code: number | null
  response_body: string | null
  duration_ms: number | null
  attempt: number
  success: boolean
  error: string | null
  created_at: string
}

function WebhooksTab({ token }: { token: string }) {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', secret: '', events: '*' })
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; status_code?: number; duration_ms?: number; error?: string } | null>(null)
  const [deliveryLog, setDeliveryLog] = useState<{ webhookId: string; deliveries: WebhookDelivery[] } | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await adminFetch('/api/webhooks', token) as { webhooks: WebhookEntry[] }
      setWebhooks(data.webhooks || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setActionLoading('create')
    try {
      const events = form.events.trim() === '*' ? ['*'] : form.events.split(',').map(s => s.trim()).filter(Boolean)
      await adminFetch('/api/webhooks', token, {
        method: 'POST',
        body: JSON.stringify({ name: form.name, url: form.url, secret: form.secret || undefined, events }),
      })
      setShowCreate(false)
      setForm({ name: '', url: '', secret: '', events: '*' })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (id: string) => {
    setActionLoading(`del-${id}`)
    try {
      await adminFetch(`/api/webhooks/${id}`, token, { method: 'DELETE' })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleToggle = async (id: string, active: boolean) => {
    setActionLoading(`tog-${id}`)
    try {
      await adminFetch(`/api/webhooks/${id}`, token, {
        method: 'PUT',
        body: JSON.stringify({ active: !active }),
      })
      load()
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  const handleTest = async (id: string) => {
    setTesting(id); setTestResult(null)
    try {
      const result = await adminFetch(`/api/webhooks/${id}/test`, token, { method: 'POST' })
      setTestResult(result as typeof testResult)
    } catch (e) { setTestResult({ success: false, error: (e as Error).message }) }
    setTesting(null)
  }

  const handleShowDeliveries = async (webhookId: string) => {
    if (deliveryLog?.webhookId === webhookId) { setDeliveryLog(null); return }
    setActionLoading(`dlv-${webhookId}`)
    try {
      const data = await adminFetch(`/api/webhooks/${webhookId}/deliveries?limit=20`, token) as { deliveries: WebhookDelivery[] }
      setDeliveryLog({ webhookId, deliveries: data.deliveries || [] })
    } catch { /* ignore */ }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Test result */}
      {testResult && (
        <AdminCard className={`border ${testResult.success ? 'border-green-500/30' : 'border-red-500/30'}`}>
          <div className="flex items-center gap-2">
            {testResult.success
              ? <CheckCircle size={16} weight="fill" className="text-green-400" />
              : <XCircle size={16} weight="fill" className="text-red-400" />}
            <div className="flex-1">
              <p className="text-xs font-semibold">{testResult.success ? 'Webhook Test erfolgreich' : 'Webhook Test fehlgeschlagen'}</p>
              <div className="flex gap-3 mt-0.5">
                {testResult.status_code && <span className="text-[10px] text-foreground/60">Status: {testResult.status_code}</span>}
                {testResult.duration_ms != null && <span className="text-[10px] text-foreground/60">{testResult.duration_ms}ms</span>}
                {testResult.error && <span className="text-[10px] text-red-400">{testResult.error}</span>}
              </div>
            </div>
            <button onClick={() => setTestResult(null)} className="p-1 rounded hover:bg-foreground/10"><X size={12} /></button>
          </div>
        </AdminCard>
      )}

      {/* Create */}
      <AdminCard>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-foreground">{webhooks.length} Webhook{webhooks.length !== 1 ? 's' : ''}</span>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85 transition-all"
          >
            <Plus size={14} weight="bold" /> Neuer Webhook
          </button>
        </div>
      </AdminCard>

      {showCreate && (
        <AdminCard>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Name</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="z.B. Discord Benachrichtigung"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">URL</label>
              <input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/webhook"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Secret (optional, für HMAC-SHA256 Signatur)</label>
              <input type="text" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })}
                placeholder="Geheimes Token..."
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Event-Filter (kommagetrennt, * = alle)</label>
              <input type="text" value={form.events} onChange={e => setForm({ ...form, events: e.target.value })}
                placeholder="* oder state_changed, domain.light"
                className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
              <p className="text-[10px] text-foreground/50 mt-1">Filter: *, state_changed, domain.light, light.wohnzimmer, state_changed.light.wohnzimmer</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/10 text-foreground hover:bg-foreground/20 transition-all">
                Abbrechen
              </button>
              <button onClick={handleCreate} disabled={!form.name.trim() || !form.url.trim() || actionLoading === 'create'}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-40 hover:bg-accent/80 transition-all flex items-center gap-1.5">
                {actionLoading === 'create' && <InlineSpinner size={12} />}
                Erstellen
              </button>
            </div>
          </div>
        </AdminCard>
      )}

      {/* Webhook list */}
      {webhooks.map(wh => (
        <AdminCard key={wh.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium truncate">{wh.name}</span>
                {wh.active
                  ? <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 text-[10px] font-semibold border border-green-500/20">Aktiv</span>
                  : <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 text-[10px] font-semibold border border-red-500/20">Inaktiv</span>}
                {wh.consecutive_failures > 0 && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px] font-semibold border border-amber-500/20">
                    {wh.consecutive_failures} Fehler
                  </span>
                )}
              </div>
              <div className="text-[10px] text-foreground/60 mt-1 font-mono truncate">{wh.url}</div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="text-[10px] text-foreground/50">Events: {Array.isArray(wh.events) ? wh.events.join(', ') : '*'}</span>
                <span className="text-[10px] text-foreground/50">· {wh.trigger_count}× ausgelöst</span>
                {wh.last_triggered_at && <span className="text-[10px] text-foreground/50">· Letzt.: {new Date(wh.last_triggered_at).toLocaleString('de-DE')}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Tip content="Test senden">
                <button onClick={() => handleTest(wh.id)} disabled={testing === wh.id}
                  className="p-2 rounded-lg text-foreground/60 hover:text-accent hover:bg-accent/10 transition-all disabled:opacity-40">
                  {testing === wh.id ? <ArrowClockwise size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />}
                </button>
              </Tip>
              <Tip content="Zustellungen anzeigen">
                <button onClick={() => handleShowDeliveries(wh.id)}
                  disabled={actionLoading === `dlv-${wh.id}`}
                  className={`p-2 rounded-lg transition-all disabled:opacity-40 ${deliveryLog?.webhookId === wh.id ? 'text-accent bg-accent/10' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/10'}`}>
                  {actionLoading === `dlv-${wh.id}` ? <InlineSpinner size={14} /> : <Eye size={14} />}
                </button>
              </Tip>
              <Tip content={wh.active ? 'Deaktivieren' : 'Aktivieren'}>
                <button onClick={() => handleToggle(wh.id, wh.active)}
                  disabled={actionLoading === `tog-${wh.id}`}
                  className="p-2 rounded-lg text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-all disabled:opacity-40">
                  {actionLoading === `tog-${wh.id}` ? <InlineSpinner size={14} /> : (wh.active ? <ToggleRight size={14} weight="fill" className="text-green-400" /> : <ToggleLeft size={14} />)}
                </button>
              </Tip>
              <button onClick={() => handleDelete(wh.id)}
                disabled={actionLoading === `del-${wh.id}`}
                className="p-2 rounded-lg text-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-40">
                {actionLoading === `del-${wh.id}` ? <InlineSpinner size={14} /> : <Trash size={14} />}
              </button>
            </div>
          </div>

          {/* Delivery log */}
          {deliveryLog?.webhookId === wh.id && (
            <div className="mt-3 pt-3 border-t border-foreground/8">
              <p className="text-xs font-semibold text-foreground/70 mb-2">Letzte Zustellungen</p>
              {deliveryLog.deliveries.length === 0 ? (
                <p className="text-xs text-foreground/50">Noch keine Zustellungen.</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {deliveryLog.deliveries.map(d => (
                    <div key={d.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-foreground/3">
                      {d.success
                        ? <CheckCircle size={12} weight="fill" className="text-green-400 shrink-0" />
                        : <XCircle size={12} weight="fill" className="text-red-400 shrink-0" />}
                      <span className="text-[10px] text-foreground/60 font-mono">{d.status_code ?? '–'}</span>
                      <span className="text-[10px] text-foreground/50 truncate flex-1">{d.event_type}</span>
                      {d.duration_ms != null && <span className="text-[10px] text-foreground/40">{d.duration_ms}ms</span>}
                      <span className="text-[10px] text-foreground/40">{new Date(d.created_at).toLocaleString('de-DE')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </AdminCard>
      ))}

      {webhooks.length === 0 && !showCreate && (
        <AdminCard>
          <div className="text-center py-6">
            <WebhooksLogo size={32} className="text-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-foreground/50">Keine Webhooks registriert.</p>
            <p className="text-xs text-foreground/35 mt-1">Webhooks senden HTTP POST-Anfragen bei Entity-Ereignissen an deine Endpunkte.</p>
          </div>
        </AdminCard>
      )}

      {/* Info card */}
      <AdminCard title="Webhook-Dokumentation" icon={Lightning}>
        <div className="space-y-2 text-xs text-foreground/60">
          <p>Webhooks senden automatisch <strong className="text-foreground/80">HTTP POST</strong> Anfragen mit JSON-Payload wenn sich Entity-Zustände ändern.</p>
          <div className="bg-foreground/5 rounded-lg p-3 font-mono text-[10px] text-foreground/50 overflow-x-auto">
            <pre>{`POST ${'{'}webhook_url{'}'}\nContent-Type: application/json\nX-Webhook-Signature: sha256=...\n\n{\n  "event": "state_changed",\n  "timestamp": "2025-01-01T12:00:00Z",\n  "data": {\n    "entity_id": "light.wohnzimmer",\n    "state": "on",\n    "attributes": {...}\n  }\n}`}</pre>
          </div>
          <p><strong className="text-foreground/80">Event-Filter:</strong> <code className="bg-foreground/10 px-1 rounded">*</code> (alle), <code className="bg-foreground/10 px-1 rounded">state_changed</code>, <code className="bg-foreground/10 px-1 rounded">domain.light</code>, <code className="bg-foreground/10 px-1 rounded">light.wohnzimmer</code></p>
          <p><strong className="text-foreground/80">Sicherheit:</strong> Bei gesetztem Secret wird ein <code className="bg-foreground/10 px-1 rounded">X-Webhook-Signature</code> Header mit HMAC-SHA256 Signatur mitgesendet.</p>
          <p><strong className="text-foreground/80">Auto-Deaktivierung:</strong> Nach 10 aufeinanderfolgenden Fehlern wird der Webhook automatisch deaktiviert.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── Realtime Tab ──────────────────────────────────────────────────────────────

interface MetricsSnapshot {
  timestamp: string
  uptime_seconds: number
  http: { requests_total: number; errors_total: number }
  websocket: { messages_sent: number; messages_received: number }
  entities: { state_changes: number }
  services: { calls_total: number }
  ha_websocket: { reconnects: number }
  tasks: { runs_total: number; errors_total: number }
  logs: { error_count: number; warn_count: number; info_count: number; buffer_size: number }
  sse: { active_connections: number }
  cache: { hits: number; misses: number }
  live?: { entity_count: number; connected_clients: number; ha_connected: boolean; entity_updates_total?: number }
  task_breakdown?: Array<{ id: number; name: string; runs: number; errors: number; enabled: boolean }>
}

function RealtimeTab({ token }: { token: string }) {
  const [activeSection, setActiveSection] = useState<'metrics' | 'sse' | 'ws'>('metrics')

  // ── Metrics state ──
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<MetricsSnapshot[]>([])
  const [metricsLive, setMetricsLive] = useState(false)
  const [metricsLoading, setMetricsLoading] = useState(true)

  // ── SSE state ──
  const [sseConnected, setSseConnected] = useState(false)
  const [sseEvents, setSseEvents] = useState<{ id: number; type: string; data: string; time: string }[]>([])
  const [wsConnected, setWsConnected] = useState(false)
  const [wsEvents, setWsEvents] = useState<{ id: number; ns: string; event: string; data: string; time: string }[]>([])
  const [sseSource, setSseSource] = useState<EventSource | null>(null)
  const [wsSocket, setWsSocket] = useState<WebSocket | null>(null)
  const [sseFilter, setSseFilter] = useState('')
  const [wsNamespace, setWsNamespace] = useState('entities')
  const [wsDomainFilter, setWsDomainFilter] = useState('')
  const [eventIdCounter, setEventIdCounter] = useState(0)

  const nextId = useCallback(() => {
    setEventIdCounter(c => c + 1)
    return eventIdCounter + 1
  }, [eventIdCounter])

  // ── Metrics: initial load ──
  useEffect(() => {
    adminFetch('/api/admin/metrics', token)
      .then((data: MetricsSnapshot) => { setMetrics(data); setMetricsLoading(false) })
      .catch(() => setMetricsLoading(false))
  }, [token])

  // ── Metrics: live SSE stream ──
  useEffect(() => {
    if (!metricsLive) return
    const es = new EventSource(`${API_BASE}/api/admin/metrics/live${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    es.addEventListener('metrics', (e) => {
      try {
        const snapshot = JSON.parse((e as MessageEvent).data) as MetricsSnapshot
        setMetrics(snapshot)
        setMetricsHistory(prev => {
          const next = [...prev, snapshot]
          return next.length > 60 ? next.slice(-60) : next
        })
      } catch { /* skip */ }
    })
    es.onerror = () => setMetricsLive(false)
    return () => es.close()
  }, [metricsLive])

  // SSE connect/disconnect
  const toggleSse = useCallback(() => {
    if (sseSource) {
      sseSource.close()
      setSseSource(null)
      setSseConnected(false)
      return
    }
    const params = sseFilter.trim() ? `?domains=${encodeURIComponent(sseFilter.trim())}` : ''
    const es = new EventSource(`${API_BASE}/api/events/stream${params}`)
    es.addEventListener('connected', (e) => {
      setSseConnected(true)
      setSseEvents(prev => [{ id: nextId(), type: 'connected', data: (e as MessageEvent).data, time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    })
    es.addEventListener('state_changed', (e) => {
      setSseEvents(prev => [{ id: nextId(), type: 'state_changed', data: (e as MessageEvent).data, time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    })
    es.addEventListener('warning', (e) => {
      setSseEvents(prev => [{ id: nextId(), type: 'warning', data: (e as MessageEvent).data, time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    })
    es.onerror = () => {
      setSseConnected(false)
      setSseEvents(prev => [{ id: nextId(), type: 'error', data: 'Verbindung verloren', time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
    }
    setSseSource(es)
  }, [sseSource, sseFilter, nextId])

  // WS connect/disconnect
  const toggleWs = useCallback(() => {
    if (wsSocket) {
      wsSocket.close()
      setWsSocket(null)
      setWsConnected(false)
      return
    }
    let wsHost: string
    if (API_BASE) {
      try { wsHost = new URL(API_BASE).host } catch { wsHost = window.location.host }
    } else {
      wsHost = window.location.host
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${wsHost}/ws/realtime`)
    ws.onopen = () => {
      setWsConnected(true)
      // Subscribe to selected namespace
      const sub: Record<string, unknown> = { namespace: wsNamespace, event: 'subscribe', data: {} }
      if (wsNamespace === 'entities' && wsDomainFilter.trim()) {
        sub.data = { domains: wsDomainFilter.split(',').map(s => s.trim()).filter(Boolean) }
      }
      ws.send(JSON.stringify(sub))
    }
    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data)
        setWsEvents(prev => [{
          id: nextId(),
          ns: parsed.namespace || '–',
          event: parsed.event || '–',
          data: JSON.stringify(parsed.data || parsed, null, 0).slice(0, 300),
          time: new Date().toLocaleTimeString('de-DE'),
        }, ...prev].slice(0, 100))
      } catch {
        setWsEvents(prev => [{ id: nextId(), ns: '–', event: 'raw', data: e.data?.slice(0, 300), time: new Date().toLocaleTimeString('de-DE') }, ...prev].slice(0, 100))
      }
    }
    ws.onerror = () => setWsConnected(false)
    ws.onclose = () => { setWsConnected(false); setWsSocket(null) }
    setWsSocket(ws)
  }, [wsSocket, wsNamespace, wsDomainFilter, nextId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sseSource?.close()
      wsSocket?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {/* Section Toggle */}
      <AdminCard>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setActiveSection('metrics')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === 'metrics' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
            <Heartbeat size={14} weight={activeSection === 'metrics' ? 'fill' : 'regular'} /> Metrics Dashboard
          </button>
          <button onClick={() => setActiveSection('sse')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === 'sse' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
            <Broadcast size={14} /> SSE Event-Stream
          </button>
          <button onClick={() => setActiveSection('ws')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${activeSection === 'ws' ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
            <Lightning size={14} /> Realtime WebSocket
          </button>
        </div>
      </AdminCard>

      {/* Metrics Dashboard Section */}
      {activeSection === 'metrics' && (
        <>
          {/* Live toggle */}
          <AdminCard>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heartbeat size={16} weight="fill" className="text-accent" />
                <span className="text-sm font-semibold text-foreground">IORA Metrics Dashboard</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMetricsLive(!metricsLive)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    metricsLive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                  }`}>
                  <Broadcast size={12} weight={metricsLive ? 'fill' : 'regular'} />
                  {metricsLive ? 'Live (2s)' : 'Live starten'}
                </button>
                <button onClick={() => adminFetch('/api/admin/metrics', token).then((d: MetricsSnapshot) => setMetrics(d)).catch(() => {})}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-foreground/70 hover:text-accent hover:bg-accent/10 transition">
                  <ArrowClockwise size={12} /> Refresh
                </button>
              </div>
            </div>
          </AdminCard>

          {metricsLoading ? <LoadingSpinner /> : metrics && (
            <>
              {/* Key Metrics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.http.requests_total.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">HTTP Requests</div>
                  {metrics.http.errors_total > 0 && <div className="text-[9px] text-red-400 mt-0.5">{metrics.http.errors_total} Fehler</div>}
                </div>
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.entities.state_changes.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">State Changes</div>
                </div>
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.services.calls_total.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">Service Calls</div>
                </div>
                <div className="glass-card rounded-2xl p-4 theme-transition text-center">
                  <div className={`text-2xl font-bold ${metrics.live?.ha_connected ? 'text-green-400' : 'text-red-400'}`}>
                    {metrics.live?.ha_connected ? 'Online' : 'Offline'}
                  </div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">HA Verbindung</div>
                </div>
              </div>

              {/* Detailed Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {/* System */}
                <AdminCard title="System" icon={Cpu}>
                  <StatItem label="Uptime" value={formatUptime(metrics.uptime_seconds)} />
                  <StatItem label="Entities" value={metrics.live?.entity_count ?? '–'} />
                  <StatItem label="WS Clients" value={metrics.live?.connected_clients ?? 0} />
                  <StatItem label="SSE Streams" value={metrics.sse.active_connections} />
                </AdminCard>

                {/* HTTP */}
                <AdminCard title="HTTP" icon={Globe}>
                  <StatItem label="Requests Total" value={metrics.http.requests_total.toLocaleString()} />
                  <StatItem label="Errors" value={metrics.http.errors_total.toLocaleString()} />
                  <StatItem label="Error Rate" value={metrics.http.requests_total > 0 ? `${((metrics.http.errors_total / metrics.http.requests_total) * 100).toFixed(2)}%` : '0%'} />
                </AdminCard>

                {/* WebSocket */}
                <AdminCard title="WebSocket" icon={Lightning}>
                  <StatItem label="Nachrichten gesendet" value={metrics.websocket.messages_sent.toLocaleString()} />
                  <StatItem label="Nachrichten empfangen" value={metrics.websocket.messages_received.toLocaleString()} />
                  <StatItem label="HA Reconnects" value={metrics.ha_websocket.reconnects} />
                </AdminCard>

                {/* Tasks */}
                <AdminCard title="Hintergrund-Aufgaben" icon={ListChecks}>
                  <StatItem label="Ausführungen Total" value={metrics.tasks.runs_total.toLocaleString()} />
                  <StatItem label="Fehler Total" value={metrics.tasks.errors_total.toLocaleString()} />
                  <StatItem label="Error Rate" value={metrics.tasks.runs_total > 0 ? `${((metrics.tasks.errors_total / metrics.tasks.runs_total) * 100).toFixed(2)}%` : '0%'} />
                </AdminCard>

                {/* Logs */}
                <AdminCard title="Log-Statistik" icon={ListBullets}>
                  <StatItem label="Error" value={metrics.logs.error_count.toLocaleString()} />
                  <StatItem label="Warn" value={metrics.logs.warn_count.toLocaleString()} />
                  <StatItem label="Info" value={metrics.logs.info_count.toLocaleString()} />
                  <StatItem label="Buffer" value={`${metrics.logs.buffer_size} / 5000`} />
                </AdminCard>

                {/* Cache */}
                <AdminCard title="Cache" icon={Database}>
                  <StatItem label="Hits" value={metrics.cache.hits.toLocaleString()} />
                  <StatItem label="Misses" value={metrics.cache.misses.toLocaleString()} />
                  <StatItem label="Hit Rate" value={(metrics.cache.hits + metrics.cache.misses) > 0 ? `${((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(1)}%` : '–'} />
                </AdminCard>
              </div>

              {/* Task Breakdown */}
              {metrics.task_breakdown && metrics.task_breakdown.length > 0 && (
                <AdminCard title="Aufgaben-Breakdown" icon={ListChecks}>
                  <div className="space-y-1">
                    {metrics.task_breakdown.map(t => (
                      <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${t.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
                          <span className="text-xs text-foreground/80">{t.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px]">
                          <span className="text-foreground/50">{t.runs} runs</span>
                          {t.errors > 0 && <span className="text-red-400">{t.errors} err</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </AdminCard>
              )}

              {/* Live Activity Sparkline (simple bar chart from history) */}
              {metricsHistory.length > 1 && (
                <AdminCard title="Live-Aktivität (Request-Rate)" icon={TrendUp}>
                  <div className="flex items-end gap-0.5 h-16">
                    {metricsHistory.map((snap, i) => {
                      const prev = metricsHistory[i - 1]
                      const delta = prev ? snap.http.requests_total - prev.http.requests_total : 0
                      const maxDelta = Math.max(1, ...metricsHistory.slice(1).map((s, j) => s.http.requests_total - metricsHistory[j].http.requests_total))
                      const height = Math.max(2, (delta / maxDelta) * 100)
                      return (
                        <Tip key={i} content={`+${delta} req`}>
                          <div
                            className="flex-1 rounded-t bg-accent/40 hover:bg-accent/60 transition-colors min-w-[3px]"
                            style={{ height: `${height}%` }}
                          />
                        </Tip>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-[9px] text-foreground/30 mt-1">
                    <span>{metricsHistory.length * 2}s ago</span>
                    <span>jetzt</span>
                  </div>
                </AdminCard>
              )}
            </>
          )}
        </>
      )}

      {/* SSE Section */}
      {activeSection === 'sse' && (
        <>
          <AdminCard title="SSE Event-Stream" icon={Broadcast}>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <input type="text" value={sseFilter} onChange={e => setSseFilter(e.target.value)}
                    placeholder="Domain-Filter: light,switch,sensor (leer = alle)"
                    disabled={sseConnected}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono disabled:opacity-50" />
                </div>
                <button onClick={toggleSse}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    sseConnected
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                      : 'bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85'
                  }`}>
                  {sseConnected ? <><X size={14} /> Trennen</> : <><Play size={14} /> Verbinden</>}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-400 animate-pulse' : 'bg-foreground/20'}`} />
                <span className="text-[10px] text-foreground/60">{sseConnected ? 'Verbunden — Events werden empfangen' : 'Nicht verbunden'}</span>
                {sseEvents.length > 0 && (
                  <button onClick={() => setSseEvents([])} className="ml-auto text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors">
                    Log leeren
                  </button>
                )}
              </div>
            </div>
          </AdminCard>

          {/* SSE Event Log */}
          {sseEvents.length > 0 && (
            <AdminCard>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {sseEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <span className={`text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded ${
                      ev.type === 'connected' ? 'bg-green-500/15 text-green-400' :
                      ev.type === 'error' ? 'bg-red-500/15 text-red-400' :
                      ev.type === 'warning' ? 'bg-amber-500/15 text-amber-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>{ev.type}</span>
                    <span className="text-[10px] text-foreground/40 shrink-0">{ev.time}</span>
                    <span className="text-[10px] text-foreground/60 font-mono truncate flex-1">{ev.data.slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* SSE Info */}
          <AdminCard>
            <div className="text-xs text-foreground/50 space-y-1">
              <p><strong className="text-foreground/70">Endpoint:</strong> <code className="bg-foreground/10 px-1 rounded">GET /api/events/stream</code></p>
              <p><strong className="text-foreground/70">Filter:</strong> <code className="bg-foreground/10 px-1 rounded">?domains=light,switch</code> und/oder <code className="bg-foreground/10 px-1 rounded">?entity_ids=light.wohnzimmer</code></p>
              <p><strong className="text-foreground/70">Events:</strong> connected, state_changed, warning</p>
              <p><strong className="text-foreground/70">System-Stream:</strong> <code className="bg-foreground/10 px-1 rounded">GET /api/events/system</code> für Health, Watchdog, Anomalien</p>
            </div>
          </AdminCard>
        </>
      )}

      {/* WebSocket Section */}
      {activeSection === 'ws' && (
        <>
          <AdminCard title="Realtime Namespace WebSocket" icon={Lightning}>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-foreground/70 mb-1 block">Namespace</label>
                <div className="flex gap-2">
                  {['entities', 'system', 'notifications'].map(ns => (
                    <button key={ns} onClick={() => setWsNamespace(ns)} disabled={wsConnected}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        wsNamespace === ns ? 'bg-accent text-white shadow-sm' : 'bg-foreground/10 text-foreground/60 border border-foreground/10'
                      } disabled:opacity-50`}>
                      {ns === 'entities' ? 'Entities' : ns === 'system' ? 'System' : 'Notifications'}
                    </button>
                  ))}
                </div>
              </div>
              {wsNamespace === 'entities' && (
                <div>
                  <label className="text-xs text-foreground/70 mb-1 block">Domain-Filter (optional)</label>
                  <input type="text" value={wsDomainFilter} onChange={e => setWsDomainFilter(e.target.value)}
                    placeholder="light,switch,sensor"
                    disabled={wsConnected}
                    className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono disabled:opacity-50" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={toggleWs}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    wsConnected
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                      : 'bg-accent text-white shadow-md shadow-accent/25 hover:bg-accent/85'
                  }`}>
                  {wsConnected ? <><X size={14} /> Trennen</> : <><Play size={14} /> Verbinden</>}
                </button>
                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-400 animate-pulse' : 'bg-foreground/20'}`} />
                <span className="text-[10px] text-foreground/60">{wsConnected ? `Verbunden — ${wsNamespace}` : 'Nicht verbunden'}</span>
                {wsEvents.length > 0 && (
                  <button onClick={() => setWsEvents([])} className="ml-auto text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors">
                    Log leeren
                  </button>
                )}
              </div>
            </div>
          </AdminCard>

          {/* WS Event Log */}
          {wsEvents.length > 0 && (
            <AdminCard>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {wsEvents.map(ev => (
                  <div key={ev.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 shrink-0">{ev.ns}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                      ev.event === 'connected' || ev.event === 'subscribed' ? 'bg-green-500/15 text-green-400' :
                      ev.event === 'error' ? 'bg-red-500/15 text-red-400' :
                      'bg-blue-500/15 text-blue-400'
                    }`}>{ev.event}</span>
                    <span className="text-[10px] text-foreground/40 shrink-0">{ev.time}</span>
                    <span className="text-[10px] text-foreground/60 font-mono truncate flex-1">{ev.data.slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* WS Protocol Info */}
          <AdminCard>
            <div className="text-xs text-foreground/50 space-y-1">
              <p><strong className="text-foreground/70">Endpoint:</strong> <code className="bg-foreground/10 px-1 rounded">ws://host/ws/realtime</code></p>
              <p><strong className="text-foreground/70">Protokoll:</strong> JSON-Nachrichten mit Namespace-Multiplexing (Socket.IO-ähnlich)</p>
              <p><strong className="text-foreground/70">Namespaces:</strong> <code className="bg-foreground/10 px-1 rounded">entities</code> (State-Änderungen), <code className="bg-foreground/10 px-1 rounded">system</code> (Events/Fehler), <code className="bg-foreground/10 px-1 rounded">notifications</code> (Konfig-Änderungen)</p>
              <div className="bg-foreground/5 rounded-lg p-2 mt-2 font-mono text-[10px] text-foreground/40">
                {`// Subscribe\n{"namespace":"entities","event":"subscribe","data":{"domains":["light"]}}\n// Unsubscribe\n{"namespace":"entities","event":"unsubscribe"}\n// Ping\n{"event":"ping"} → {"event":"pong"}`}
              </div>
            </div>
          </AdminCard>
        </>
      )}
    </div>
  )
}

// ── Entity Explorer Tab ──────────────────────────────────────────────────

function EntitiesTab({ token }: { token: string }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [entities, setEntities] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([])
  const [searching, setSearching] = useState(false)
  const [historyEntity, setHistoryEntity] = useState('')
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)
  const [domainLoading, setDomainLoading] = useState(false)

  const loadCounts = useCallback(async () => {
    try {
      setLoading(true)
      const raw = await cachedFetch('/api/entities/count', token) as Record<string, unknown>
      // API returns {total, domains: [{domain, count}, ...]}
      const mapped: Record<string, number> = {}
      const domains = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown>)?.domains) ? (raw as Record<string, unknown>).domains as Record<string, unknown>[] : []
      for (const item of domains as Record<string, unknown>[]) {
        if (item && typeof item === 'object' && 'domain' in item && 'count' in item) {
          mapped[String(item.domain)] = Number(item.count)
        }
      }
      setCounts(mapped)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { loadCounts() }, [loadCounts])

  const loadDomain = async (domain: string) => {
    setSelectedDomain(domain)
    setEntities([])
    setDomainLoading(true)
    try {
      const data = await adminFetch(`/api/entities/domain/${domain}`, token) as Record<string, unknown>[]
      setEntities(Array.isArray(data) ? data : [])
    } catch {}
    finally { setDomainLoading(false) }
  }

  const doSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const data = await adminFetch(`/api/entities/search?q=${encodeURIComponent(searchQuery)}`, token) as Record<string, unknown>[]
      setSearchResults(Array.isArray(data) ? data : [])
    } catch {}
    finally { setSearching(false) }
  }

  const loadHistory = async (entityId: string) => {
    if (historyEntity === entityId) { setHistoryEntity(''); setHistory([]); return }
    setHistoryEntity(entityId)
    setHistoryLoading(true)
    try {
      const data = await adminFetch(`/api/stats/entity-history/${encodeURIComponent(entityId)}`, token) as Record<string, unknown>[]
      setHistory(Array.isArray(data) ? data : [])
    } catch { setHistory([]) }
    finally { setHistoryLoading(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Search */}
      <AdminCard title="Entity-Suche" icon={MagnifyingGlass}>
        <div className="flex gap-2">
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Entity-ID oder Name suchen..."
            className="flex-1 bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
          <button onClick={doSearch} disabled={searching}
            className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50">
            {searching ? '...' : 'Suchen'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
            {searchResults.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono text-accent">{String(e.entity_id ?? '')}</span>
                  <span className="text-xs text-foreground/50 ml-2">{String(e.state ?? '')}</span>
                </div>
                <button onClick={() => loadHistory(String(e.entity_id ?? ''))}
                  className="text-[10px] text-foreground/40 hover:text-accent transition-colors shrink-0 ml-2">
                  <ChartLine size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Domain Counts */}
      {counts && (
        <AdminCard title="Domains" icon={Cube}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {Object.entries(counts).sort(([,a],[,b]) => b - a).map(([domain, count]) => (
              <button key={domain} onClick={() => loadDomain(domain)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  selectedDomain === domain ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/8 border border-transparent'
                }`}>
                <span className="truncate font-mono">{domain}</span>
                <span className="font-semibold ml-1.5 shrink-0">{count}</span>
              </button>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Domain Entities */}
      {selectedDomain && domainLoading && (
        <AdminCard>
          <div className="flex items-center justify-center gap-2 py-4">
            <InlineSpinner size={16} className="text-accent" />
            <span className="text-xs text-foreground/50">Lade {selectedDomain}-Entities...</span>
          </div>
        </AdminCard>
      )}
      {selectedDomain && !domainLoading && entities.length > 0 && (
        <AdminCard title={`${selectedDomain} (${entities.length})`} icon={ListBullets}>
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {entities.map((e, i) => {
              const eid = String(e.entity_id ?? '')
              const isExpanded = expandedEntity === eid
              return (
                <div key={i} className="rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                  <div className="flex items-center justify-between py-1.5 px-2 cursor-pointer" onClick={() => setExpandedEntity(isExpanded ? null : eid)}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs font-mono text-foreground/80 truncate">{eid}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                        String(e.state) === 'on' || String(e.state) === 'home' ? 'bg-green-500/15 text-green-400' :
                        String(e.state) === 'off' || String(e.state) === 'not_home' ? 'bg-foreground/10 text-foreground/40' :
                        String(e.state) === 'unavailable' ? 'bg-red-500/15 text-red-400' :
                        'bg-blue-500/15 text-blue-400'
                      }`}>{String(e.state ?? '–')}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={ev => { ev.stopPropagation(); loadHistory(eid) }}
                        className="text-foreground/30 hover:text-accent transition-colors p-0.5"><ChartLine size={14} /></button>
                      {isExpanded ? <CaretUp size={12} className="text-foreground/30" /> : <CaretDown size={12} className="text-foreground/30" />}
                    </div>
                  </div>
                  {isExpanded && e.attributes ? (
                    <div className="px-3 pb-2 border-t border-foreground/5">
                      <div className="mt-1.5 space-y-0.5">
                        {Object.entries(e.attributes as Record<string, unknown>).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-[10px] py-0.5">
                            <span className="text-foreground/50">{k}</span>
                            <span className="text-foreground/70 font-mono truncate ml-2 max-w-[200px]">{JSON.stringify(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* History */}
      {historyEntity && (
        <AdminCard title={`Verlauf: ${historyEntity}`} icon={ChartLine}>
          {historyLoading ? <LoadingSpinner /> : history.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine Verlaufsdaten verfügbar.</p>
          ) : (
            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {history.slice(0, 50).map((h, i) => (
                <div key={i} className="flex items-center gap-3 py-1 px-2 rounded bg-foreground/3 text-[10px]">
                  <span className="text-foreground/40 font-mono shrink-0">{String(h.timestamp ?? h.last_changed ?? '').slice(0, 19)}</span>
                  <span className="font-semibold text-foreground/70">{String(h.state ?? '–')}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}
    </div>
  )
}

// ── Scheduler Tab ──────────────────────────────────────────────────

function SchedulerTab({ token }: { token: string }) {
  const [schedules, setSchedules] = useState<Record<string, unknown>[]>([])
  const [watchdogs, setWatchdogs] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<'schedules' | 'watchdogs'>('schedules')
  const [showCreateSchedule, setShowCreateSchedule] = useState(false)
  const [showCreateWatchdog, setShowCreateWatchdog] = useState(false)
  const [newSchedule, setNewSchedule] = useState({ entity_id: '', action: 'turn_on', cron: '', name: '' })
  const [newWatchdog, setNewWatchdog] = useState({ entity_id: '', expected_state: 'on', timeout_minutes: 30, action: 'notify', name: '' })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [s, w] = await Promise.all([
        adminFetch('/api/integration/schedules', token).catch(() => []),
        adminFetch('/api/integration/watchdogs', token).catch(() => [])
      ])
      setSchedules(Array.isArray(s) ? s : [])
      setWatchdogs(Array.isArray(w) ? w : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const createSchedule = async () => {
    setActionLoading('create-schedule')
    try {
      await adminFetch('/api/integration/schedules', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSchedule)
      })
      setShowCreateSchedule(false)
      setNewSchedule({ entity_id: '', action: 'turn_on', cron: '', name: '' })
      load()
    } catch {}
    finally { setActionLoading(null) }
  }

  const deleteSchedule = async (id: string) => {
    setActionLoading(`del-s-${id}`)
    try {
      await adminFetch(`/api/integration/schedules/${id}`, token, { method: 'DELETE' })
      load()
    } catch {}
    finally { setActionLoading(null) }
  }

  const createWatchdog = async () => {
    setActionLoading('create-watchdog')
    try {
      await adminFetch('/api/integration/watchdogs', token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWatchdog)
      })
      setShowCreateWatchdog(false)
      setNewWatchdog({ entity_id: '', expected_state: 'on', timeout_minutes: 30, action: 'notify', name: '' })
      load()
    } catch {}
    finally { setActionLoading(null) }
  }

  const deleteWatchdog = async (id: string) => {
    setActionLoading(`del-w-${id}`)
    try {
      await adminFetch(`/api/integration/watchdogs/${id}`, token, { method: 'DELETE' })
      load()
    } catch {}
    finally { setActionLoading(null) }
  }

  const checkWatchdogs = async () => {
    setActionLoading('check-watchdogs')
    try {
      await adminFetch('/api/integration/watchdogs/check', token, { method: 'POST' })
    } catch {}
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Section Toggle */}
      <div className="flex gap-2">
        {(['schedules', 'watchdogs'] as const).map(s => (
          <button key={s} onClick={() => setActiveSection(s)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeSection === s ? 'bg-accent text-white shadow-md shadow-accent/25' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/8'
            }`}>
            {s === 'schedules' ? <><Timer size={14} /> Zeitpläne ({schedules.length})</> : <><Dog size={14} /> Watchdogs ({watchdogs.length})</>}
          </button>
        ))}
      </div>

      {activeSection === 'schedules' && (
        <>
          <AdminCard>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">Zeitpläne</h4>
              <button onClick={() => setShowCreateSchedule(!showCreateSchedule)}
                className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-lg text-[10px] font-semibold hover:bg-accent/85 transition-colors">
                <Plus size={12} /> Neuer Zeitplan
              </button>
            </div>

            {showCreateSchedule && (
              <div className="space-y-2 p-3 rounded-lg bg-foreground/5 border border-foreground/10 mb-3">
                <input value={newSchedule.name} onChange={e => setNewSchedule(s => ({...s, name: e.target.value}))}
                  placeholder="Name (optional)" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                <input value={newSchedule.entity_id} onChange={e => setNewSchedule(s => ({...s, entity_id: e.target.value}))}
                  placeholder="Entity ID (z.B. light.wohnzimmer)" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={newSchedule.action} onChange={e => setNewSchedule(s => ({...s, action: e.target.value}))}
                    className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground">
                    <option value="turn_on">Einschalten</option>
                    <option value="turn_off">Ausschalten</option>
                    <option value="toggle">Umschalten</option>
                  </select>
                  <input value={newSchedule.cron} onChange={e => setNewSchedule(s => ({...s, cron: e.target.value}))}
                    placeholder="Cron (z.B. 0 8 * * *)" className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateSchedule(false)} className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">Abbrechen</button>
                  <button onClick={createSchedule} disabled={!newSchedule.entity_id || !newSchedule.cron || actionLoading === 'create-schedule'}
                    className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    {actionLoading === 'create-schedule' && <InlineSpinner size={12} />}
                    Erstellen</button>
                </div>
              </div>
            )}

            {schedules.length === 0 ? (
              <p className="text-xs text-foreground/50 text-center py-4">Keine Zeitpläne konfiguriert.</p>
            ) : (
              <div className="space-y-1.5">
                {schedules.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground">{String(s.name || s.entity_id || '–')}</div>
                      <div className="text-[10px] text-foreground/50 font-mono mt-0.5">
                        {String(s.entity_id ?? '')} → {String(s.action ?? '')} | <span className="text-accent/70">{String(s.cron ?? '')}</span>
                      </div>
                    </div>
                    <button onClick={() => deleteSchedule(String(s.id ?? i))}
                      disabled={actionLoading === `del-s-${String(s.id ?? i)}`}
                      className="text-foreground/30 hover:text-red-400 transition-colors p-1 disabled:opacity-40">
                      {actionLoading === `del-s-${String(s.id ?? i)}` ? <InlineSpinner size={14} /> : <Trash size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          {/* Cron help */}
          <AdminCard title="Cron-Syntax" icon={Clock}>
            <div className="text-[10px] text-foreground/50 space-y-1 font-mono">
              <p>┌─── Minute (0-59)</p>
              <p>│ ┌─── Stunde (0-23)</p>
              <p>│ │ ┌─── Tag (1-31)</p>
              <p>│ │ │ ┌─── Monat (1-12)</p>
              <p>│ │ │ │ ┌─── Wochentag (0-7, So=0|7)</p>
              <p>* * * * *</p>
              <div className="mt-2 text-foreground/40 space-y-0.5 font-sans">
                <p><code className="bg-foreground/10 px-1 rounded">0 8 * * *</code> — Täglich um 08:00</p>
                <p><code className="bg-foreground/10 px-1 rounded">*/15 * * * *</code> — Alle 15 Minuten</p>
                <p><code className="bg-foreground/10 px-1 rounded">0 22 * * 1-5</code> — Mo-Fr um 22:00</p>
              </div>
            </div>
          </AdminCard>
        </>
      )}

      {activeSection === 'watchdogs' && (
        <>
          <AdminCard>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">Watchdogs</h4>
              <div className="flex gap-2">
                <button onClick={checkWatchdogs}
                  disabled={actionLoading === 'check-watchdogs'}
                  className="flex items-center gap-1 px-3 py-1.5 bg-foreground/5 text-foreground/60 rounded-lg text-[10px] font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
                  {actionLoading === 'check-watchdogs' ? <InlineSpinner size={12} /> : <Heartbeat size={12} />} Jetzt prüfen
                </button>
                <button onClick={() => setShowCreateWatchdog(!showCreateWatchdog)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white rounded-lg text-[10px] font-semibold hover:bg-accent/85 transition-colors">
                  <Plus size={12} /> Neuer Watchdog
                </button>
              </div>
            </div>

            {showCreateWatchdog && (
              <div className="space-y-2 p-3 rounded-lg bg-foreground/5 border border-foreground/10 mb-3">
                <input value={newWatchdog.name} onChange={e => setNewWatchdog(w => ({...w, name: e.target.value}))}
                  placeholder="Name (optional)" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                <input value={newWatchdog.entity_id} onChange={e => setNewWatchdog(w => ({...w, entity_id: e.target.value}))}
                  placeholder="Entity ID" className="w-full bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground font-mono" />
                <div className="grid grid-cols-3 gap-2">
                  <input value={newWatchdog.expected_state} onChange={e => setNewWatchdog(w => ({...w, expected_state: e.target.value}))}
                    placeholder="Erwarteter Zustand" className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                  <input type="number" value={newWatchdog.timeout_minutes} onChange={e => setNewWatchdog(w => ({...w, timeout_minutes: parseInt(e.target.value) || 30}))}
                    placeholder="Timeout (Min)" className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
                  <select value={newWatchdog.action} onChange={e => setNewWatchdog(w => ({...w, action: e.target.value}))}
                    className="bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground">
                    <option value="notify">Benachrichtigen</option>
                    <option value="restart">Neustarten</option>
                    <option value="turn_on">Einschalten</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateWatchdog(false)} className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">Abbrechen</button>
                  <button onClick={createWatchdog} disabled={!newWatchdog.entity_id || actionLoading === 'create-watchdog'}
                    className="px-4 py-1.5 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                    {actionLoading === 'create-watchdog' && <InlineSpinner size={12} />}
                    Erstellen</button>
                </div>
              </div>
            )}

            {watchdogs.length === 0 ? (
              <p className="text-xs text-foreground/50 text-center py-4">Keine Watchdogs konfiguriert.</p>
            ) : (
              <div className="space-y-1.5">
                {watchdogs.map((w, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground">{String(w.name || w.entity_id || '–')}</div>
                      <div className="text-[10px] text-foreground/50 mt-0.5">
                        <span className="font-mono">{String(w.entity_id ?? '')}</span> erwartet <span className="text-accent font-semibold">{String(w.expected_state ?? '')}</span>
                        {' '}— Timeout: {String(w.timeout_minutes ?? 30)} Min — Aktion: {String(w.action ?? 'notify')}
                      </div>
                    </div>
                    <button onClick={() => deleteWatchdog(String(w.id ?? i))}
                      disabled={actionLoading === `del-w-${String(w.id ?? i)}`}
                      className="text-foreground/30 hover:text-red-400 transition-colors p-1 disabled:opacity-40">
                      {actionLoading === `del-w-${String(w.id ?? i)}` ? <InlineSpinner size={14} /> : <Trash size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          {/* Watchdog Info */}
          <AdminCard title="Watchdog-Info" icon={Dog}>
            <div className="text-xs text-foreground/50 space-y-1">
              <p>Watchdogs überwachen Entities und lösen Aktionen aus, wenn ein erwarteter Zustand nach dem Timeout nicht eintritt.</p>
              <p><strong className="text-foreground/70">Beispiel:</strong> Überwache ob <code className="bg-foreground/10 px-1 rounded">sensor.heizung</code> den Zustand <code className="bg-foreground/10 px-1 rounded">on</code> hat. Falls nach 30 Minuten nicht → Benachrichtigung.</p>
            </div>
          </AdminCard>
        </>
      )}
    </div>
  )
}

// ── Analytics Tab ──────────────────────────────────────────────────

function AnalyticsTab({ token }: { token: string }) {
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null)
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [topEntities, setTopEntities] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [d, h, t] = await Promise.all([
        adminFetch('/api/stats/dashboard', token).catch(() => null),
        adminFetch('/api/integration/health', token).catch(() => null),
        adminFetch('/api/integration/analytics/top', token).catch(() => [])
      ])
      setDashboard(d as Record<string, unknown> | null)
      setHealth(h as Record<string, unknown> | null)
      setTopEntities(Array.isArray(t) ? t : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Dashboard Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(dashboard).filter(([, v]) => typeof v === 'number' || typeof v === 'string').slice(0, 8).map(([key, val]) => (
            <div key={key} className="glass-card rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-accent">{String(val)}</div>
              <div className="text-[10px] text-foreground/50 mt-0.5">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
            </div>
          ))}
        </div>
      )}

      {/* Health Report */}
      {health && (
        <AdminCard title="System-Gesundheit" icon={Heartbeat}>
          <div className="space-y-2">
            {Object.entries(health).map(([component, status]) => {
              const isOk = typeof status === 'string' ? status === 'ok' || status === 'healthy' || status === 'connected' : 
                typeof status === 'object' && status !== null ? (status as Record<string, unknown>).status === 'ok' || (status as Record<string, unknown>).healthy === true : false
              return (
                <div key={component} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3">
                  <span className="text-xs text-foreground/80">{component.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                  <div className="flex items-center gap-1.5">
                    {isOk ? <CheckCircle size={14} className="text-green-400" weight="fill" /> : <XCircle size={14} className="text-red-400" weight="fill" />}
                    <span className={`text-[10px] font-semibold ${isOk ? 'text-green-400' : 'text-red-400'}`}>
                      {typeof status === 'string' ? status : isOk ? 'OK' : 'Problem'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* Top Entities */}
      {topEntities.length > 0 && (
        <AdminCard title="Meistgenutzte Entities" icon={TrendUp}>
          <div className="space-y-1">
            {topEntities.slice(0, 15).map((e, i) => {
              const count = Number(e.count ?? e.access_count ?? e.event_count ?? 0)
              const maxCount = Number(topEntities[0]?.count ?? topEntities[0]?.access_count ?? topEntities[0]?.event_count ?? 1)
              return (
                <div key={i} className="relative py-1.5 px-2 rounded-lg overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-accent/8 rounded-lg" style={{ width: `${Math.max(5, (count / maxCount) * 100)}%` }} />
                  <div className="relative flex items-center justify-between">
                    <span className="text-xs font-mono text-foreground/70">{String(e.entity_id ?? e.name ?? '')}</span>
                    <span className="text-[10px] font-semibold text-accent">{count}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Logbook Tab ──────────────────────────────────────────────────

function LogbookTab({ token }: { token: string }) {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await adminFetch('/api/admin/ha/logbook', token) as Record<string, unknown>[]
      setEntries(Array.isArray(data) ? data : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const filtered = entityFilter
    ? entries.filter(e => String(e.entity_id ?? '').includes(entityFilter) || String(e.name ?? '').toLowerCase().includes(entityFilter.toLowerCase()))
    : entries

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Filter */}
      <AdminCard>
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={14} className="text-foreground/40" />
          <input value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            placeholder="Entity oder Name filtern..."
            className="flex-1 bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-accent/30 text-foreground" />
          <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
            className="text-foreground/40 hover:text-accent transition-colors p-1 disabled:opacity-40">
            {refreshing ? <InlineSpinner size={16} /> : <ArrowClockwise size={16} />}
          </button>
          <span className="text-[10px] text-foreground/40">{filtered.length} Einträge</span>
        </div>
      </AdminCard>

      {/* Entries */}
      <AdminCard title="Logbuch-Einträge" icon={BookOpen}>
        {filtered.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Logbuch-Einträge gefunden.</p>
        ) : (
          <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
            {filtered.slice(0, 200).map((entry, i) => {
              const timestamp = String(entry.when ?? entry.last_changed ?? entry.timestamp ?? '').slice(0, 19)
              const entityId = String(entry.entity_id ?? '')
              const name = String(entry.name ?? entityId.split('.').pop() ?? '')
              const message = String(entry.message ?? entry.state ?? '')
              const domain = entityId.split('.')[0] || 'unknown'
              const isExpanded = expandedEntry === i

              return (
                <div key={i} className="rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors cursor-pointer"
                  onClick={() => setExpandedEntry(isExpanded ? null : i)}>
                  <div className="flex items-center gap-2 py-1.5 px-2">
                    <span className="text-[10px] text-foreground/40 font-mono shrink-0 w-32">{timestamp}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                      domain === 'light' ? 'bg-yellow-500/15 text-yellow-400' :
                      domain === 'switch' ? 'bg-blue-500/15 text-blue-400' :
                      domain === 'sensor' ? 'bg-green-500/15 text-green-400' :
                      domain === 'automation' ? 'bg-purple-500/15 text-purple-400' :
                      domain === 'climate' ? 'bg-orange-500/15 text-orange-400' :
                      'bg-foreground/10 text-foreground/50'
                    }`}>{domain}</span>
                    <span className="text-xs text-foreground/80 font-semibold truncate">{name}</span>
                    <span className="text-xs text-foreground/50 truncate flex-1">{message}</span>
                    {isExpanded ? <CaretUp size={12} className="text-foreground/30 shrink-0" /> : <CaretDown size={12} className="text-foreground/30 shrink-0" />}
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-2 border-t border-foreground/5">
                      <div className="mt-1.5 space-y-0.5 text-[10px]">
                        <div className="flex justify-between"><span className="text-foreground/50">Entity ID</span><span className="text-foreground/70 font-mono">{entityId}</span></div>
                        {entry.context_user_id ? <div className="flex justify-between"><span className="text-foreground/50">Benutzer</span><span className="text-foreground/70">{String(entry.context_user_id)}</span></div> : null}
                        {entry.source ? <div className="flex justify-between"><span className="text-foreground/50">Quelle</span><span className="text-foreground/70">{String(entry.source)}</span></div> : null}
                        {entry.context_event_type ? <div className="flex justify-between"><span className="text-foreground/50">Event-Typ</span><span className="text-foreground/70">{String(entry.context_event_type)}</span></div> : null}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* Info */}
      <AdminCard>
        <div className="text-xs text-foreground/50 text-center">
          <p>Das Logbuch zeigt den chronologischen Verlauf aller Zustandsänderungen und Aktionen aus Home Assistant.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ── Calendars Tab ──────────────────────────────────────────────────

function CalendarsTab({ token }: { token: string }) {
  const [calendars, setCalendars] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCalendar, setSelectedCalendar] = useState('')
  const [events, setEvents] = useState<Record<string, unknown>[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await adminFetch('/api/admin/ha/calendars', token) as Record<string, unknown>[]
      setCalendars(Array.isArray(data) ? data : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const loadEvents = async (entityId: string) => {
    if (selectedCalendar === entityId) { setSelectedCalendar(''); setEvents([]); return }
    setSelectedCalendar(entityId)
    setEventsLoading(true)
    try {
      const data = await adminFetch(`/api/admin/ha/calendars/${encodeURIComponent(entityId)}/events`, token) as Record<string, unknown>[]
      setEvents(Array.isArray(data) ? data : [])
    } catch { setEvents([]) }
    finally { setEventsLoading(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Calendar List */}
      <AdminCard title={`Kalender (${calendars.length})`} icon={CalendarBlank}>
        {calendars.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Kalender-Entitäten in Home Assistant gefunden.</p>
        ) : (
          <div className="space-y-1">
            {calendars.map((cal, i) => {
              const entityId = String(cal.entity_id ?? '')
              const attrs = (cal.attributes ?? {}) as Record<string, unknown>
              const name = String(cal.name ?? attrs.friendly_name ?? entityId)
              const state = String(cal.state ?? '')
              const isSelected = selectedCalendar === entityId

              return (
                <button key={i} onClick={() => loadEvents(entityId)}
                  className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-all ${
                    isSelected ? 'bg-accent/15 border border-accent/30' : 'bg-foreground/3 hover:bg-foreground/5 border border-transparent'
                  }`}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <CalendarBlank size={16} className={isSelected ? 'text-accent' : 'text-foreground/40'} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{name}</div>
                      <div className="text-[10px] text-foreground/40 font-mono truncate">{entityId}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                    state === 'on' ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'
                  }`}>{state || '–'}</span>
                </button>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* Calendar Events */}
      {selectedCalendar && (
        <AdminCard title={`Termine — ${selectedCalendar}`} icon={Clock}>
          {eventsLoading ? <LoadingSpinner /> : events.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine anstehenden Termine.</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {events.map((ev, i) => {
                const summary = String(ev.summary ?? ev.title ?? '–')
                const startVal = ev.start
                const endVal = ev.end
                const start = String(typeof startVal === 'object' && startVal !== null ? (startVal as Record<string, unknown>).dateTime ?? startVal : startVal ?? '').slice(0, 16)
                const end = String(typeof endVal === 'object' && endVal !== null ? (endVal as Record<string, unknown>).dateTime ?? endVal : endVal ?? '').slice(0, 16)
                const location = String(ev.location ?? '')
                const description = String(ev.description ?? '')

                return (
                  <div key={i} className="py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground">{summary}</div>
                        <div className="text-[10px] text-foreground/50 mt-0.5 flex items-center gap-2">
                          <span className="font-mono">{start}</span>
                          {end && <><span className="text-foreground/30">→</span> <span className="font-mono">{end}</span></>}
                        </div>
                        {location && <div className="text-[10px] text-foreground/40 mt-0.5">📍 {location}</div>}
                        {description && <div className="text-[10px] text-foreground/40 mt-0.5 truncate max-w-md">{description}</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </AdminCard>
      )}

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}
