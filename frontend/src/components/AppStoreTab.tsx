import { useTranslation } from 'react-i18next'
import { useState, useCallback, useEffect } from 'react'
import {
  Cube, Lightning, Plus, Play, Pause, TrashSimple, ShieldCheck,
  DownloadSimple, Upload, MagnifyingGlass, Gear, Check, X,
  ShieldWarning, Package, ArrowClockwise, Info, Warning,
  Stack, CubeFocus
} from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { toast } from 'sonner'
import { AppDetailDialog } from './AppDetailDialog'

// ── Types ──────────────────────────────────────────────────────────────────

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
  ports?: PortInfo[]
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
}

interface PortInfo {
  internal: number
  external: number
  protocol: string
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
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token, devMode])

  useEffect(() => {
    if (view === 'installed') {
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
        <AppStoreView token={token} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
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
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const integrationsByApp = new Map(integrations.map(integration => [integration.id, integration]))

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
    const url = openUrl || `/apps/${appId}`
    // Use the router to navigate to the app's page
    window.location.href = url
  }

  return (
    <div className="space-y-3">
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
          {apps.map((app) => (
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
                      onClick={() => window.open(`/app-settings/${app.id}`, '_blank')}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors"
                    >
                      <Gear size={12} /> Einstellungen
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
                Installiert: {new Date(app.installed_at).toLocaleDateString('de-DE', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                })}
                {app.last_started_at && (
                  <span className="ml-2">
                    · Letzter Start: {new Date(app.last_started_at).toLocaleDateString('de-DE', {
                      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                )}
              </div>
            </div>
              )
            })()
          ))}
        </div>
      )}
    </div>
  )
}

// ── App Store View ───────────────────────────────────────────────────────

function AppStoreView({
  token,
  searchQuery,
  setSearchQuery
}: {
  token: string
  searchQuery: string
  setSearchQuery: (q: string) => void
}) {
  const [activeCategory, setActiveCategory] = useState('Alle')

  const categories = [
    { id: 'Alle', label: 'Für dich', icon: '✨' },
    { id: 'Widgets', label: 'Widgets', icon: '🧩' },
    { id: 'Automation', label: 'Automation', icon: '⚡' },
    { id: 'Media', label: 'Media', icon: '🎵' },
    { id: 'Security', label: 'Security', icon: '🛡️' },
    { id: 'Energy', label: 'Energy', icon: '⚡' },
    { id: 'Monitoring', label: 'Monitoring', icon: '📊' },
  ]

  // Featured apps (hardcoded for now, will come from store API)
  const featuredApps = [
    { id: 'weather', name: 'Wetter Pro', dev: 'IORA Labs', rating: 4.8, icon: '🌤️', color: 'from-blue-500/20 to-cyan-500/10' },
    { id: 'energy', name: 'Energy Monitor', dev: 'IORA Labs', rating: 4.6, icon: '⚡', color: 'from-amber-500/20 to-yellow-500/10' },
    { id: 'security', name: 'Security Cam', dev: 'IORA Labs', rating: 4.9, icon: '📹', color: 'from-red-500/20 to-rose-500/10' },
  ]

  const popularApps = [
    { id: 'vacuum', name: 'Vacuum Control', dev: 'Community', rating: 4.5, downloads: '2.3k', icon: '🧹' },
    { id: 'lights', name: 'Light Scenes', dev: 'IORA', rating: 4.7, downloads: '5.1k', icon: '💡' },
    { id: 'calendar', name: 'Family Calendar', dev: 'Community', rating: 4.3, downloads: '1.8k', icon: '📅' },
    { id: 'music', name: 'Multiroom Audio', dev: 'IORA', rating: 4.4, downloads: '3.2k', icon: '🔊' },
    { id: 'garden', name: 'Garden Planner', dev: 'Community', rating: 4.2, downloads: '980', icon: '🌱' },
    { id: 'notify', name: 'Notify Me', dev: 'IORA Labs', rating: 4.6, downloads: '4.1k', icon: '🔔' },
  ]

  return (
    <div className="space-y-6">
      {/* ─── Search Bar ──────────────────────────────────── */}
      <div className="relative">
        <MagnifyingGlass size={16} weight="bold" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground/30" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Nach Apps, Widgets & Plugins suchen..."
          className="w-full pl-10 pr-4 py-3 rounded-xl glass-card text-sm text-foreground placeholder:text-foreground/25 focus:outline-none focus:ring-2 focus:ring-accent/30 transition-all"
        />
      </div>

      {/* ─── Category Pills ──────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium transition-all ${
              activeCategory === cat.id
                ? 'bg-accent text-white shadow-lg shadow-accent/25'
                : 'glass-card text-foreground/60 hover:text-foreground hover:border-foreground/15'
            }`}
          >
            <span className="text-sm">{cat.icon}</span>
            {cat.label}
          </button>
        ))}
      </div>

      {/* ─── Featured Banner ─────────────────────────────── */}
      <div>
        <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
          <span className="w-1 h-4 rounded-full bg-accent" />
          Empfohlen
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {featuredApps.map(app => (
            <div
              key={app.id}
              className={`relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br ${app.color} border border-foreground/5 hover:border-accent/30 transition-all cursor-pointer group`}
              style={{ backdropFilter: 'blur(20px)' }}
            >
              <div className="text-3xl mb-3">{app.icon}</div>
              <h4 className="text-sm font-bold text-foreground">{app.name}</h4>
              <p className="text-[10px] text-foreground/50 mt-0.5">{app.dev}</p>
              <div className="flex items-center gap-1 mt-3">
                <span className="text-[10px] text-amber-400">★</span>
                <span className="text-[10px] font-medium text-foreground/70">{app.rating}</span>
              </div>
              {/* Glass shimmer on hover */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Popular Apps Grid ───────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-accent" />
            Beliebt
          </h3>
          <button className="text-[10px] font-medium text-accent hover:text-accent/80 transition-colors">
            Alle anzeigen →
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {popularApps.map(app => (
            <div
              key={app.id}
              className="glass-card rounded-2xl p-4 hover:scale-[1.02] transition-all cursor-pointer group text-center"
            >
              <div className="text-3xl mb-2.5 mx-auto w-14 h-14 rounded-2xl bg-foreground/[0.04] flex items-center justify-center group-hover:bg-foreground/[0.08] transition-colors">
                {app.icon}
              </div>
              <h4 className="text-xs font-semibold text-foreground truncate">{app.name}</h4>
              <p className="text-[10px] text-foreground/40 mt-0.5">{app.dev}</p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className="text-[10px] text-amber-400">★ {app.rating}</span>
                <span className="text-[9px] text-foreground/25">{app.downloads}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Coming Soon Banner ──────────────────────────── */}
      <div className="glass-card rounded-2xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
          <Cube size={24} className="text-accent" weight="fill" />
        </div>
        <div className="flex-1">
          <h4 className="text-xs font-semibold text-foreground">Vollständiger App Store kommt bald</h4>
          <p className="text-[10px] text-foreground/40 mt-0.5">
            Integration mit appstore.kaimdt.com – tausende Apps, Widgets & Plugins direkt installierbar.
          </p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-accent/10 text-accent font-medium">Coming Soon</span>
      </div>
    </div>
  )
}

// ── ZIP Upload View ───────────────────────────────────────────────────────

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
