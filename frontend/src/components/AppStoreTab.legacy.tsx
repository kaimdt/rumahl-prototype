import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Cube, Lightning, Plus, Play, Pause, Stop, TrashSimple, ShieldCheck,
  DownloadSimple, Upload, MagnifyingGlass, Gear, Check,
  ShieldWarning, Package, ArrowClockwise, Info, Warning,
  Stack, CubeFocus, Sparkle, PuzzlePiece, MusicNotes, ChartBar,
  VideoCamera, Broom, Lightbulb, CalendarBlank, SpeakerHigh, Plant,
  Bell, Star, ArrowRight, CaretLeft, CaretRight, LockKey, Cloud, Globe, Briefcase, BookOpen, VideoCamera as VideoIcon, Copy, ArrowSquareOut, GameController
} from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { toast } from '@/lib/toast'
import { AppDetailDialog } from './AppDetailDialog'
import { loadTranslationBundlesFromAssets } from '@/i18n/external'
import { STORE_CATALOG } from '@/lib/storeCatalog'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { authFetch } from '@/lib/authHelpers'
import { supportedLngs } from '@/i18n'
import { consumeAppDetail, consumeAppInStore } from '@/lib/appStoreHandoff'
import { AppInstallProgress } from '@/components/app/AppInstallProgress'
import { AppStatusBadge } from '@/components/app/AppStatusBadge'
import { startAppAndWatch } from '@/lib/appLifecycle'
import { confirmDialog } from '@/components/ui/confirmDialog'

// ── Types ──────────────────────────────────────────────────────────────────

/** Store-listed app: a real backend app, a preinstalled rumahl Essential or a
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
  /** Synthetic entry for an app whose install job is still running. */
  installing?: boolean
  trust_level: 'trusted' | 'untrusted' | 'verified'
  enabled: boolean
  autostart?: boolean
  status?: string
  last_started_at?: string
  last_stopped_at?: string
  installed_at: string
  ports?: PortInfo[] | Array<string | PortInfo>
  kind?: 'app' | 'plugin' | 'system'
  /** Store category from the app manifest (store_metadata). */
  category?: string
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
  // Apps currently being installed: surfaced directly in the installed list
  // (instead of a separate progress bar) so the user always sees them.
  const { activeJobs } = useInstalledApps()
  const installingApps = useMemo<AppInfo[]>(() => activeJobs
    .filter((job) => job.appId && !apps.some((app) => app.id === job.appId))
    .map((job) => ({
      id: job.appId as string,
      name: job.appName || job.appId || '…',
      version: '',
      developer: '',
      description: '',
      trust_level: 'untrusted' as const,
      enabled: false,
      status: 'installing',
      installed_at: '',
      source: 'zip',
      kind: 'app' as const,
      icon: undefined,
      installing: true,
    })), [activeJobs, apps])
  // App detail dialog
  const [detailAppId, setDetailAppId] = useState<string | null>(null)
  // App to highlight/select in the store view ("Im App Store anzeigen").
  const [storeFocusAppId, setStoreFocusAppId] = useState<string | null>(null)
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
          const fromLocal = localStorage.getItem('rumahl-developer-mode') === 'true'
          setDevMode(osDev || fromApi || fromLocal)
        }
      } catch {
        /* not on a dev image — leave isOsDev=false */
        if (!cancelled) setDevMode(localStorage.getItem('rumahl-developer-mode') === 'true')
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

      // Final dedupe by id: the supervisor may report several containers for
      // the same app id (leftover containers of a re-install) and merging two
      // lists above can also produce duplicates. Without this, the same app
      // shows up multiple times in the installed view. The richest entry
      // (one that has a runtime status and is enabled) wins.
      {
        const byId = new Map<string, AppInfo>()
        for (const app of appList) {
          const existing = byId.get(app.id)
          if (!existing) { byId.set(app.id, app); continue }
          const rank = (candidate: AppInfo) =>
            (candidate.status === 'running' ? 4 : candidate.status ? 2 : 0) +
            (candidate.enabled ? 2 : 0) +
            (candidate.trust_level === 'trusted' ? 1 : 0)
          if (rank(app) > rank(existing)) byId.set(app.id, app)
        }
        appList = [...byId.values()]
      }

      // Ensure the rumahl Developer App appears when developer mode is active,
      // even if the backend hasn't registered it properly (frontend fallback).
      if (devMode && !appList.some(a => a.id === 'rumahl-developer-app')) {
        appList = [...appList, {
          id: 'rumahl-developer-app',
          name: 'rumahl Developer App',
          version: 'dev',
          developer: 'rumahl Project',
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

  // Mount-safe handoffs from the launcher context menu: "Fehlerbehebung"
  // opens the detail dialog, "Im App Store anzeigen" opens the store page.
  useEffect(() => {
    const showHandler = (e: CustomEvent) => {
      if (e.detail?.appId) {
        setStoreFocusAppId(e.detail.appId)
        setView('store')
      }
    }
    const pendingDetail = consumeAppDetail()
    if (pendingDetail) {
      setDetailAppId(pendingDetail)
      setView('installed')
    }
    const pendingShow = consumeAppInStore()
    if (pendingShow) setStoreFocusAppId(pendingShow)
    window.addEventListener('ora:appstore-show-app', showHandler as EventListener)
    return () => window.removeEventListener('ora:appstore-show-app', showHandler as EventListener)
  }, [])

  return (
    <div className="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="glass-card flex gap-2 rounded-3xl p-2 lg:flex-col lg:self-start">
        <button
          onClick={() => setView('installed')}
          className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-semibold transition-all ${
            view === 'installed'
              ? 'bg-accent text-white shadow-lg shadow-accent/25'
              : 'text-foreground/50 hover:text-foreground hover:bg-foreground/[0.04]'
          }`}
        >
          <Package size={14} /> Installierte Apps
        </button>
        <button
          onClick={() => setView('store')}
          className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-semibold transition-all ${
            view === 'store'
              ? 'bg-accent text-white shadow-sm'
              : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
          }`}
        >
          <Cube size={14} /> App Store
        </button>
        <button
          onClick={() => setView('upload')}
          className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-xs font-semibold transition-all ${
            view === 'upload'
              ? 'bg-accent text-white shadow-sm'
              : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
          }`}
        >
          <Upload size={14} /> ZIP hochladen
        </button>
      </aside>

      <main className="min-w-0 space-y-4">

      {/* Installed Apps View — installing apps appear inline in the list */}
      {view === 'installed' && (
        <>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage>{error}</ErrorMessage>
          ) : (
            <InstalledAppsView apps={apps} installingApps={installingApps} integrations={integrations} token={token} onReload={loadInstalled} getTrustBadge={getTrustBadge} isOsDev={isOsDev} onAppClick={setDetailAppId} />
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
          focusAppId={storeFocusAppId}
          onFocusHandled={() => setStoreFocusAppId(null)}
        />
      )}

      {/* Upload View */}
      {view === 'upload' && (
        <ZipUploadView token={token} onSuccess={() => { setView('installed'); loadInstalled() }} />
      )}

      </main>

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
  installingApps,
  integrations,
  token,
  onReload,
  getTrustBadge,
  isOsDev,
  onAppClick,
}: {
  apps: AppInfo[]
  /** Synthetic "installing" entries for running install jobs. */
  installingApps: AppInfo[]
  integrations: AppIntegrationInfo[]
  token: string
  onReload: () => void
  getTrustBadge: (level: string) => React.ReactNode
  isOsDev: boolean
  onAppClick: (appId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language?.startsWith('de') ? 'de-DE' : 'en-US'
  const { navigateToPage } = usePageNavigation()
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | 'app' | 'plugin' | 'system'>('all')
  const [installedSearch, setInstalledSearch] = useState('')
  const integrationsByApp = useMemo(
    () => new Map(integrations.map((integration) => [integration.id, integration])),
    [integrations],
  )
  const filteredApps = useMemo(() => apps.filter((app) => {
    const matchesKind = kindFilter === 'all' || (app.kind || 'app') === kindFilter
    const query = installedSearch.trim().toLowerCase()
    return matchesKind && (!query || [app.name, app.id, app.developer, app.description, app.kind]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)))
  }), [apps, installedSearch, kindFilter])

  // Installing jobs first, then the installed apps (deduplicated by id).
  const visibleApps = useMemo(() => {
    const ids = new Set(installingApps.map((app) => app.id))
    return [...installingApps, ...filteredApps.filter((app) => !ids.has(app.id))]
  }, [installingApps, filteredApps])

  const runningCount = apps.filter((app) => app.status === 'running').length
  const attentionCount = apps.filter((app) => ['error', 'failed', 'crashed', 'unhealthy'].includes(app.status || '')).length
  const updateCount = apps.filter((app) => Boolean((app as AppInfo & { update_available?: boolean }).update_available)).length

  const runAction = async (app: AppInfo, action: 'start' | 'stop' | 'restart' | 'pause' | 'enable' | 'disable') => {
    const key = `${action}-${app.id}`
    setActionLoading(key)
    try {
      const endpoint = action === 'enable' || action === 'disable'
        ? `/api/appstore/apps/${app.id}/${action}`
        : `/api/supervisor/apps/${app.id}/${action}`
      await adminFetch(endpoint, token, { method: 'POST' })
      toast.success(t(`apps.installedManagement.actionSuccess.${action}`, { name: app.name }))
      onReload()
    } catch (error) {
      toast.error(t('apps.installedManagement.actionFailed', {
        detail: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setActionLoading(null)
    }
  }

  const uninstallApp = async (app: AppInfo, force = false) => {
    const confirmKey = force && app.system ? 'forceUninstallConfirm' : 'uninstallConfirm'
    if (!(await confirmDialog({
      title: t('apps.installedManagement.uninstall'),
      message: t(`apps.installedManagement.${confirmKey}`, { name: app.name }),
      confirmLabel: t('apps.installedManagement.uninstall'),
      danger: true,
    }))) return
    setActionLoading(`uninstall-${app.id}`)
    try {
      await adminFetch(`/api/appstore/apps/${app.id}${force ? '?force=true' : ''}`, token, { method: 'DELETE' })
      toast.success(t('apps.installedManagement.actionSuccess.uninstall', { name: app.name }))
      onReload()
    } catch (error) {
      toast.error(t('apps.installedManagement.actionFailed', {
        detail: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setActionLoading(null)
    }
  }

  const filters = [
    { id: 'all' as const, label: t('common.all') },
    { id: 'app' as const, label: t('navigation.apps') },
    { id: 'plugin' as const, label: t('navigation.plugins') },
    { id: 'system' as const, label: t('admin.system') },
  ]

  return (
    <section className="space-y-5" aria-labelledby="installed-apps-title">
      <header className="flex flex-col gap-4 rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-foreground/[0.075] to-foreground/[0.025] p-5 shadow-xl shadow-black/10 backdrop-blur-2xl sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{t('apps.installedManagement.eyebrow')}</p>
          <h2 id="installed-apps-title" className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t('apps.installedManagement.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground/50">{t('apps.installedManagement.description')}</p>
        </div>
        <button type="button" onClick={onReload} className="rumahl-secondary-button self-start sm:self-auto">
          <ArrowClockwise size={15} /> {t('common.refresh')}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t('apps.overview.installed'), value: apps.length, tone: 'text-foreground' },
          { label: t('apps.overview.running'), value: runningCount, tone: 'text-emerald-300' },
          { label: t('apps.installedManagement.updates'), value: updateCount, tone: 'text-sky-300' },
          { label: t('apps.installedManagement.needsAttention'), value: attentionCount, tone: attentionCount ? 'text-amber-300' : 'text-foreground/65' },
        ].map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/10 bg-foreground/[0.035] p-4 shadow-lg shadow-black/5 backdrop-blur-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/45">{metric.label}</p>
            <p className={`mt-2 text-2xl font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-foreground/[0.035] p-3 backdrop-blur-xl lg:flex-row lg:items-center">
        <label className="rumahl-toolbar-search min-w-0 flex-1">
          <MagnifyingGlass size={17} />
          <span className="sr-only">{t('apps.overview.searchInstalled')}</span>
          <input value={installedSearch} onChange={(event) => setInstalledSearch(event.target.value)} placeholder={t('apps.overview.searchInstalled')} />
        </label>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label={t('apps.installedManagement.filterLabel')}>
          {filters.map((filter) => (
            <button key={filter.id} type="button" onClick={() => setKindFilter(filter.id)} className={`min-h-10 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition-colors ${kindFilter === filter.id ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-foreground/55 hover:bg-foreground/[0.07] hover:text-foreground'}`}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {apps.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-foreground/15 bg-foreground/[0.025] p-8 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-foreground/[0.06]"><Package size={30} weight="duotone" className="text-foreground/30" /></span>
          <h3 className="mt-4 text-base font-semibold">{t('apps.installedManagement.emptyTitle')}</h3>
          <p className="mt-1 max-w-sm text-sm text-foreground/45">{t('apps.installedManagement.emptyDescription')}</p>
        </div>
      ) : filteredApps.length === 0 && installingApps.length === 0 ? (
        <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.025] p-10 text-center text-sm text-foreground/45">{t('apps.overview.noFilteredEntries')}</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visibleApps.map((app) => {
            const integration = integrationsByApp.get(app.id)
            const busy = actionLoading?.endsWith(`-${app.id}`) || actionLoading === `uninstall-${app.id}`
            const running = app.status === 'running'
            const installing = app.installing === true || app.status === 'installing'
            const portCount = app.ports?.length || 0
            return (
              <article key={app.id} className={`group relative overflow-hidden rounded-[1.6rem] border p-5 shadow-xl shadow-black/10 backdrop-blur-2xl transition duration-200 ${installing ? 'border-amber-400/20 bg-amber-400/[0.04]' : 'border-white/10 bg-gradient-to-br from-foreground/[0.065] to-foreground/[0.025] hover:-translate-y-0.5 hover:border-white/20 hover:shadow-2xl'}`}>
                <button type="button" onClick={() => { if (!installing) onAppClick(app.id) }} className={`flex w-full items-start gap-4 text-left focus-ring rounded-xl ${installing ? 'cursor-default' : ''}`}>
                  <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent/35 to-accent/10 text-accent shadow-lg ring-1 ring-white/10">
                    {app.icon ? <img src={app.icon} alt="" className="h-full w-full object-cover" /> : installing ? <InlineSpinner size={26} /> : <Cube size={30} weight="duotone" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-base font-semibold text-foreground">{app.name}</strong>
                      {installing
                        ? <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[9px] font-semibold text-amber-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />{t('apps.appStore.installing', { name: '' }).trim()}</span>
                        : <AppStatusBadge status={app.status} compact />}
                    </span>
                    <span className="mt-1 block truncate text-xs text-foreground/45">{t('apps.installedManagement.versionByDeveloper', { version: app.version, developer: app.developer || 'rumahl OS' })}</span>
                    <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-foreground/50">{installing ? t('apps.installedManagement.installingDescription') : app.description}</span>
                  </span>
                  <CaretRight size={18} className={`mt-1 shrink-0 text-foreground/25 transition-transform ${installing ? '' : 'group-hover:translate-x-0.5'}`} />
                </button>

                <div className="mt-4 grid grid-cols-2 gap-2 border-y border-white/[0.07] py-3 sm:grid-cols-4">
                  <div><p className="text-[9px] uppercase tracking-wider text-foreground/35">{t('apps.installedManagement.health')}</p><p className={`mt-1 text-xs font-semibold ${running ? 'text-emerald-300' : 'text-foreground/55'}`}>{running ? t('apps.installedManagement.healthy') : t('apps.installedManagement.inactive')}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wider text-foreground/35">{t('apps.ports')}</p><p className="mt-1 text-xs font-semibold tabular-nums text-foreground/65">{portCount}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wider text-foreground/35">{t('apps.cpu')}</p><p className="mt-1 text-xs font-semibold tabular-nums text-foreground/65">{app.docker?.cpu_percent === undefined ? '—' : `${app.docker.cpu_percent}%`}</p></div>
                  <div><p className="text-[9px] uppercase tracking-wider text-foreground/35">{t('apps.memory')}</p><p className="mt-1 text-xs font-semibold tabular-nums text-foreground/65">{app.docker?.memory_mb === undefined ? '—' : `${app.docker.memory_mb} MB`}</p></div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-foreground/45">
                  {getTrustBadge(app.trust_level)}
                  {app.is_bundle && <span className="inline-flex items-center gap-1 rounded-full bg-violet-400/10 px-2 py-1 text-violet-300"><Stack size={11} />{t('apps.installedManagement.bundle')}</span>}
                  {app.system && <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-1 text-sky-300"><ShieldCheck size={11} />{t('apps.systemApp')}</span>}
                  {(integration?.surfaces?.length || 0) > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/10 px-2 py-1 text-cyan-300"><Lightning size={11} />{integration?.surfaces?.length} {t('apps.overview.integrations')}</span>}
                  <span className="ml-auto">{installing ? t('apps.appStore.installing', { name: '' }).trim() : `${t('apps.overview.installedAt')}: ${new Date(app.installed_at).toLocaleDateString(locale)}`}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                  {installing && <span className="inline-flex min-h-[2.65rem] items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.07] px-3 text-xs font-semibold text-amber-300"><InlineSpinner size={13} />{t('apps.appStore.installing', { name: '' }).trim()}</span>}
                  {!installing && running && <button type="button" onClick={() => { window.location.href = `/app/${encodeURIComponent(app.id)}` }} className="rumahl-primary-button"><ArrowSquareOut size={14} />{t('apps.installedManagement.open')}</button>}
                  {!installing && !app.system && (running
                    ? <button type="button" disabled={busy} onClick={() => void runAction(app, 'stop')} className="rumahl-secondary-button">{actionLoading === `stop-${app.id}` ? <InlineSpinner size={13} /> : <Stop size={14} />}{t('apps.installedManagement.stop')}</button>
                    : <button type="button" disabled={busy || app.status === 'starting' || app.status === 'installing'} onClick={() => void runAction(app, 'start')} className="rumahl-primary-button">{actionLoading === `start-${app.id}` ? <InlineSpinner size={13} /> : <Play size={14} />}{t('apps.installedManagement.start')}</button>)}
                  {!installing && !app.system && running && <button type="button" disabled={busy} onClick={() => void runAction(app, 'restart')} className="rumahl-secondary-button">{actionLoading === `restart-${app.id}` ? <InlineSpinner size={13} /> : <ArrowClockwise size={14} />}{t('apps.installedManagement.restart')}</button>}
                  {!installing && !app.system && running && (app.docker || app.docker_config || app.is_bundle) && <button type="button" disabled={busy} onClick={() => void runAction(app, 'pause')} className="rumahl-secondary-button">{actionLoading === `pause-${app.id}` ? <InlineSpinner size={13} /> : <Pause size={14} />}{t('apps.installedManagement.pause')}</button>}
                  {!installing && !app.system && <button type="button" disabled={busy} onClick={() => void runAction(app, app.enabled ? 'disable' : 'enable')} className="rumahl-secondary-button">{actionLoading === `${app.enabled ? 'disable' : 'enable'}-${app.id}` ? <InlineSpinner size={13} /> : app.enabled ? <Pause size={14} /> : <Play size={14} />}{t(`apps.installedManagement.${app.enabled ? 'disable' : 'enable'}`)}</button>}
                  {!installing && <button type="button" onClick={() => { navigateToPage('settings', `apps/${encodeURIComponent(app.id)}`) }} className="rumahl-secondary-button"><Gear size={14} />{t('settings.title')}</button>}
                  {!installing && !app.system && <button type="button" disabled={busy} onClick={() => void uninstallApp(app)} className="inline-flex min-h-[2.65rem] items-center gap-2 rounded-xl border border-red-400/15 bg-red-400/[0.07] px-3 text-xs font-semibold text-red-300 transition hover:bg-red-400/15 disabled:opacity-40">{actionLoading === `uninstall-${app.id}` ? <InlineSpinner size={13} /> : <TrashSimple size={14} />}{t('apps.installedManagement.uninstall')}</button>}
                  {!installing && app.system && isOsDev && <button type="button" disabled={busy} onClick={() => void uninstallApp(app, true)} className="inline-flex min-h-[2.65rem] items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/[0.07] px-3 text-xs font-semibold text-amber-300 transition hover:bg-amber-400/15 disabled:opacity-40"><TrashSimple size={14} />{t('apps.installedManagement.forceUninstall')}</button>}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
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
  focusAppId,
  onFocusHandled,
}: {
  token: string
  searchQuery: string
  setSearchQuery: (q: string) => void
  apps: AppInfo[]
  onAppClick: (appId: string) => void
  onInstalled: () => void
  /** App requested via "Im App Store anzeigen" from the launcher. */
  focusAppId: string | null
  onFocusHandled: () => void
}) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()
  const { activeJobs, failedJobs } = useInstalledApps()
  const [torOnions, setTorOnions] = useState<Record<string, string> | null>(null)

  // Tor hidden-service addresses for installed apps (Umbrel-style).
  useEffect(() => {
    let cancelled = false
    authFetch('/api/tor/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { onions?: Record<string, string> } | null) => {
        if (!cancelled && data?.onions) setTorOnions(data.onions)
      })
      .catch(() => { /* tor may be unavailable */ })
    return () => { cancelled = true }
  }, [])
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const [selectedApp, setSelectedApp] = useState<StoreApp | null>(null)

  // ── rumahl Essentials — only real user-facing apps (Docs, Share, Streaming) ──
  const essentials: StoreApp[] = useMemo(() => [
    { id: 'docs', name: t('os.apps.docs.name'), developer: 'rumahl OS', description: t('os.apps.docs.description'), version: '2.0', trust_level: 'trusted', enabled: true, installed_at: '', kind: 'app', isEssential: true, pageId: 'docs', iconUrl: svgIconData('oklch(0.6 0.15 250)', 'D') },
    { id: 'share', name: t('os.apps.share.name'), developer: 'rumahl OS', description: t('os.apps.share.description'), version: '2.0', trust_level: 'trusted', enabled: true, installed_at: '', kind: 'app', isEssential: true, pageId: 'share', iconUrl: svgIconData('oklch(0.62 0.18 300)', 'S') },
    { id: 'streaming', name: t('os.apps.streaming.name'), developer: 'rumahl OS', description: t('os.apps.streaming.description'), version: '2.0', trust_level: 'trusted', enabled: true, installed_at: '', kind: 'app', isEssential: true, pageId: 'streaming', iconUrl: svgIconData('oklch(0.62 0.18 15)', '▶') },
  ], [t])

  // Store apps = real backend apps (no system apps) + Essentials + Docker catalog.
  const storeApps = useMemo<StoreApp[]>(() => {
    const backend: StoreApp[] = apps.filter((app) => app.kind !== 'system')
    // Once a catalog app is installed it comes back via the backend list —
    // don't show it twice.
    const catalog: StoreApp[] = STORE_CATALOG
      .filter((def) => !backend.some((b) => b.id === def.id && b.enabled))
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
    // Dedupe by id: a backend entry (installed app) wins over its catalog
    // twin, so the list never contains the same app id twice (React keys
    // must be unique). This can happen when a catalog app is installed but
    // not marked enabled (failed start) - it would otherwise appear both as
    // a backend entry and as a catalog card.
    const seen = new Set<string>()
    const deduped: StoreApp[] = []
    for (const app of [...backend, ...essentials, ...catalog]) {
      if (seen.has(app.id)) continue
      seen.add(app.id)
      deduped.push(app)
    }
    return deduped
  }, [apps, essentials, t])

  // "Im App Store anzeigen" from the launcher context menu: select the
  // requested app once it shows up in the store list (apps load async).
  useEffect(() => {
    if (!focusAppId) return
    const app = storeApps.find((candidate) => candidate.id === focusAppId)
    if (!app) return
    setSelectedApp(app)
    setActiveCategory('all')
    setSearchQuery('')
    onFocusHandled()
  }, [focusAppId, storeApps, onFocusHandled])
  // During a fresh install an extracted manifest is already present in the
  // backend, but the app is not installed from the user's perspective until
  // its runtime is verified as running.
  const installedIds = useMemo(() => new Set(apps.filter((app) => app.status === 'running').map((app) => app.id)), [apps])

  /** Normalized store category per app (Umbrel-style). */
  const categoryOf = (app: StoreApp): string => {
    if (app.isEssential) {
      if (app.id === 'docs') return 'docs'
      if (app.id === 'share') return 'productivity'
      if (app.id === 'streaming') return 'media'
      return 'apps'
    }
    if (app.isCatalog) {
      const cat = STORE_CATALOG.find((def) => def.id === app.id)?.category?.toLowerCase()
      return cat || 'apps'
    }
    const cat = app.category?.toLowerCase()
    if (!cat || cat === 'all') return 'apps'
    return cat
  }

  // Category chips derive from the real data (Umbrel store style).
  const CATEGORY_ICONS: Record<string, typeof Sparkle> = {
    cloud: Cloud, browser: Globe, media: Play, productivity: Briefcase, docs: BookOpen, apps: PuzzlePiece, automation: Lightning,
    security: ShieldCheck, monitoring: ChartBar, games: GameController,
  }
  const categories = useMemo(() => {
    const list: Array<{ id: string; label: string; icon: typeof Sparkle }> = [
      { id: 'all', label: t('apps.appStore.forYou'), icon: Sparkle },
    ]
    const seen = new Set<string>(['all'])
    for (const app of storeApps) {
      const cat = categoryOf(app)
      if (seen.has(cat)) continue
      seen.add(cat)
      list.push({ id: cat, label: t(`apps.appStore.category.${cat}` as never, { defaultValue: cat }), icon: CATEGORY_ICONS[cat] || PuzzlePiece })
    }
    return list
  }, [storeApps, t])

  // Search + category filter over the real apps.
  const filteredApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return storeApps.filter((app) => {
      if (activeCategory !== 'all' && categoryOf(app) !== activeCategory) return false
      if (!query) return true
      return [app.name, app.id, app.developer, app.description]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query))
    })
  }, [storeApps, activeCategory, searchQuery, categoryOf])

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
      md: 'h-12 w-12 rounded-[26%]',
      lg: 'h-14 w-14 rounded-[26%]',
      xl: 'h-16 w-16 rounded-[26%]',
    }[size]
    const imgSrc = app.iconUrl || (app.icon && /^(https?:|data:)/.test(app.icon) ? app.icon : undefined)
    if (installing) {
      return (
        <AppInstallProgress
          appId={app.id}
          iconUrl={imgSrc}
          label={app.name}
          progress={progress}
          size={size === 'md' ? 'compact' : size === 'lg' ? 'small' : 'medium'}
        />
      )
    }
    return (
      <span className={`${classes} relative shrink-0 overflow-hidden ${imgSrc ? 'shadow-none' : 'shadow-lg'}`}>
        {imgSrc ? (
          <img src={imgSrc} alt={app.name} className="h-full w-full object-cover" />
        ) : (
          <span className={`flex h-full w-full items-center justify-center text-lg font-bold text-white`} style={gradientFor(app.id)}>
            {app.name.trim().charAt(0).toUpperCase() || '?'}
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
  const [installJobByApp, setInstallJobByApp] = useState<Record<string, string>>({})
  const [startingId, setStartingId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  /** Pull the newest image + restart the container (Umbrel-style update). */
  const updateApp = (app: StoreApp) => {
    if (updatingId) return
    setUpdatingId(app.id)
    adminFetch(`/api/supervisor/apps/${app.id}/restart`, token, { method: 'POST' })
      .then(() => { window.setTimeout(onInstalled, 2500) })
      .catch((e) => toast.error(t('apps.appStore.installFailed', { detail: e instanceof Error ? e.message : String(e) })))
      .finally(() => setUpdatingId(null))
  }

  /** Backend entry for a catalog app (present once installed). */
  const backendAppFor = (app: StoreApp) => apps.find((candidate) => candidate.id === app.id)

  /** True while an install job for this app is still running — the app must
   *  NOT be startable/openable in that state (half-installed container). */
  const installActive = (app: StoreApp) =>
    installingId === app.id || activeJobs.some((job) => job.appId === app.id)

  /** True for any installed (non-essential) app — shows uninstall + start. */
  const isInstalledApp = (app: StoreApp) => !app.isEssential && isRunning(app)

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

  const failedInstallFor = (appId: string) => {
    const currentJobId = installJobByApp[appId]
    return currentJobId
      ? failedJobs.find((job) => job.id === currentJobId)
      : failedJobs.find((job) => job.appId === appId)
  }

  useEffect(() => {
    if (!installingId) return
    const job = activeJobs.find((candidate) => candidate.appId === installingId)
    const app = apps.find((candidate) => candidate.id === installingId)
    const failedJobId = installJobByApp[installingId]
    const failedJob = failedJobs.some((candidate) => candidate.appId === installingId || candidate.id === failedJobId)
    if (job || failedJob || app?.status === 'running' || app?.status === 'error' || app?.status === 'failed') {
      setInstallingId(null)
    }
  }, [activeJobs, apps, failedJobs, installJobByApp, installingId])

  /** Docker apps count as installed only while RUNNING. */
  const isRunning = (app: StoreApp) => {
    const backend = backendAppFor(app)
    return app.isEssential || Boolean(backend?.status === 'running' || (backend?.enabled && backend.status === 'running'))
  }

  /** Installs a catalog (Docker) app via the existing ZIP install API. */
  const installCatalogApp = async (app: StoreApp) => {
    const def = STORE_CATALOG.find((d) => d.id === app.id)
    if (!def) return
    // Dependency check: required apps must be installed & running first.
    const missing = (def.requires || []).filter((requiredId) => !apps.some((a) => a.id === requiredId && a.status === 'running'))
    if (missing.length > 0) {
      const names = missing.map((id) => STORE_CATALOG.find((d) => d.id === id)?.name || id).join(', ')
      toast.error(t('apps.appStore.installRequires', { apps: names }))
      return
    }
    setInstallingId(app.id)
    try {
      const zipData = def.buildZip()
      const installResult = await adminFetch('/api/appstore/install', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          zip_data: zipData,
          file_name: `${app.id}.zip`,
          granted_permissions: def.permissions,
          denied_permissions: [],
        }),
      }) as { install_id?: string }
      if (installResult.install_id) {
        setInstallJobByApp((current) => ({ ...current, [app.id]: installResult.install_id! }))
      }
      toast.success(t('apps.appStore.installStarted', { name: app.name }))
      // UmbrelOS-style lifecycle polling: download → install → running, with
      // the failure state surfaced to the user (toast + inline error) instead
      // of only appearing in the install-job log.
      let attempts = 0
      let polling = false
      let failedMessage: string | null = null
      const poll = window.setInterval(async () => {
        if (polling) return
        polling = true
        attempts += 1
        onInstalled()
        let completed = false
        try {
          const snapshot = await adminFetch('/api/supervisor/apps', token) as { apps?: AppInfo[] }
          const installed = snapshot.apps?.find((candidate) => candidate.id === app.id)
          if (installed?.status === 'error' || installed?.status === 'failed') {
            failedMessage = installed.error_message || t('apps.appStore.installFailedUnknown')
          }
          completed = installed?.status === 'running' || Boolean(failedMessage)
        } catch {
          // The shared installed-app hook retains the last state while offline.
        } finally {
          polling = false
        }
        if (completed || attempts > 40) {
          window.clearInterval(poll)
          // Always reset the in-progress state when the watcher gives up —
          // otherwise a slow image pull that exceeds the watch window leaves
          // the "installing" spinner stuck forever.
          setInstallingId(null)
          if (failedMessage) {
            toast.error(t('apps.appStore.installFailed', { detail: failedMessage }))
          }
        }
      }, 2500)
    } catch (e) {
      setInstallingId(null)
      toast.error(t('apps.appStore.installFailed', { detail: e instanceof Error ? e.message : String(e) }))
    }
  }

  /** Start a stopped app (installed but not running) — watches the runtime
   *  state and surfaces a failed container start instead of staying silent. */
  const startApp = (app: StoreApp) => {
    if (startingId) return
    setStartingId(app.id)
    void startAppAndWatch(app.id, { onSettled: () => { setStartingId(null); window.setTimeout(onInstalled, 500) } })
  }

  /** Umbrel-style dependency check: warn if other catalog apps need this one. */
  const dependentsOf = (appId: string) =>
    STORE_CATALOG.filter((def) => def.requires?.includes(appId)).filter((def) => apps.some((a) => a.id === def.id))

  /** Uninstall an installed app (stops container + removes app data). */
  const uninstallApp = async (app: StoreApp) => {
    const dependents = dependentsOf(app.id)
    const confirmUninstall = () => confirmDialog({
      title: t('apps.appStore.uninstall'),
      message: dependents.length > 0
        ? t('apps.appStore.uninstallDependents', { name: app.name, apps: dependents.map((d) => d.name).join(', ') })
        : t('apps.appStore.uninstallConfirm', { name: app.name }),
      confirmLabel: t('apps.appStore.uninstall'),
      danger: true,
    })
    if (!(await confirmUninstall())) return
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
      if (installActive(app)) return
      if (isRunning(app)) return openApp(app)
      const backend = backendAppFor(app)
      if (backend) return startApp(app)
      return installCatalogApp(app)
    }
    // Backend-installed app: running → open; enabled-but-stopped → start.
    if (installActive(app)) return
    if (app.status === 'running') return openApp(app)
    if (app.enabled) return startApp(app)
    return onAppClick(app.id)
  }

  const actionLabel = (app: StoreApp) => {
    if (app.isEssential) return t('apps.appStore.openApp')
    if (app.isCatalog) {
      if (installActive(app)) return t('apps.appStore.installing', { name: '' }).trim()
      if (startingId === app.id) return t('apps.appStore.starting', { name: '' }).trim()
      if (failedInstallFor(app.id) && !isRunning(app)) return t('apps.appStore.retry')
      if (isRunning(app)) return t('apps.appStore.openApp')
      if (backendAppFor(app)) return t('apps.appStore.start')
      return t('apps.appStore.install')
    }
    if (installActive(app)) return t('apps.appStore.installing', { name: '' }).trim()
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
    const installJob = activeJobs.find((job) => job.appId === app.id || job.id === installJobByApp[app.id])
    const failedInstall = failedInstallFor(app.id)
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

        {failedInstall && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-red-200">
            <Warning size={20} weight="fill" className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t('apps.appStore.installFailedTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-red-100/65">{failedInstall.error || failedInstall.message || t('apps.appStore.installFailedUnknown')}</p>
            </div>
          </div>
        )}

        {(installingId === app.id || installJob) && (
          <div className="rounded-2xl border border-accent/20 bg-accent/[0.08] p-4 shadow-lg shadow-accent/5 backdrop-blur-xl" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <InlineSpinner size={18} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{t('apps.appStore.installing', { name: app.name })}</p>
                  <p className="mt-0.5 truncate text-xs text-foreground/45">{installJob?.message || t('apps.appStore.installPreparing')}</p>
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-accent">{Math.round(installJob?.progress ?? 12)}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full rounded-full bg-accent shadow-[0_0_14px_color-mix(in_oklch,var(--accent)_55%,transparent)] transition-[width] duration-500" style={{ width: `${Math.max(3, Math.min(100, installJob?.progress ?? 12))}%` }} />
            </div>
          </div>
        )}

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
                  disabled={installActive(app) || startingId === app.id}
                  className="rounded-full bg-white px-7 py-3 text-xs font-bold text-slate-900 shadow-xl transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-60"
                >
                  {actionLabel(app)}
                </button>
                {isInstalledApp(app) && (
                  <>
                    <button
                      type="button"
                      onClick={() => updateApp(app)}
                      disabled={updatingId === app.id}
                      className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-3 text-xs font-bold text-white ring-1 ring-white/30 backdrop-blur-md transition-colors hover:bg-white/20 disabled:opacity-60"
                    >
                      <ArrowClockwise size={13} weight="bold" className={updatingId === app.id ? 'animate-spin' : ''} />
                      {updatingId === app.id ? t('apps.appStore.updating') : t('apps.appStore.update')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void uninstallApp(app)}
                      className="flex items-center gap-1.5 rounded-full bg-black/30 px-4 py-3 text-xs font-bold text-white ring-1 ring-white/30 backdrop-blur-md transition-colors hover:bg-red-500/70"
                    >
                      <TrashSimple size={13} weight="bold" />
                      {t('apps.appStore.uninstall')}
                    </button>
                  </>
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
          {(() => {
            const creds = STORE_CATALOG.find((def) => def.id === app.id)?.defaultCredentials
            if (!creds) return null
            return (
              <div className="rounded-[1.5rem] border border-amber-500/15 bg-amber-500/[0.06] p-5 sm:p-6">
                <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <LockKey size={15} className="text-amber-400" />
                  {t('apps.appStore.defaultCredentials')}
                </h4>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground/55">{t('apps.appStore.defaultCredentialsHint')}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-black/20 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-foreground/40">{t('apps.appStore.username')}</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">{creds.username}</p>
                  </div>
                  <div className="rounded-xl bg-black/20 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-foreground/40">{t('apps.appStore.password')}</p>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">{creds.password}</p>
                  </div>
                </div>
              </div>
            )
          })()}
          {torOnions?.[app.id] && (
            <div className="rounded-[1.5rem] border border-violet-500/20 bg-violet-500/[0.07] p-5 sm:p-6">
              <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Globe size={15} className="text-violet-400" />
                {t('apps.appStore.torAddress')}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground/55">{t('apps.appStore.torHint')}</p>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(`http://${torOnions[app.id]}`) }}
                className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl bg-black/20 px-3 py-2.5 font-mono text-xs font-semibold text-violet-200 transition-colors hover:bg-black/30"
              >
                <span className="truncate">{torOnions[app.id]}</span>
                <Copy size={13} className="shrink-0 text-violet-400" />
              </button>
            </div>
          )}
          <div className="space-y-2">
            {[
              { label: t('apps.appStore.developer'), value: app.developer },
              { label: t('apps.appStore.version'), value: app.version },
              { label: t('apps.appStore.source'), value: app.isEssential ? 'rumahl OS' : (app.source || 'Local') },
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
    <div className="space-y-8 rounded-4xl bg-background/85 p-4 shadow-2xl ring-1 ring-foreground/8 backdrop-blur-2xl sm:p-7">
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">rumahl OS</p>
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
                        disabled={installActive(app)}
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
                        disabled={installActive(app) || startingId === app.id}
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

          {/* ─── App gallery – visual storefront browsing ─────── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                <span className="h-4 w-1 rounded-full bg-accent" />
                {t('apps.appStore.browseAll')}
              </h3>
              <span className="rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[10px] font-semibold text-foreground/45">
                {filteredApps.length}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredApps.map((app) => {
                const installed = installedIds.has(app.id)
                const failed = failedInstallFor(app.id)
                const showFailed = Boolean(failed) && installingId !== app.id && !isRunning(app)
                return (
                  <article
                    key={app.id}
                    onClick={() => setSelectedApp(app)}
                    className={`group relative cursor-pointer overflow-hidden rounded-[1.5rem] border p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/10 ${
                      showFailed
                        ? 'border-red-400/25 bg-red-500/[0.05] hover:border-red-400/40'
                        : 'border-foreground/8 bg-foreground/[0.035] hover:border-accent/25 hover:bg-foreground/[0.065]'
                    }`}
                  >
                    <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-accent/10 blur-2xl transition-opacity group-hover:opacity-100" />
                    <div className="relative flex items-start gap-3.5">
                      <StoreAppIcon app={app} size="lg" {...iconStatus(app)} />
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-bold text-foreground">{app.name}</h4>
                        <p className="mt-0.5 truncate text-[11px] text-foreground/45">{app.developer}</p>
                        <div className="mt-2">{trustBadge(app)}</div>
                      </div>
                    </div>
                    <p className="relative mt-4 line-clamp-2 min-h-9 text-xs leading-relaxed text-foreground/55">{app.description}</p>
                    {showFailed && (
                      <p className="relative mt-3 flex items-start gap-1.5 rounded-xl border border-red-400/15 bg-red-500/[0.06] p-2.5 text-[11px] leading-relaxed text-red-200/90">
                        <Warning size={13} weight="fill" className="mt-0.5 shrink-0 text-red-400" />
                        <span className="line-clamp-2">{failed?.error || failed?.message || t('apps.appStore.installFailedUnknown')}</span>
                      </p>
                    )}
                    <div className="relative mt-4 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-foreground/[0.06] px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-foreground/45">
                        {t(`apps.appStore.category.${categoryOf(app)}` as never, { defaultValue: categoryOf(app) })}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); primaryAction(app) }}
                        disabled={installActive(app) || startingId === app.id}
                        className={`rounded-full px-4 py-2 text-[11px] font-bold transition-colors disabled:opacity-60 ${
                          app.isEssential || installed ? 'bg-foreground/8 text-foreground/60' : 'bg-accent text-white shadow-md shadow-accent/20 hover:bg-accent/90'
                        }`}
                      >
                        {actionLabel(app)}
                      </button>
                    </div>
                  </article>
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
                          disabled={installActive(app) || startingId === app.id}
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
  const { t } = useTranslation()
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
            // UmbrelOS-style watcher: surface a later job failure with a toast
            // instead of leaving it in the install-job log only.
            const appId = manifest?.id
            if (appId) {
              let attempts = 0
              const poll = window.setInterval(async () => {
                attempts += 1
                try {
                  const snapshot = await adminFetch('/api/supervisor/apps', token) as { apps?: AppInfo[] }
                  const installed = snapshot.apps?.find((candidate) => candidate.id === appId)
                  if (installed?.status === 'error' || installed?.status === 'failed') {
                    window.clearInterval(poll)
                    toast.error(t('apps.appStore.installFailed', {
                      detail: installed.error_message || t('apps.appStore.installFailedUnknown'),
                    }))
                  } else if (installed?.status === 'running' || attempts > 40) {
                    window.clearInterval(poll)
                  }
                } catch {
                  // offline — keep polling
                }
              }, 2500)
            }
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

