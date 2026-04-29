import { useState, useCallback, useEffect } from 'react'
import {
  Cube, Lightning, Plus, Play, Pause, TrashSimple, ShieldCheck,
  DownloadSimple, Upload, MagnifyingGlass, Gear, Check, X,
  ShieldWarning, Package, ArrowClockwise, Info, Warning
} from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { toast } from 'sonner'
import { extractManifestFromZip } from '../lib/zip'
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
  status?: string
  installed_at: string
  ports?: PortInfo[]
  kind?: 'app' | 'plugin' | 'system'
  system?: boolean
  source?: string
  open_url?: string
  custom_pages?: CustomPage[]
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
  const [view, setView] = useState<'installed' | 'store' | 'upload'>('installed')
  const [apps, setApps] = useState<AppInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  // App detail dialog
  const [detailAppId, setDetailAppId] = useState<string | null>(null)
  // On OS-dev images the Developer App may replace/delete *any* app,
  // including system apps. We probe the dev-image marker once on mount.
  const [isOsDev, setIsOsDev] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const info = await adminFetch('/api/admin/dev-image', token) as { is_os_dev?: boolean }
        if (!cancelled) setIsOsDev(Boolean(info?.is_os_dev))
      } catch {
        /* not on a dev image — leave isOsDev=false */
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const loadInstalled = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Try supervisor endpoint first (has status, custom_pages, etc.)
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
          // Merge trust_level from local appstore into supervisor data
          const localMap = new Map(localData.apps.map(a => [a.id, a]))
          data.apps = (data.apps || []).map(app => {
            const local = localMap.get(app.id)
            if (local) {
              return { ...app, trust_level: local.trust_level || 'untrusted' }
            }
            return app
          })
        }
      } catch { /* ignore */ }
      setApps(data.apps || [])
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }, [token])

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

  return (
    <div className="space-y-3">
      {/* View Switcher */}
      <div className="flex gap-2 p-1 bg-foreground/5 rounded-lg">
        <button
          onClick={() => setView('installed')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-all ${
            view === 'installed'
              ? 'bg-accent text-white shadow-sm'
              : 'text-foreground/60 hover:text-foreground hover:bg-foreground/5'
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
            <InstalledAppsView apps={apps} token={token} onReload={loadInstalled} getTrustBadge={getTrustBadge} isOsDev={isOsDev} onAppClick={setDetailAppId} />
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
  token,
  onReload,
  getTrustBadge,
  isOsDev,
  onAppClick,
}: {
  apps: AppInfo[]
  token: string
  onReload: () => void
  getTrustBadge: (level: string) => JSX.Element
  isOsDev: boolean
  onAppClick: (appId: string) => void
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

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
    <AdminCard title={`Installierte Apps (${apps.length})`} icon={Package}>
      {apps.length === 0 ? (
        <div className="text-center py-8">
          <Cube size={48} className="mx-auto mb-3 text-foreground/20" />
          <p className="text-xs text-foreground/50 mb-1">Keine Apps installiert</p>
          <p className="text-[10px] text-foreground/30">Installiere Apps aus dem Store oder lade eine ZIP-Datei hoch</p>
        </div>
      ) : (
        <div className="space-y-2">
          {apps.map((app) => (
            <div
              key={app.id}
              className="p-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 hover:border-accent/30 border border-transparent transition-all cursor-pointer"
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
                    <div className="flex items-center gap-1.5 flex-shrink-0">
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

              {/* Status badge */}
              <div className="mb-2 flex items-center gap-2">
                {app.status === 'running' ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Läuft
                  </span>
                ) : app.status === 'stopped' ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-foreground/10 text-foreground/50 rounded text-[10px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/30" /> Gestoppt
                  </span>
                ) : null}
                {(app.custom_pages?.length ?? 0) > 0 && (
                  <span className="text-[10px] text-foreground/40">
                    {app.custom_pages!.length} Seite{(app.custom_pages!.length !== 1) ? 'n' : ''}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
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
                      <button
                        onClick={() => stopApp(app.id)}
                        disabled={actionLoading === `stop-${app.id}`}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40"
                      >
                        {actionLoading === `stop-${app.id}` ? <InlineSpinner size={12} /> : <Pause size={12} />}
                        Stoppen
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
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
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
  return (
    <AdminCard title="App Store" icon={Cube}>
      <div className="text-center py-12">
        <Cube size={64} className="mx-auto mb-4 text-foreground/20" />
        <p className="text-sm font-semibold text-foreground mb-1">App Store Integration</p>
        <p className="text-xs text-foreground/50 mb-4 max-w-md mx-auto">
          Die Integration mit appstore.kaimdt.com wird in Kürze verfügbar sein.
          <br />
          Bis dahin können Apps per ZIP-Upload installiert werden.
        </p>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 max-w-md mx-auto">
          <div className="text-blue-400">
            <Lightning size={20} weight="fill" />
          </div>
          <div className="text-left flex-1">
            <div className="text-xs font-semibold text-blue-400">Coming Soon</div>
            <div className="text-[10px] text-blue-400/70">
              Durchsuche tausende Apps, direkt aus IORA installierbar
            </div>
          </div>
        </div>
      </div>
    </AdminCard>
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setManifest(null)
    setManifestError(null)

    try {
      const extractedManifest = await extractManifestFromZip(selectedFile)
      setManifest(extractedManifest)
      toast.success('manifest.json erfolgreich gelesen')
    } catch (err) {
      console.error('Manifest extraction failed:', err)
      setManifestError((err as Error).message)
      toast.error(`Konnte manifest.json nicht lesen: ${(err as Error).message}`)
    }
  }

  const uploadAndInstall = async () => {
    if (!file) return

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
          disabled={!file || uploading}
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
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${statusColor(job.status)}`}>
                {statusLabel(job.status)} {job.progress > 0 && job.status !== 'succeeded' ? `· ${job.progress}%` : ''}
              </span>
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
