import { useState, useCallback, useEffect } from 'react'
import {
  Cube, Lightning, Plus, Play, Pause, TrashSimple, ShieldCheck,
  DownloadSimple, Upload, MagnifyingGlass, Gear, Check, X,
  ShieldWarning, Package, ArrowClockwise
} from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { toast } from 'sonner'

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
  installed_at: string
  ports: PortInfo[]
}

interface PortInfo {
  internal: number
  external: number
  protocol: string
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

  const loadInstalled = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/appstore/installed', token) as { apps: AppInfo[] }
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
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage>{error}</ErrorMessage>
          ) : (
            <InstalledAppsView apps={apps} token={token} onReload={loadInstalled} getTrustBadge={getTrustBadge} />
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
    </div>
  )
}

// ── Installed Apps View ───────────────────────────────────────────────────

function InstalledAppsView({
  apps,
  token,
  onReload,
  getTrustBadge
}: {
  apps: AppInfo[]
  token: string
  onReload: () => void
  getTrustBadge: (level: string) => JSX.Element
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const enableApp = async (appId: string) => {
    setActionLoading(appId)
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
    setActionLoading(appId)
    try {
      await adminFetch(`/api/appstore/apps/${appId}/disable`, token, { method: 'POST' })
      toast.success('App deaktiviert')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const uninstallApp = async (appId: string) => {
    if (!confirm('App wirklich deinstallieren? Alle Daten gehen verloren.')) return
    setActionLoading(appId)
    try {
      await adminFetch(`/api/appstore/apps/${appId}`, token, { method: 'DELETE' })
      toast.success('App deinstalliert')
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
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
            <div key={app.id} className="p-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
              <div className="flex items-start gap-3 mb-3">
                {app.icon ? (
                  <img src={app.icon} alt={app.name} className="w-10 h-10 rounded-lg flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                    <Cube size={20} className="text-accent" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{app.name}</div>
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
              {app.ports.length > 0 && (
                <div className="mb-3 pt-2 border-t border-foreground/5">
                  <div className="text-[10px] text-foreground/40 mb-1.5">Zugewiesene Ports:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {app.ports.map((port, j) => (
                      <span key={j} className="text-[10px] px-2 py-1 rounded bg-accent/10 text-accent font-mono">
                        {port.external}:{port.internal}/{port.protocol}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {app.enabled ? (
                  <button
                    onClick={() => disableApp(app.id)}
                    disabled={actionLoading === app.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40"
                  >
                    {actionLoading === app.id ? <InlineSpinner size={12} /> : <Pause size={12} />}
                    Deaktivieren
                  </button>
                ) : (
                  <button
                    onClick={() => enableApp(app.id)}
                    disabled={actionLoading === app.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40"
                  >
                    {actionLoading === app.id ? <InlineSpinner size={12} /> : <Play size={12} />}
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    // TODO: Extract and parse manifest.json from ZIP
    // For now, we'll require manual manifest input or implement ZIP parsing
  }

  const uploadAndInstall = async () => {
    if (!file) return

    setUploading(true)
    try {
      // Convert file to base64
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result?.toString().split(',')[1]

        await adminFetch('/api/appstore/install', token, {
          method: 'POST',
          body: JSON.stringify({
            zip_data: base64,
            // manifest will be extracted from ZIP on server side
          }),
        })

        toast.success('App erfolgreich installiert!')
        onSuccess()
      }
      reader.readAsDataURL(file)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setUploading(false)
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
