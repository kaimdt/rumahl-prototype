import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Cube, Lightning, Plus, Play, Pause, TrashSimple, ShieldCheck,
  DownloadSimple, Upload, MagnifyingGlass, Gear, Check, X,
  ShieldWarning, Package, ArrowClockwise, Info, Warning,
  Stack, CubeFocus, Sparkle, PuzzlePiece, MusicNotes, ChartBar,
  VideoCamera, Broom, Lightbulb, CalendarBlank, SpeakerHigh, Plant,
  Bell, Star, ArrowRight, CaretLeft, CaretRight
} from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { toast } from 'sonner'
import { AppDetailDialog } from './AppDetailDialog'
import { loadTranslationBundlesFromAssets } from '@/i18n/external'
import { STORE_CATALOG } from '@/lib/storeCatalog'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { supportedLngs } from '@/i18n'

// ── Types ──────────────────────────────────────────────────────────────────

/** Store-listed app: a real backend app, a preinstalled IORA Essential or a
 * catalog app that can be installed as a Docker container. */
interface StoreApp extends AppInfo {
  isEssential?: boolean
  /** Launcher pageId for preinstalled Essentials. */
  pageId?: string
  /** Catalog (Docker) app — installable via the ZIP install API. */
  isCatalog?: boolean
  /** Host port of the web UI (catalog apps). */
  openPort?: number
  /** Inline SVG icon (data URL) for catalog/essential apps. */
  iconUrl?: string
}

interface AppInfo {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  trust_level: 'trusted' | 'untrusted' | 'verified'
  enabled: boolean
  autostart?: boolean
  status?: string
  last_started_at?: string
  last_stopped_at?: string
  installed_at: string
  ports?: PortInfo[] | Array<string | PortInfo>
  kind?: 'app' | 'plugin' | 'system'
  system?: boolean
  source?: string
  error_message?: string
  restart_count?: number
  docker?: {
    container_id?: string
    image?: string
    state?: string
    cpu_percent?: number
    memory_mb?: number
    uptime?: string
  }
  open_url?: string
  custom_pages?: CustomPage[]
  is_bundle?: boolean
  docker_config?: any
  bundle_config?: any
  services?: any[]
  permission_grants?: Array<{ permission: string; risk_level?: string; is_active?: boolean }>
  denied_permissions?: string[]
  /**
   * Optional i18n configuration for the app.
   * Convention: translation files are served at `<assets_base_url>/i18n/<lng>.json`
   * (e.g. `/api/apps/<id>/assets/i18n/en.json`). The system loads these bundles
   * into a namespace scoped to the app (e.g. `app-<id>`) so translations can be
   * accessed via `t('app-<id>:key.path')` in the frontend.
   */
  i18n?: {
    /** Base URL from which i18n bundles are served */
    assets_base_url: string
  }
}

interface PortInfo {
  internal: number
  external: number
  protocol: string
}

/** Backend sends ports as "external:internal/protocol" strings — parse both shapes. */
function firstExternalPort(ports: PortInfo[] | Array<string | PortInfo> | undefined): number | undefined {
  const entry = ports?.[0]
  if (typeof entry === 'string') {
    const m = entry.match(/^(\d+):/)
    return m ? Number(m[1]) : undefined
  }
  if (entry && 'external' in entry) return Number(entry.external)
  return undefined
}

interface CustomPage {
  id: string
  title: string
  icon: string
  url: string
  show_in_nav?: boolean
  order?: number
  iframe?: boolean
}

interface AppIntegrationInfo {
  id: string
  surfaces?: string[]
  integrations?: unknown[]
  granted_permissions?: string[]
}

interface AppManifest {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  type: 'app' | 'plugin'
  permissions: string[]
  docker?: {
    auto_build: boolean
    image?: string
    base_image?: string
    working_dir?: string
    install_cmd?: string
    start_cmd?: string
    internal_ports: { port: number; protocol: string; description?: string }[]
    environment?: Record<string, string>
    volumes?: string[]
  }
}

// ── Enhanced App Store Tab ──────────────────────────────────────────────────

export function AppStoreTab({ token }: { token: string }) {
  const [view, setView] = useState<'installed' | 'store' | 'upload'>('store')
  const [apps, setApps] = useState<AppInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [integrations, setIntegrations] = useState<AppIntegrationInfo[]>([])
  // App detail dialog
  const [detailAppId, setDetailAppId] = useState<string | null>(null)
  // On OS-dev images the Developer App may replace/delete *any* app,
  // including system apps. We probe the dev-image marker once on mount.
  const [isOsDev, setIsOsDev] = useState(false)
  const [devMode, setDevMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [info, devInfo] = await Promise.all([
          adminFetch('/api/admin/dev-image', token).catch(() => null),
          adminFetch('/api/admin/settings/developer.mode', token).catch(() => null),
        ])
        if (!cancelled) {
          const osDev = Boolean((info as any)?.is_os_dev)
          setIsOsDev(osDev)
          // Dev mode from global config – also check localStorage as fallback
          const fromApi = (devInfo as any)?.value === true
          const fromLocal = localStorage.getItem('iora-developer-mode') === 'true'
          setDevMode(osDev || fromApi || fromLocal)
        }
      } catch {
        /* not on a dev image — leave isOsDev=false */
        if (!cancelled) setDevMode(localStorage.getItem('iora-developer-mode') === 'true')
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const loadInstalled = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Try supervisor endpoint first (has status, custom_pages, etc.).
      // The local appstore is still the source of truth for ZIP-installed apps,
      // so merge both lists instead of treating local apps as a fallback only.
      let data: { apps: AppInfo[] }
      try {
        data = await adminFetch('/api/supervisor/apps', token) as { apps: AppInfo[] }
      } catch {
        // Fall back to local appstore
        data = await adminFetch('/api/appstore/installed', token) as { apps: AppInfo[] }
      }
      // Also fetch from appstore to get trust_level and source info
      try {
        const localData = await adminFetch('/api/appstore/installed', token) as { apps: AppInfo[] }
        if (localData.apps && localData.apps.length > 0) {
          // Merge local server-side apps into the supervisor list and keep
          // supervisor runtime status when both sides know the same app.
          const localMap = new Map(localData.apps.map(a => [a.id, a]))
          const merged = (data.apps || []).map(app => {
            const local = localMap.get(app.id)
            if (local) {
              localMap.delete(app.id)
              return { ...local, ...app, trust_level: local.trust_level || app.trust_level || 'untrusted' }
            }
            return app
          })
          data.apps = [...merged, ...localMap.values()]
        }
      } catch { /* ignore */ }
      let appList = data.apps || []

      // Ensure the IORA Developer App appears when developer mode is active,
      // even if the backend hasn't registered it properly (frontend fallback).
      if (devMode && !appList.some(a => a.id === 'iora-developer-app')) {
        appList = [...appList, {
          id: 'iora-developer-app',
          name: 'IORA Developer App',
          version: 'dev',
          developer: 'IORA Project',
          description: 'Stellt Plugin- und App-Entwicklern erweiterte APIs, einen Hot-Reload-Bridge und Debugging-Tools bereit.',
          icon: undefined,
          trust_level: 'trusted' as const,
          enabled: true,
          status: 'running',
          installed_at: new Date().toISOString(),
          source: 'system',
          kind: 'system' as const,
          system: true,
          ports: [{ internal: 8177, external: 8177, protocol: 'tcp' }],
        }]
      }

      try {
        const integrationData = await adminFetch('/api/apps/integrations', token) as { integrations?: AppIntegrationInfo[] }
        setIntegrations(integrationData.integrations || [])
      } catch {
        setIntegrations([])
      }

      setApps(appList)

      // Load i18n bundles for any apps that provide translations
      for (const app of appList) {
        if (app.i18n?.assets_base_url) {
          const namespace = `app-${app.id}`
          loadTranslationBundlesFromAssets({
            assetsBaseUrl: app.i18n.assets_base_url,
            namespace,
            languages: supportedLngs,
          }).then((result) => {
            if (result.loaded.length > 0) {
              console.log(`Loaded i18n bundles for app ${app.id}:`, result.loaded)
            }
            if (result.failed.length > 0) {
              console.warn(`Failed to load i18n for app ${app.id}:`, result.failed)
            }
          })
        }
      }
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token, devMode])

  // Load the app catalog for both the store and the installed view.
  useEffect(() => {
    if (view !== 'upload') {
      loadInstalled()
    }
  }, [view, loadInstalled])

  const getTrustBadge = (level: string) => {
    switch (level) {
      case 'trusted':
        return <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-green-500/15 text-green-400 flex items-center gap-1">
          <ShieldCheck size={12} weight="fill" /> Vertrauenswürdig
        </span>
      case 'verified':
        return <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-500/15 text-blue-400 flex items-center gap-1">
          <Check size={12} weight="bold" /> Verifiziert
        </span>
      default:
        return <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-orange-500/15 text-orange-400 flex items-center gap-1">
          <ShieldWarning size={12} weight="fill" /> Nicht vertrauenswürdig
        </span>
    }
  }

  // Listen for custom 'open-app-detail' events from iframes
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail?.appId) {
        setDetailAppId(e.detail.appId)
        setView('installed')
      }
    }
    window.addEventListener('open-app-detail', handler as EventListener)
    return () => window.removeEventListener('open-app-detail', handler as EventListener)
  }, [])

  return (
    <div className="space-y-3">
      {/* View Switcher – Play Store style tabs */}
      <div className="flex gap-1 p-1 glass-card rounded-2xl">
        <button
          onClick={() => setView('installed')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
            view === 'installed'
              ? 'bg-accent text-white shadow-lg shadow-accent/25'
              : 'text-foreground/50 hover:text-foreground hover:bg-foreground/[0.04]'
          }`}
        >
          <Package size={14} /> Installierte Apps
        </button>
        <button
          onClick={() => setView('store')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
            view === 'store'
              ? 'bg-accent text-white shadow-sm'
              : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
          }`}
        >
          <Cube size={14} /> App Store
        </button>
        <button
          onClick={() => setView('upload')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
            view === 'upload'
              ? 'bg-accent text-white shadow-sm'
              : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
          }`}
        >
          <Upload size={14} /> ZIP hochladen
        </button>
      </div>

      {/* Installed Apps View */}
      {view === 'installed' && (
        <>
          <InstallProgressList token={token} onJobComplete={loadInstalled} />
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage>{error}</ErrorMessage>
          ) : (
            <InstalledAppsView apps={apps} integrations={integrations} token={token} onReload={loadInstalled} getTrustBadge={getTrustBadge} isOsDev={isOsDev} onAppClick={setDetailAppId} />
          )}
        </>
      )}

      {/* App Store View */}
      {view === 'store' && (
        <AppStoreView
          token={token}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          apps={apps}
          onAppClick={(appId) => setDetailAppId(appId)}
          onInstalled={loadInstalled}
        />
      )}

      {/* Upload View */}
      {view === 'upload' && (
        <ZipUploadView token={token} onSuccess={() => { setView('installed'); loadInstalled() }} />
      )}

      {/* App Detail Dialog */}
      <AppDetailDialog
        appId={detailAppId}
        token={token}
        onClose={() => setDetailAppId(null)}
        onReload={loadInstalled}
      />
    </div>
  )
}

// ── Installed Apps View ───────────────────────────────────────────────────

function InstalledAppsView({
  apps,
  integrations,
  token,
  onReload,
  getTrustBadge,
  isOsDev,
  onAppClick,
}: {
  apps: AppInfo[]
  integrations: AppIntegrationInfo[]
  token: string
  onReload: () => void
  getTrustBadge: (level: string) => React.ReactNode
  isOsDev: boolean
  onAppClick: (appId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language?.startsWith('de') ? 'de-DE' : 'en-US'
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'app' | 'plugin' | 'system'>('all')
  const [installedSearch, setInstalledSearch] = useState('')
  const integrationsByApp = new Map(integrations.map(integration => [integration.id, integration]))
  const filteredApps = apps.filter(app => {
    const matchesKind = kindFilter === 'all' || (app.kind || 'app') === kindFilter
    const query = installedSearch.trim().toLowerCase()
    const matchesSearch = !query || [app.name, app.id, app.developer, app.description, app.kind]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(query))
    return matchesKind && matchesSearch
  })
  const runningCount = apps.filter(app => app.status === 'running').length
  const pluginCount = apps.filter(app => app.kind === 'plugin').length
  const integrationCount = integrations.length

  const startApp = async (appId: string) => {
    setActionLoading(`start-${appId}`)
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/start`, token, { method: 'POST' })
      toast.success('App gestartet')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const stopApp = async (appId: string) => {
    setActionLoading(`stop-${appId}`)
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/stop`, token, { method: 'POST' })
      toast.success('App gestoppt')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const pauseApp = async (appId: string) => {
    setActionLoading(`pause-${appId}`)
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/pause`, token, { method: 'POST' })
      toast.success('App pausiert')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const enableApp = async (appId: string) => {
    setActionLoading(`enable-${appId}`)
    try {
      await adminFetch(`/api/appstore/apps/${appId}/enable`, token, { method: 'POST' })
      toast.success('App aktiviert')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const disableApp = async (appId: string) => {
    setActionLoading(`disable-${appId}`)
    try {
      await adminFetch(`/api/appstore/apps/${appId}/disable`, token, { method: 'POST' })
      toast.success('App deaktiviert')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const uninstallApp = async (appId: string, force = false) => {
    const isSystemApp = apps.find(a => a.id === appId)?.system
    const prompt = force && isSystemApp
      ? `System-App "${appId}" auf einem OS-DEV-Image deinstallieren? Das kann das System-Verhalten ändern.`
      : 'App wirklich deinstallieren? Alle Daten gehen verloren.'
    if (!confirm(prompt)) return
    setActionLoading(appId)
    try {
      const url = force
        ? `/api/appstore/apps/${appId}?force=true`
        : `/api/appstore/apps/${appId}`
      await adminFetch(url, token, { method: 'DELETE' })
      toast.success('App deinstalliert')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const openApp = (appId: string, openUrl?: string) => {
    const app = apps.find((candidate) => candidate.id === appId)
    const port = firstExternalPort(app?.ports) ?? STORE_CATALOG.find((def) => def.id === appId)?.openPort
    if (openUrl) {
      window.location.href = openUrl
    } else if (port) {
      // Docker app with a web UI — open the host port directly.
      window.open(`http://127.0.0.1:${port}`, '_blank')
    } else {
      // App-defined page (custom_pages) — navigate inside the SPA.
      window.location.href = `/apps/${appId}`
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="glass-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('apps.overview.installed')}</div>
          <div className="text-lg font-semibold text-foreground">{apps.length}</div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('apps.overview.running')}</div>
          <div className="text-lg font-semibold text-green-400">{runningCount}</div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('navigation.plugins')}</div>
          <div className="text-lg font-semibold text-accent">{pluginCount}</div>
        </div>
        <div className="glass-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('apps.overview.integrations')}</div>
          <div className="text-lg font-semibold text-cyan-300">{integrationCount}</div>
        </div>
      </div>

      <div className="glass-card rounded-xl p-2 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/35" />
          <input
            value={installedSearch}
            onChange={(event) => setInstalledSearch(event.target.value)}
            placeholder={t('apps.overview.searchInstalled')}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-xs text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'app', 'plugin', 'system'] as const).map(kind => (
            <button
              key={kind}
              onClick={() => setKindFilter(kind)}
              className={`px-3 py-2 rounded-lg text-[10px] font-semibold transition-colors ${kindFilter === kind ? 'bg-accent text-white' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}
            >
              {kind === 'all' ? t('common.all') : kind === 'app' ? t('navigation.apps') : kind === 'plugin' ? t('navigation.plugins') : t('admin.system')}
            </button>
          ))}
        </div>
      </div>

      {apps.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-foreground/[0.04] flex items-center justify-center mx-auto mb-4">
            <Package size={36} className="text-foreground/20" weight="thin" />
          </div>
          <p className="text-sm font-medium text-foreground/40 mb-1">Keine Apps installiert</p>
          <p className="text-[11px] text-foreground/25">Apps aus dem Store oder per ZIP installieren</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filteredApps.map((app) => (
            (() => {
              const integration = integrationsByApp.get(app.id)
              const surfaces = integration?.surfaces || []
              return (
            <div
              key={app.id}
              className="glass-card rounded-2xl p-4 hover:border-accent/20 transition-all cursor-pointer"
              onClick={() => onAppClick(app.id)}
            >
              <div className="flex items-start gap-3 mb-3">
                {app.icon ? (
                  <img src={app.icon} alt={app.name} className="w-10 h-10 rounded-lg flex-shrink-0 object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                    <Cube size={20} className="text-accent" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate flex items-center gap-2">
                        {app.name}
                        {app.status === 'running' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-foreground/40">{app.version} • {app.developer}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {app.is_bundle && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-purple-500/15 text-purple-400 flex items-center gap-1">
                          <Stack size={10} weight="fill" /> Bundle
                        </span>
                      )}
                      {getTrustBadge(app.trust_level)}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        app.enabled ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'
                      }`}>
                        {app.enabled ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[10px] text-foreground/50 line-clamp-2">{app.description}</p>
                </div>
              </div>

              {/* Ports */}
              {(app.ports?.length ?? 0) > 0 && (
                <div className="mb-3 pt-2 border-t border-foreground/5">
                  <div className="text-[10px] text-foreground/40 mb-1.5">Zugewiesene Ports:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {app.ports!.map((port, j) => (
                      <span key={j} className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent font-mono">
                        {port.external}:{port.internal}/{port.protocol}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* System app banner */}
              {app.system && (
                <div className="mb-3 pt-2 border-t border-foreground/5 text-[10px] text-blue-300/80 bg-blue-500/10 border border-blue-500/20 rounded-lg p-2">
                  System-App — wird automatisch mit dem Developer-Modus aktiviert.
                  {isOsDev
                    ? ' OS-DEV-Image: Force-Deinstallation per "Erzwingen" möglich.'
                    : ' Kann nicht manuell deinstalliert werden.'}
                </div>
              )}

              {/* Status badge – enhanced with detailed info */}
              <div className="mb-2 flex items-center gap-2 flex-wrap">
                {app.status === 'running' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-green-500/15 text-green-400 rounded-lg text-[10px] font-semibold border border-green-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Läuft
                  </span>
                ) : app.status === 'starting' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/15 text-amber-300 rounded-lg text-[10px] font-semibold border border-amber-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-spin" /> Startet...
                  </span>
                ) : app.status === 'installing' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-blue-500/15 text-blue-300 rounded-lg text-[10px] font-semibold border border-blue-500/20">
                    <div className="animate-spin w-3 h-3 border-2 border-blue-300 border-t-transparent rounded-full" /> Wird installiert
                  </span>
                ) : app.status === 'error' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-red-500/15 text-red-300 rounded-lg text-[10px] font-semibold border border-red-500/20 cursor-help"
                    title={app.error_message || 'Unbekannter Fehler'}>
                    <Warning size={12} weight="fill" /> Fehler{app.error_message ? ': ' + app.error_message.substring(0, 60) + (app.error_message.length > 60 ? '...' : '') : ''}
                  </span>
                ) : app.status === 'crashed' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-red-500/20 text-red-400 rounded-lg text-[10px] font-semibold border border-red-500/30">
                    <Warning size={12} weight="fill" /> Abgestürzt{app.restart_count ? ` (${app.restart_count}x)` : ''}
                  </span>
                ) : app.status === 'stopped' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-foreground/10 text-foreground/50 rounded-lg text-[10px] font-semibold border border-foreground/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" /> Gestoppt
                  </span>
                ) : app.status === 'paused' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/15 text-yellow-300 rounded-lg text-[10px] font-semibold border border-yellow-500/20">
                    <Pause size={12} weight="fill" /> Pausiert
                  </span>
                ) : app.status === 'unhealthy' ? (
                  <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/15 text-amber-400 rounded-lg text-[10px] font-semibold border border-amber-500/20">
                    <Warning size={12} weight="fill" /> Unhealthy
                  </span>
                ) : null}

                {/* Container uptime */}
                {app.docker?.uptime && (
                  <span className="text-[9px] text-foreground/30 font-mono" title="Container-Uptime">
                    ⏱ {app.docker.uptime}
                  </span>
                )}

                {/* Resource usage */}
                {app.docker?.cpu_percent !== undefined && (
                  <span className="text-[9px] text-foreground/30 font-mono" title="CPU-Auslastung">
                    CPU {app.docker.cpu_percent}%
                  </span>
                )}
                {app.docker?.memory_mb !== undefined && (
                  <span className="text-[9px] text-foreground/30 font-mono" title="Speicher">
                    RAM {app.docker.memory_mb}MB
                  </span>
                )}

                {(app.custom_pages?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-foreground/40 ml-auto">
                    {app.custom_pages!.length} Seite{(app.custom_pages!.length !== 1) ? 'n' : ''}
                  </span>
                )}
                {surfaces.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/20" title={surfaces.join(', ')}>
                    <Lightning size={11} weight="fill" /> {surfaces.length} Integration{surfaces.length !== 1 ? 'en' : ''}
                  </span>
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  app.autostart ?? app.enabled
                    ? 'bg-blue-500/15 text-blue-300'
                    : 'bg-foreground/10 text-foreground/40'
                }`}>
                  {app.autostart ?? app.enabled ? 'Autostart an' : 'Autostart aus'}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {/* Open button - for apps with custom pages */}
                {(app.custom_pages?.length ?? 0) > 0 && (
                  <button
                    onClick={() => openApp(app.id, app.open_url)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/15 text-accent rounded text-[10px] font-semibold hover:bg-accent/25 transition-colors"
                  >
                    <Play size={12} weight="fill" /> Öffnen
                  </button>
                )}

                {app.system ? (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/15 text-blue-300 rounded text-[10px] font-semibold">
                    <ShieldCheck size={12} weight="fill" /> System-App
                  </span>
                ) : (
                  <>
                    {app.status === 'running' ? (
                      <>
                        <button
                          onClick={() => stopApp(app.id)}
                          disabled={actionLoading === `stop-${app.id}`}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40"
                        >
                          {actionLoading === `stop-${app.id}` ? <InlineSpinner size={12} /> : <Pause size={12} />}
                          Stoppen
                        </button>
                        {(app.docker || app.docker_config || app.is_bundle) && (
                          <button
                            onClick={() => pauseApp(app.id)}
                            disabled={actionLoading === `pause-${app.id}`}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-yellow-500/15 text-yellow-300 rounded text-[10px] font-semibold hover:bg-yellow-500/25 transition-colors disabled:opacity-40"
                          >
                            {actionLoading === `pause-${app.id}` ? <InlineSpinner size={12} /> : <Pause size={12} />}
                            Pausieren
                          </button>
                        )}
                      </>
                    ) : app.status === 'paused' ? (
                      <button
                        onClick={() => startApp(app.id)}
                        disabled={actionLoading === `start-${app.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40"
                      >
                        {actionLoading === `start-${app.id}` ? <InlineSpinner size={12} /> : <Play size={12} />}
                        Fortsetzen
                      </button>
                    ) : app.status === 'starting' || app.status === 'installing' ? (
                      <button
                        disabled
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 text-amber-300 rounded text-[10px] font-semibold opacity-80 cursor-default"
                      >
                        <InlineSpinner size={12} /> {app.status === 'installing' ? 'Vorbereiten…' : 'Startet…'}
                      </button>
                    ) : (
                      <button
                        onClick={() => startApp(app.id)}
                        disabled={actionLoading === `start-${app.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40"
                      >
                        {actionLoading === `start-${app.id}` ? <InlineSpinner size={12} /> : <Play size={12} />}
                        Starten
                      </button>
                    )}
                    {app.enabled ? (
                      <button
                        onClick={() => disableApp(app.id)}
                        disabled={actionLoading === `disable-${app.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40"
                      >
                        {actionLoading === `disable-${app.id}` ? <InlineSpinner size={12} /> : <Pause size={12} />}
                        Deaktivieren
                      </button>
                    ) : (
                      <button
                        onClick={() => enableApp(app.id)}
                        disabled={actionLoading === `enable-${app.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40"
                      >
                        {actionLoading === `enable-${app.id}` ? <InlineSpinner size={12} /> : <Play size={12} />}
                        Aktivieren
                      </button>
                    )}
                    <button
                      onClick={() => { window.location.href = `/app-settings/${app.id}` }}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors"
                    >
                      <Gear size={12} /> {t('settings.title')}
                    </button>
                    <button
                      onClick={() => uninstallApp(app.id)}
                      disabled={actionLoading === app.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500/15 text-red-400 rounded text-[10px] font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-40"
                    >
                      {actionLoading === app.id ? <InlineSpinner size={12} /> : <TrashSimple size={12} />}
                      Deinstallieren
                    </button>
                  </>
                )}
                {app.system && isOsDev && (
                  <button
                    onClick={() => uninstallApp(app.id, true)}
                    disabled={actionLoading === app.id}
                    title="Nur auf OS-DEV-Images verfügbar"
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-yellow-500/15 text-yellow-400 rounded text-[10px] font-semibold hover:bg-yellow-500/25 transition-colors disabled:opacity-40"
                  >
                    {actionLoading === app.id ? <InlineSpinner size={12} /> : <TrashSimple size={12} />}
                    Erzwingen (DEV)
                  </button>
                )}
              </div>

              <div className="mt-2 text-[10px] text-foreground/30">
                {t('apps.overview.installedAt')}: {new Date(app.installed_at).toLocaleDateString(locale, {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}
                {app.last_started_at && (
                  <span className="ml-2">
                    · {t('apps.overview.lastStart')}: {new Date(app.last_started_at).toLocaleDateString(locale, {
                      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                )}
              </div>
            </div>
              )
            })()
          ))}
          {filteredApps.length === 0 && (
            <div className="text-center py-10 text-xs text-foreground/45">
              {t('apps.overview.noFilteredEntries')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── App Store View ───────────────────────────────────────────────────────

/** Minimal inline SVG tile (rounded background + glyph) as a data URL. */
function svgIconData(bg: string, glyph: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
    `<text x="32" y="46" font-family="Arial, sans-serif" font-size="34" font-weight="bold" fill="white" text-anchor="middle">${glyph}</text>` +
    `</svg>`
  try {
    return `data:image/svg+xml;base64,${btoa(svg)}`
  } catch {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }
}

function AppStoreView({
  token,
  searchQuery,
  setSearchQuery,
  apps,
  onAppClick,
  onInstalled,
}: {
  token: string
  searchQuery: string
  setSearchQuery: (q: string) => void
  apps: AppInfo[]
  onAppClick: (appId: string) => void
  onInstalled: () => void
}) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()
  const { activeJobs } = useInstalledApps()
  const [activeCategory, setActiveCategory] = useState<'all' | 'app' | 'plugin'>('all')
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const [selectedApp, setSelectedApp] = useState<StoreApp | null>(null)

  // ── IORA Essentials — only real user-facing apps (Docs, Share, Streaming) ──
  const essentials: StoreApp[] = useMemo(() => [
    { id: 'docs', name: t('os.apps.docs.name'), developer: 'IORA OS', description: t('os.apps.docs.description'), version: '2.0', trust_level: 'trusted', enabled: true, installed_at: '', kind: 'app', isEssential: true, pageId: 'docs', iconUrl: svgIconData('oklch(0.6 0.15 250)', 'D') },
    { id: 'share', name: t('os.apps.share.name'), developer: 'IORA OS', description: t('os.apps.share.description'), version: '2.0', trust_level: 'trusted', enabled: true, installed_at: '', kind: 'app', isEssential: true, pageId: 'share', iconUrl: svgIconData('oklch(0.62 0.18 300)', 'S') },
    { id: 'streaming', name: t('os.apps.streaming.name'), developer: 'IORA OS', description: t('os.apps.streaming.description'), version: '2.0', trust_level: 'trusted', enabled: true, installed_at: '', kind: 'app', isEssential: true, pageId: 'streaming', iconUrl: svgIconData('oklch(0.62 0.18 15)', '▶') },
  ], [t])

  // Store apps = real backend apps (no system apps) + Essentials + Docker catalog.
  const storeApps = useMemo<StoreApp[]>(() => {
    const backend: StoreApp[] = apps.filter((app) => app.kind !== 'system')
    // Once a catalog app is installed it comes back via the backend list —
    // don't show it twice.
    const catalog: StoreApp[] = STORE_CATALOG
      .filter((def) => !backend.some((b) => b.id === def.id))
      .map((def) => ({
      id: def.id,
      name: def.name,
      developer: def.developer,
      description: t(`apps.appStore.catalog.${def.id}` as never, { defaultValue: def.description }) as unknown as string,
      version: def.version,
      trust_level: 'verified' as const,
      enabled: false,
      installed_at: '',
      kind: 'app',
      isCatalog: true,
      openPort: def.openPort,
      iconUrl: def.iconUrl,
    }))
    return [...backend, ...essentials, ...catalog]
  }, [apps, essentials, t])
  const installedIds = useMemo(() => new Set(apps.filter((app) => app.enabled).map((app) => app.id)), [apps])

  // Category chips derive from the real data.
  const categories = useMemo(() => {
    const list: Array<{ id: 'all' | 'app' | 'plugin'; label: string; icon: typeof Sparkle }> = [
      { id: 'all', label: t('apps.appStore.forYou'), icon: Sparkle },
    ]
    if (storeApps.some((app) => app.kind === 'app')) {
      list.push({ id: 'app', label: t('navigation.apps'), icon: PuzzlePiece })
    }
    if (storeApps.some((app) => app.kind === 'plugin')) {
      list.push({ id: 'plugin', label: t('navigation.plugins'), icon: Lightning })
    }
    return list
  }, [storeApps, t])

  // Search + category filter over the real apps.
  const filteredApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return storeApps.filter((app) => {
      if (activeCategory !== 'all' && app.kind !== activeCategory) return false
      if (!query) return true
      return [app.name, app.id, app.developer, app.description]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    })
  }, [storeApps, activeCategory, searchQuery])

  // Featured = first apps of the filtered list (storefront banners).
  const featured = filteredApps.slice(0, 3)

  // Auto-rotate the hero banner like a storefront carousel.
  useEffect(() => {
    if (featured.length < 2) return
    const timer = window.setInterval(() => {
      setFeaturedIndex((current) => (current + 1) % featured.length)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [featured.length])

  /** Deterministic brand gradient per app id (Play-store style tiles). */
  const gradientFor = (id: string) => {
    let hash = 0
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360
    const h1 = hash
    const h2 = (hash + 55) % 360
    return { background: `linear-gradient(145deg, oklch(0.68 0.17 ${h1}), oklch(0.52 0.15 ${h2}))` }
  }

  const StoreAppIcon = ({ app, size = 'md', installing = false, progress = 0, installed = false }: {
    app: StoreApp
    size?: 'md' | 'lg' | 'xl'
    /** Show a download-style progress ring over the icon (App Store look). */
    installing?: boolean
    progress?: number
    /** Show a green check badge (installed & running). */
    installed?: boolean
  }) => {
    const classes = {
      md: 'h-12 w-12 rounded-2xl',
      lg: 'h-14 w-14 rounded-2xl',
      xl: 'h-16 w-16 rounded-[1.35rem]',
    }[size]
    const imgSrc = app.iconUrl || (app.icon && /^(https?:|data:)/.test(app.icon) ? app.icon : undefined)
    const radius = 15
    const circumference = 2 * Math.PI * radius
    return (
      <span className={`${classes} relative shrink-0 overflow-hidden shadow-lg`}>
        {imgSrc ? (
          <img src={imgSrc} alt={app.name} className="h-full w-full object-cover" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center text-lg font-bold text-white`} style={gradientFor(app.id)}>
            {app.name.trim().charAt(0).toUpperCase() || '?'}
          </span>
        )}
        {installing && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
            <svg className="h-1/2 w-1/2 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <circle cx="18" cy="18" r={radius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
              <circle
                cx="18" cy="18" r={radius} fill="none" stroke="white" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, progress)) / 100)}
              />
            </svg>
          </span>
        )}
        {!installing && installed && (
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg ring-2 ring-background">
            <Check size={11} weight="bold" />
          </span>
        )}
      </span>
    )
  }

  const openApp = (app: StoreApp) => {
    if (app.isEssential && app.pageId) {
      setCurrentPageId(app.pageId)
    } else if (app.isCatalog) {
      // Installed → open embedded (iframe runner); the runner has an
      // "open in browser" action for the external tab.
      const backendApp = apps.find((candidate) => candidate.id === app.id)
      const port = firstExternalPort(backendApp?.ports) ?? app.openPort
      if (port) {
        setCurrentPageId(app.id)
      } else {
        onAppClick(app.id)
      }
    } else {
      // Backend-installed app: open embedded when a host port is known
      // (catalog port as fallback), otherwise fall back to the detail dialog.
      const catalogPort = STORE_CATALOG.find((def) => def.id === app.id)?.openPort
      const port = firstExternalPort(app.ports) ?? catalogPort
      if (port) {
        setCurrentPageId(app.id)
      } else {
        onAppClick(app.id)
      }
    }
  }

  const [installingId, setInstallingId] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)

  /** Backend entry for a catalog app (present once installed). */
  const backendAppFor = (app: StoreApp) => apps.find((candidate) => candidate.id === app.id)

  /** True for any installed (non-essential) app — shows uninstall + start. */
  const isInstalledApp = (app: StoreApp) =>
    !app.isEssential && (app.status === 'running' || app.enabled || (app.isCatalog && Boolean(backendAppFor(app))))

  /** Icon overlay state (App Store style): progress ring / check badge. */
  const iconStatus = (app: StoreApp) => {
    const job = activeJobs.find((j) => j.appId === app.id)
    const installing = installingId === app.id || Boolean(job)
    const running = app.status === 'running' || (app.isCatalog ? isRunning(app) : false)
    return {
      installing,
      progress: job?.progress ?? (installingId === app.id ? 12 : 0),
      installed: !installing && running,
    }
  }

  /** Docker apps count as installed only while RUNNING. */
  const isRunning = (app: StoreApp) => {
    const backend = backendAppFor(app)
    return app.isEssential || Boolean(backend?.status === 'running' || (backend?.enabled && backend.status === 'running'))
  }

  /** Installs a catalog (Docker) app via the existing ZIP install API. */
  const installCatalogApp = async (app: StoreApp) => {
    const def = STORE_CATALOG.find((d) => d.id === app.id)
    if (!def) return
    setInstallingId(app.id)
    try {
      const zipData = def.buildZip()
      await adminFetch('/api/appstore/install', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zip_data: zipData,
          file_name: `${app.id}.zip`,
          granted_permissions: def.permissions,
          denied_permissions: [],
        }),
      })
      toast.success(t('apps.appStore.installStarted', { name: app.name }))
      // CasaOS-style: poll the backend until the app actually shows up
      // (download → install → running), then refresh the list.
      let attempts = 0
      const poll = window.setInterval(() => {
        attempts += 1
        onInstalled()
        if (apps.some((candidate) => candidate.id === app.id) || attempts > 40) {
          window.clearInterval(poll)
        }
      }, 2500)
      setSelectedApp(null)
    } catch (e) {
      toast.error(t('apps.appStore.installFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setInstallingId(null)
    }
  }

  /** Start a stopped app (installed but not running). */
  const startApp = (app: StoreApp) => {
    if (startingId) return
    setStartingId(app.id)
    adminFetch(`/api/supervisor/apps/${app.id}/start`, token, { method: 'POST' })
      .then(() => { window.setTimeout(onInstalled, 1500) })
      .catch((e) => toast.error(t('apps.appStore.installFailed', { detail: e instanceof Error ? e.message : String(e) })))
      .finally(() => setStartingId(null))
  }

  /** Uninstall an installed app (stops container + removes app data). */
  const uninstallApp = async (app: StoreApp) => {
    if (!window.confirm(t('apps.appStore.uninstallConfirm', { name: app.name }))) return
    try {
      await adminFetch(`/api/appstore/apps/${app.id}`, token, { method: 'DELETE' })
      toast.success(t('apps.appStore.uninstalled', { name: app.name }))
      onInstalled()
      setSelectedApp(null)
    } catch (e) {
      toast.error(t('apps.appStore.installFailed', { detail: e instanceof Error ? e.message : String(e) }))
    }
  }

  /** Primary action for any store app (CasaOS-style lifecycle). */
  const primaryAction = (app: StoreApp) => {
    if (app.isEssential) return openApp(app)
    if (app.isCatalog) {
      if (isRunning(app)) return openApp(app)
      const backend = backendAppFor(app)
      if (backend) return startApp(app)
      return installCatalogApp(app)
    }
    // Backend-installed app: running → open; enabled-but-stopped → start.
    if (app.status === 'running') return openApp(app)
    if (app.enabled) return startApp(app)
    return onAppClick(app.id)
  }

  const actionLabel = (app: StoreApp) => {
    if (app.isEssential) return t('apps.appStore.openApp')
    if (app.isCatalog) {
      if (installingId === app.id) return t('apps.appStore.installing', { name: '' }).trim()
      if (startingId === app.id) return t('apps.appStore.starting', { name: '' }).trim()
      if (isRunning(app)) return t('apps.appStore.openApp')
      if (backendAppFor(app)) return t('apps.appStore.start')
      return t('apps.appStore.install')
    }
    if (app.status === 'running') return t('apps.appStore.openApp')
    if (app.enabled) return t('apps.appStore.start')
    return t('apps.appStore.install')
  }

  const similarApps = useMemo(() => {
    if (!selectedApp) return []
    return storeApps
      .filter((app) => app.id !== selectedApp.id && (app.developer === selectedApp.developer || app.kind === selectedApp.kind))
      .slice(0, 6)
  }, [selectedApp, storeApps])

  // ═══════════════════ APP DETAIL PAGE (Play-store style) ═══════════════════
  if (selectedApp) {
    const app = selectedApp
    const installed = installedIds.has(app.id)
    return (
      <div className="space-y-6">
        {/* Back */}
        <button
          type="button"
          onClick={() => setSelectedApp(null)}
          className="flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/[0.04] px-4 py-2 text-xs font-semibold text-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
        >
          <CaretLeft size={14} weight="bold" />
          {t('apps.appStore.back')}
        </button>

        {/* Hero */}
        <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 shadow-2xl shadow-black/20">
          <div
            className="relative flex min-h-[13rem] flex-col justify-end p-6 sm:min-h-[15rem] sm:p-8"
            style={bannerStyleFor(app.id)}
          >
            <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 right-40 h-44 w-44 rounded-full bg-black/15 blur-2xl" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,transparent_30%,rgba(0,0,0,0.28))]" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-4">
                <StoreAppIcon app={app} size="xl" {...iconStatus(app)} />
                <div className="min-w-0">
                  <h3 className="text-2xl font-bold text-white drop-shadow-sm">{app.name}</h3>
                  <p className="mt-0.5 text-xs text-white/70">{app.developer} · {t('apps.appStore.version')} {app.version}</p>
                  <div className="mt-2 flex items-center gap-2">{trustBadge(app)}{app.isEssential && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">{t('apps.appStore.preinstalled')}</span>
                  )}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => primaryAction(app)}
                  disabled={installingId === app.id || startingId === app.id}
                  className="rounded-full bg-white px-7 py-3 text-xs font-bold text-slate-900 shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-60"
                >
                  {actionLabel(app)}
                </button>
                {isInstalledApp(app) && (
                  <button
                    type="button"
                    onClick={() => void uninstallApp(app)}
                    className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-3 text-xs font-bold text-white ring-1 ring-white/30 backdrop-blur-md transition-colors hover:bg-red-500/70"
                  >
                    <TrashSimple size={13} weight="bold" />
                    {t('apps.appStore.uninstall')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Description + facts */}
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-[1.5rem] border border-foreground/8 bg-foreground/[0.03] p-5 sm:p-6">
            <h4 className="text-sm font-bold text-foreground">Über diese App</h4>
            <p className="mt-3 text-sm leading-relaxed text-foreground/65">{app.description}</p>
            {app.isEssential && (
              <p className="mt-4 rounded-2xl bg-accent/8 p-4 text-xs leading-relaxed text-foreground/55">
                {t('apps.appStore.essentialsHint')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            {[
              { label: t('apps.appStore.developer'), value: app.developer },
              { label: t('apps.appStore.version'), value: app.version },
              { label: t('apps.appStore.source'), value: app.isEssential ? 'IORA OS' : (app.source || 'Local') },
              { label: t('apps.appStore.preinstalled'), value: app.isEssential ? t('common.yes') : t('common.no') },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-2xl border border-foreground/8 bg-foreground/[0.03] px-4 py-3">
                <span className="text-xs text-foreground/45">{row.label}</span>
                <span className="truncate pl-3 text-xs font-semibold text-foreground/80">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Similar apps */}
        {similarApps.length > 0 && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
              <span className="h-4 w-1 rounded-full bg-accent" />
              {t('apps.appStore.similarApps')}
            </h3>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {similarApps.map((similar) => (
                <div
                  key={similar.id}
                  onClick={() => setSelectedApp(similar)}
                  className="flex w-64 shrink-0 cursor-pointer items-center gap-3 rounded-2xl border border-foreground/8 bg-foreground/[0.035] p-3 transition-all hover:-translate-y-0.5 hover:bg-foreground/[0.07]"
                >
                  <StoreAppIcon app={similar} size="md" {...iconStatus(similar)} />
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-[13px] font-semibold text-foreground">{similar.name}</h4>
                    <p className="truncate text-[10px] text-foreground/45">{similar.developer}</p>
                  </div>
                  <CaretRight size={14} className="shrink-0 text-foreground/25" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ═══════════════════ STORE FRONT ═══════════════════
  return (
    <div className="space-y-8 rounded-[2rem] bg-background/85 p-4 shadow-2xl ring-1 ring-foreground/8 backdrop-blur-2xl sm:p-7">
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">ORA OS</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">{t('apps.appStore.title')}</h2>
        </div>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent shadow-lg shadow-accent/10">
          <Cube size={24} weight="duotone" />
        </span>
      </div>

      {/* ─── Search Bar ─────────────────────────────────────── */}
      <div className="relative">
        <MagnifyingGlass size={17} weight="bold" className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground/35" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('apps.appStore.search')}
          className="w-full rounded-2xl border border-foreground/10 bg-foreground/[0.045] py-3.5 pl-11 pr-4 text-sm text-foreground outline-none transition-all placeholder:text-foreground/30 focus:border-accent/40 focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {/* ─── Category Pills ─────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none]">
        {categories.map(cat => { const CategoryIcon = cat.icon; return (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium transition-all ${
              activeCategory === cat.id
                ? 'bg-accent text-white shadow-lg shadow-accent/25'
                : 'border border-foreground/10 bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground'
            }`}
          >
            <CategoryIcon size={15} weight={activeCategory === cat.id ? 'fill' : 'regular'} />
            {cat.label}
          </button>
        )})}
      </div>

      {filteredApps.length === 0 ? (
        /* ─── Empty state ──────────────────────────────────── */
        <div className="flex flex-col items-center gap-3 rounded-[1.75rem] border border-dashed border-foreground/12 bg-foreground/[0.02] px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-foreground/[0.05] text-foreground/25">
            <Cube size={30} weight="thin" />
          </span>
          <p className="text-sm font-semibold text-foreground/70">{t('apps.appStore.emptyTitle')}</p>
          <p className="max-w-sm text-xs leading-relaxed text-foreground/40">{t('apps.appStore.emptyDescription')}</p>
        </div>
      ) : (
        <>
          {/* ─── Hero Banner Carousel (storefront style) ─────── */}
          <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 shadow-2xl shadow-black/20">
            <AnimatePresence mode="wait">
              {featured.map((app, index) => {
                if (index !== featuredIndex) return null
                const installed = installedIds.has(app.id)
                return (
                  <motion.div
                    key={app.id}
                    initial={{ opacity: 0, scale: 1.02 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="relative flex min-h-[16rem] cursor-pointer flex-col justify-end overflow-hidden p-6 sm:min-h-[18rem] sm:p-9 [background:var(--banner-bg)]"
                    style={{ '--banner-bg': bannerStyleFor(app.id).background } as React.CSSProperties}
                    onClick={() => setSelectedApp(app)}
                  >
                    {/* decorative glow blobs */}
                    <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-white/15 blur-3xl" />
                    <div className="pointer-events-none absolute -bottom-24 right-40 h-44 w-44 rounded-full bg-black/15 blur-2xl" />
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,transparent_30%,rgba(0,0,0,0.28))]" />

                    <p className="relative text-[10px] font-semibold uppercase tracking-[0.22em] text-white/75">
                      {t('apps.appStore.bannerTag')} · {app.developer}
                    </p>
                    <div className="relative mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex items-center gap-4">
                        <StoreAppIcon app={app} size="xl" {...iconStatus(app)} />
                        <div className="min-w-0">
                          <h3 className="text-xl font-bold text-white drop-shadow-sm sm:text-2xl">{app.name}</h3>
                          <p className="mt-0.5 max-w-md truncate text-xs text-white/70 sm:text-sm">{app.description}</p>
                          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-white/85">
                            {app.version} · {app.kind === 'plugin' ? t('navigation.plugins') : t('navigation.apps')}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); primaryAction(app) }}
                        disabled={installingId === app.id}
                        className={`shrink-0 self-start rounded-full px-6 py-2.5 text-xs font-bold shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-60 sm:self-auto ${
                          app.isEssential || installed ? 'bg-black/30 text-white ring-1 ring-white/30 backdrop-blur-md' : 'bg-white text-slate-900'
                        }`}
                      >
                        {actionLabel(app)}
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {featured.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label={t('apps.appStore.prevBanner')}
                  onClick={() => setFeaturedIndex((current) => (current - 1 + featured.length) % featured.length)}
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md transition-colors hover:bg-black/40"
                >
                  <CaretLeft size={16} weight="bold" />
                </button>
                <button
                  type="button"
                  aria-label={t('apps.appStore.nextBanner')}
                  onClick={() => setFeaturedIndex((current) => (current + 1) % featured.length)}
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md transition-colors hover:bg-black/40"
                >
                  <CaretRight size={16} weight="bold" />
                </button>
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {featured.map((app, index) => (
                    <button
                      key={app.id}
                      type="button"
                      aria-label={t('apps.appStore.banner', { n: index + 1 })}
                      onClick={() => setFeaturedIndex(index)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${index === featuredIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ─── Recommended – horizontal store row ─────────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="h-4 w-1 rounded-full bg-accent" />
                {t('apps.appStore.popular')}
              </h3>
            </div>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filteredApps.map(app => {
                const installed = installedIds.has(app.id)
                return (
                  <div
                    key={app.id}
                    onClick={() => setSelectedApp(app)}
                    className="flex w-72 shrink-0 cursor-pointer items-center gap-3 rounded-2xl border border-foreground/8 bg-foreground/[0.035] p-3 transition-all hover:-translate-y-0.5 hover:bg-foreground/[0.07]"
                  >
                    <StoreAppIcon app={app} size="md" {...iconStatus(app)} />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-[13px] font-semibold text-foreground">{app.name}</h4>
                      <p className="truncate text-[10px] text-foreground/45">{app.developer}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        {trustBadge(app)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); primaryAction(app) }}
                        disabled={installingId === app.id || startingId === app.id}
                        className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-60 ${
                          app.isEssential || installed ? 'bg-foreground/8 text-foreground/60' : 'bg-accent/12 text-accent hover:bg-accent/22'
                        }`}
                      >
                        {actionLabel(app)}
                      </button>
                      {isInstalledApp(app) && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void uninstallApp(app) }}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-red-500/15 hover:text-red-400"
                          aria-label={t('apps.appStore.uninstall')}
                          title={t('apps.appStore.uninstall')}
                        >
                          <TrashSimple size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ─── Top Charts – numbered list ─────────────────── */}
          {filteredApps.length > 3 && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="h-4 w-1 rounded-full bg-accent" />
                {t('apps.appStore.topCharts')}
              </h3>
              <div className="grid gap-2">
                {filteredApps.slice(0, 5).map((app, index) => {
                  const installed = installedIds.has(app.id)
                  return (
                    <div
                      key={app.id}
                      onClick={() => setSelectedApp(app)}
                      className="flex cursor-pointer items-center gap-3 rounded-2xl border border-foreground/8 bg-foreground/[0.03] px-4 py-3 transition-colors hover:bg-foreground/[0.06]"
                    >
                      <span className="w-6 shrink-0 text-center text-base font-extrabold tabular-nums text-foreground/20">{index + 1}</span>
                      <StoreAppIcon app={app} size="md" {...iconStatus(app)} />
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-[13px] font-semibold text-foreground">{app.name}</h4>
                        <p className="truncate text-[10px] text-foreground/45">{app.developer} · {app.version}</p>
                      </div>
                      <span className="hidden sm:block">{trustBadge(app)}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); primaryAction(app) }}
                          disabled={installingId === app.id || startingId === app.id}
                          className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-60 ${
                            app.isEssential || installed ? 'bg-foreground/8 text-foreground/60' : 'bg-accent/12 text-accent hover:bg-accent/22'
                          }`}
                        >
                          {actionLabel(app)}
                        </button>
                        {isInstalledApp(app) && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void uninstallApp(app) }}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/40 transition-colors hover:bg-red-500/15 hover:text-red-400"
                            aria-label={t('apps.appStore.uninstall')}
                            title={t('apps.appStore.uninstall')}
                          >
                            <TrashSimple size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
/** Compact trust indicator for store cards. */
function trustBadge(app: AppInfo) {
  if (app.trust_level === 'trusted') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-green-400" title="Vertrauenswürdig"><ShieldCheck size={10} weight="fill" />Vertrauenswürdig</span>
  }
  if (app.trust_level === 'verified') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-blue-400" title="Verifiziert"><Check size={10} weight="bold" />Verifiziert</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/12 px-1.5 py-0.5 text-[9px] font-semibold text-orange-400" title="Nicht vertrauenswürdig"><ShieldWarning size={10} weight="fill" />Nicht vertrauenswürdig</span>
}

/** Rich banner gradient derived deterministically from the app id. */
function bannerStyleFor(id: string): { background: string } {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  const h1 = hash
  const h2 = (hash + 55) % 360
  const h3 = (hash + 110) % 360
  return {
    background: `linear-gradient(120deg, oklch(0.66 0.16 ${h1}) 0%, oklch(0.5 0.15 ${h2}) 55%, oklch(0.38 0.12 ${h3}) 100%)`,
  }
}

function ZipUploadView({
  token,
  onSuccess
}: {
  token: string
  onSuccess: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [manifest, setManifest] = useState<AppManifest | null>(null)
  const [manifestError, setManifestError] = useState<string | null>(null)
  const [grantedPermissions, setGrantedPermissions] = useState<string[]>([])
  const [permissionConsent, setPermissionConsent] = useState(false)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [duplicateAppId, setDuplicateAppId] = useState<string | null>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setManifest(null)
    setManifestError(null)
    setGrantedPermissions([])
    setPermissionConsent(false)
    setReplaceExisting(false)
    setDuplicateAppId(null)

    try {
      const { extractManifestFromZip } = await import('../lib/zip')
      const extractedManifest = await extractManifestFromZip(selectedFile)

      // Validate manifest before setting it
      const { quickValidateManifest, formatValidationIssues } = await import('@/lib/manifestValidation')
      const issues = quickValidateManifest(extractedManifest as Record<string, unknown>)
      const errors = issues.filter(i => i.severity === 'error')
      if (errors.length > 0) {
        setManifestError(formatValidationIssues(errors))
        toast.error(`Manifest ungültig – ${errors.length} Fehler`, { duration: 6000 })
        return
      }
      const warnings = issues.filter(i => i.severity === 'warning')
      if (warnings.length > 0) {
        toast.warning(formatValidationIssues(warnings), { duration: 5000 })
      }

      setManifest(extractedManifest)
      setGrantedPermissions(extractedManifest.permissions || [])
      setPermissionConsent((extractedManifest.permissions || []).length === 0)
      try {
        const installed = await adminFetch('/api/appstore/installed', token) as { apps?: AppInfo[] }
        const duplicate = installed.apps?.find(app => app.id === extractedManifest.id)
        setDuplicateAppId(duplicate?.id || null)
      } catch {
        setDuplicateAppId(null)
      }
      toast.success('manifest.json erfolgreich gelesen')
    } catch (err) {
      console.error('Manifest extraction failed:', err)
      setManifestError((err as Error).message)
      toast.error(`Konnte manifest.json nicht lesen: ${(err as Error).message}`)
    }
  }

  const uploadAndInstall = async () => {
    if (!file) return
    const requestedPermissions = manifest?.permissions || []
    if (requestedPermissions.length > 0 && !permissionConsent) {
      toast.error('Bitte bestätige die Berechtigungen vor der Installation.')
      return
    }
    if (duplicateAppId && !replaceExisting) {
      toast.error('Diese App ist bereits installiert. Aktiviere Ersetzen, um fortzufahren.')
      return
    }

    setUploading(true)
    try {
      const fileRef = file
      // Convert file to base64
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64 = reader.result?.toString().split(',')[1]

          const result = await adminFetch('/api/appstore/install', token, {
            method: 'POST',
            body: JSON.stringify({
              zip_data: base64,
              file_name: fileRef.name,
              manifest: manifest || undefined,
              granted_permissions: requestedPermissions.filter(permission => grantedPermissions.includes(permission)),
              denied_permissions: requestedPermissions.filter(permission => !grantedPermissions.includes(permission)),
              replace_existing: replaceExisting,
            }),
          }) as { install_id?: string }

          if (result.install_id) {
            toast.success('Installation gestartet — Fortschritt unter "Installierte Apps".')
          } else {
            toast.success('App erfolgreich installiert!')
          }
          onSuccess()
        } catch (e) {
          toast.error((e as Error).message)
        } finally {
          setUploading(false)
        }
      }
      reader.onerror = () => {
        toast.error('ZIP konnte nicht gelesen werden.')
        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch (e) {
      toast.error((e as Error).message)
      setUploading(false)
    }
  }

  return (
    <AdminCard title="App per ZIP hochladen" icon={Upload}>
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <div className="flex items-start gap-2">
            <ShieldWarning size={20} className="text-orange-400 flex-shrink-0 mt-0.5" weight="fill" />
            <div>
              <div className="text-xs font-semibold text-orange-400 mb-1">Sicherheitshinweis</div>
              <div className="text-[10px] text-orange-400/70 leading-relaxed">
                Apps aus ZIP-Dateien gelten standardmäßig als <strong>nicht vertrauenswürdig</strong>.
                Lade nur Apps aus vertrauenswürdigen Quellen hoch. Böswillige Apps könnten
                Sicherheitsrisiken darstellen oder dein System beschädigen.
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground mb-2">ZIP-Datei auswählen</label>
          <div className="relative">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileChange}
              className="block w-full text-xs text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-accent file:text-white hover:file:bg-accent/90 file:cursor-pointer cursor-pointer"
            />
          </div>
          {file && (
            <div className="mt-2 p-2 rounded bg-foreground/5 flex items-center gap-2">
              <Package size={16} className="text-foreground/60" />
              <span className="text-xs text-foreground/70">{file.name}</span>
              <span className="text-[10px] text-foreground/40 ml-auto">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
          )}
        </div>

        {manifest && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
            <div className="flex items-center gap-2 text-green-400">
              <Check size={16} weight="bold" />
              <span className="text-xs font-semibold">Manifest validiert</span>
            </div>
            <div className="flex gap-3">
              {manifest.icon ? (
                <div className="w-12 h-12 rounded bg-foreground/10 flex-shrink-0 overflow-hidden">
                  <img src={manifest.icon} alt={manifest.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded bg-accent/20 flex items-center justify-center flex-shrink-0">
                  <Cube size={24} className="text-accent" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{manifest.name}</div>
                <div className="text-[10px] text-foreground/50">{manifest.version} • {manifest.developer}</div>
                <p className="text-[10px] text-foreground/40 mt-1 line-clamp-1">{manifest.description}</p>
              </div>
            </div>
            {manifest.type && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold uppercase">
                  {manifest.type}
                </span>
                {manifest.permissions && (
                  <span className="text-[9px] text-foreground/40">
                    {manifest.permissions.length} Berechtigungen angefordert
                  </span>
                )}
              </div>
            )}
            {manifest.permissions && manifest.permissions.length > 0 && (
              <div className="pt-2 mt-2 border-t border-green-500/15 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold text-foreground">Berechtigungen</span>
                  <button
                    type="button"
                    onClick={() => setGrantedPermissions(
                      grantedPermissions.length === manifest.permissions.length ? [] : manifest.permissions
                    )}
                    className="text-[10px] text-accent hover:text-accent/80"
                  >
                    {grantedPermissions.length === manifest.permissions.length ? 'Alle entziehen' : 'Alle gewähren'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {manifest.permissions.map(permission => {
                    const checked = grantedPermissions.includes(permission)
                    return (
                      <label
                        key={permission}
                        className="flex items-center gap-2 p-2 rounded bg-foreground/5 border border-foreground/10 text-[10px] text-foreground/70"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setGrantedPermissions(current =>
                            checked
                              ? current.filter(item => item !== permission)
                              : [...current, permission]
                          )}
                          className="accent-accent"
                        />
                        <span className="truncate" title={permission}>{permission}</span>
                      </label>
                    )
                  })}
                </div>
                <label className="flex items-start gap-2 text-[10px] text-foreground/65">
                  <input
                    type="checkbox"
                    checked={permissionConsent}
                    onChange={(event) => setPermissionConsent(event.target.checked)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>Ausgewählte Berechtigungen für diese Installation speichern.</span>
                </label>
              </div>
            )}
            {duplicateAppId && (
              <div className="pt-2 mt-2 border-t border-orange-500/20">
                <label className="flex items-start gap-2 text-[10px] text-orange-300">
                  <input
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(event) => setReplaceExisting(event.target.checked)}
                    className="mt-0.5 accent-orange-400"
                  />
                  <span>Bestehende Installation von {duplicateAppId} ersetzen. Die App muss gestoppt sein.</span>
                </label>
              </div>
            )}
          </div>
        )}

        {manifestError && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex items-start gap-2 text-red-400">
              <Warning size={16} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold">Fehler im Manifest</div>
                <div className="text-[10px] opacity-80">{manifestError}</div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">Anforderungen:</div>
          <ul className="text-[10px] text-foreground/60 space-y-1 ml-4 list-disc">
            <li>Die ZIP-Datei muss eine <code className="px-1 py-0.5 rounded bg-foreground/10">manifest.json</code> im Root enthalten</li>
            <li>Alle erforderlichen Dateien für die App müssen enthalten sein</li>
            <li>Bei <code className="px-1 py-0.5 rounded bg-foreground/10">auto_build: true</code> wird ein Docker-Image automatisch erstellt</li>
            <li>Bei vorgefertigten Images muss das Image bereits vorhanden sein</li>
          </ul>
        </div>

        <button
          onClick={uploadAndInstall}
          disabled={!file || uploading || Boolean(manifest?.permissions?.length && !permissionConsent) || Boolean(duplicateAppId && !replaceExisting)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <InlineSpinner size={16} /> Wird hochgeladen...
            </>
          ) : (
            <>
              <Upload size={16} /> App installieren
            </>
          )}
        </button>
      </div>
    </AdminCard>
  )
}

// ── Install Progress List ────────────────────────────────────────────────

interface InstallJob {
  id: string
  file_name: string
  size_bytes: number
  status: 'pending' | 'extracting' | 'validating' | 'installing' | 'succeeded' | 'failed' | 'canceled'
  progress: number
  message: string
  app_id?: string | null
  app_name?: string | null
  app_version?: string | null
  started_at: string
  finished_at?: string | null
  error?: string | null
  log?: string[]
}

function InstallProgressList({ token, onJobComplete }: { token: string; onJobComplete: () => void }) {
  const [jobs, setJobs] = useState<InstallJob[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    let lastSucceeded = 0

    const tick = async () => {
      try {
        const data = await adminFetch('/api/appstore/jobs', token) as { jobs: InstallJob[]; active: number }
        if (cancelled) return
        const list = data.jobs ?? []
        const succeededNow = list.filter(j => j.status === 'succeeded').length
        if (succeededNow > lastSucceeded) onJobComplete()
        lastSucceeded = succeededNow
        setJobs(list)
        setActiveCount(data.active ?? 0)
      } catch {
        /* swallow — endpoint may temporarily be down */
      }
    }

    tick()
    const interval = setInterval(tick, 1500)
    return () => { cancelled = true; clearInterval(interval) }
  }, [token, onJobComplete])

  // Hide entirely when there's no history.
  const visibleJobs = jobs.slice(0, 8)
  if (visibleJobs.length === 0) return null

  const statusLabel = (s: InstallJob['status']) => ({
    pending: 'Warten',
    extracting: 'Entpacken',
    validating: 'Prüfen',
    installing: 'Installieren',
    succeeded: 'Fertig',
    failed: 'Fehler',
    canceled: 'Abgebrochen',
  }[s])

  const statusColor = (s: InstallJob['status']) => {
    switch (s) {
      case 'succeeded': return 'bg-green-500/15 text-green-300'
      case 'failed': return 'bg-red-500/15 text-red-300'
      case 'canceled': return 'bg-foreground/10 text-foreground/40'
      default: return 'bg-blue-500/15 text-blue-300'
    }
  }

  const barColor = (s: InstallJob['status']) =>
    s === 'failed' ? 'bg-red-400' : s === 'succeeded' ? 'bg-green-400' : 'bg-accent'

  const canClear = (s: InstallJob['status']) => ['succeeded', 'failed', 'canceled'].includes(s)

  const clearJob = async (jobId: string) => {
    try {
      await adminFetch(`/api/appstore/jobs/${encodeURIComponent(jobId)}`, token, { method: 'DELETE' })
      setJobs(current => current.filter(job => job.id !== jobId))
      toast.success('Installationseintrag entfernt')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <AdminCard
      title={activeCount > 0 ? `App-Installationen (${activeCount} aktiv)` : 'Letzte Installationen'}
      icon={DownloadSimple}
    >
      <div className="space-y-2">
        {visibleJobs.map(job => (
          <div key={job.id} className="p-2.5 rounded-lg bg-foreground/3 border border-foreground/5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">
                  {job.app_name ?? job.file_name}
                  {job.app_version && (
                    <span className="ml-1.5 text-[10px] text-foreground/40 font-normal">v{job.app_version}</span>
                  )}
                </div>
                <div className="text-[10px] text-foreground/50 truncate">{job.message}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${statusColor(job.status)}`}>
                  {statusLabel(job.status)} {job.progress > 0 && job.status !== 'succeeded' ? `· ${job.progress}%` : ''}
                </span>
                {canClear(job.status) && (
                  <button
                    type="button"
                    onClick={() => clearJob(job.id)}
                    className="p-1 rounded text-foreground/35 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                    title="Eintrag aus Letzte Installationen entfernen"
                  >
                    <X size={12} weight="bold" />
                  </button>
                )}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${barColor(job.status)}`}
                style={{ width: `${Math.max(2, Math.min(100, job.status === 'succeeded' ? 100 : job.progress))}%` }}
              />
            </div>
            {job.error && (
              <div className="mt-1.5 text-[10px] text-red-300/90 truncate" title={job.error}>
                {job.error}
              </div>
            )}
          </div>
        ))}
        {jobs.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-[10px] text-foreground/50 hover:text-foreground/80"
          >
            {open ? 'Details ausblenden' : `${jobs.length} Einträge insgesamt`}
          </button>
        )}
        {open && (
          <pre className="text-[10px] text-foreground/60 bg-foreground/[0.02] rounded p-2 max-h-60 overflow-auto">
            {jobs.flatMap(j => (j.log ?? []).map(l => `[${j.id.slice(0, 8)}] ${l}`)).join('\n')}
          </pre>
        )}
      </div>
    </AdminCard>
  )
}
