import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Cube, Play, Pause, TrashSimple, ShieldCheck, Gear,
  Terminal, Warning, X, Clock, ArrowClockwise,
  Code, PlugsConnected, Globe, Star, Info, CaretDown, CaretUp
} from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { adminFetch, InlineSpinner } from './AdminPanel'
import { toast } from 'sonner'

// ── Types ──────────────────────────────────────────────────────────────

interface CustomPage {
  id: string
  title: string
  icon: string
  url: string
  show_in_nav?: boolean
  iframe?: boolean
}

interface AppDetail {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon: string
  status: string
  enabled: boolean
  kind: string
  system?: boolean
  trust_level: string
  installed_at: string
  source: string
  permissions: string[]
  custom_pages: CustomPage[]
  ports: Array<{ internal: number; external: number; protocol: string }>
  docker_config: any
  settings_schema: any
  recent_logs: Array<{ timestamp: string; level: string; message: string; source: string }>
  log_count: number
  open_url?: string
}

interface LogEntry {
  timestamp: string
  level: string
  message: string
  source: string
}

// ── Props ──────────────────────────────────────────────────────────────

interface AppDetailDialogProps {
  appId: string | null
  token: string
  onClose: () => void
  onReload: () => void
}

// ── App Detail Dialog ─────────────────────────────────────────────────

const DEFAULT_ICON = '/default-app-icon.svg'

export function AppDetailDialog({ appId, token, onClose, onReload }: AppDetailDialogProps) {
  const [detail, setDetail] = useState<AppDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'info' | 'logs' | 'settings' | 'pages'>('info')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  // Load app detail
  useEffect(() => {
    if (!appId) return
    setLoading(true)
    setError('')
    setLogs([])

    ;(async () => {
      try {
        const data = await adminFetch(`/api/apps/${appId}/detail`, token) as AppDetail
        setDetail(data)
        setLogs(data.recent_logs || [])
      } catch (e) {
        setError((e as Error).message)
      }
      setLoading(false)
    })()
  }, [appId, token])

  // Subscribe to live logs via SSE
  useEffect(() => {
    if (!appId || activeTab !== 'logs') return

    const baseUrl = import.meta.env.VITE_BACKEND_URL || ''
    const eventSource = new EventSource(`${baseUrl}/api/apps/${appId}/logs/stream`)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'snapshot') {
          setLogs(data.logs || [])
        } else if (data.type === 'log' && data.entry) {
          setLogs(prev => [...prev, data.entry].slice(-500))
        }
      } catch { /* ignore parse errors */ }
    }

    eventSource.onerror = () => {
      // Will reconnect automatically
    }

    return () => eventSource.close()
  }, [appId, activeTab, token])

  // Auto-scroll log container
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  const startApp = async () => {
    if (!appId) return
    setActionLoading('start')
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/start`, token, { method: 'POST' })
      toast.success('App gestartet')
      setDetail(prev => prev ? { ...prev, status: 'running', enabled: true } : prev)
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const stopApp = async () => {
    if (!appId) return
    setActionLoading('stop')
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/stop`, token, { method: 'POST' })
      toast.success('App gestoppt')
      setDetail(prev => prev ? { ...prev, status: 'stopped' } : prev)
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const openApp = () => {
    if (detail?.open_url) {
      window.location.href = detail.open_url
    } else if (detail?.custom_pages?.[0]) {
      window.location.href = `/page/${detail.custom_pages[0].id}`
    }
  }

  const getLogLevelColor = (level: string) => {
    switch (level.toUpperCase()) {
      case 'ERROR': case 'CRITICAL': return 'text-red-400 bg-red-500/10'
      case 'WARNING': return 'text-yellow-400 bg-yellow-500/10'
      case 'INFO': return 'text-blue-400 bg-blue-500/10'
      case 'DEBUG': return 'text-foreground/50 bg-foreground/5'
      default: return 'text-foreground/60 bg-foreground/5'
    }
  }

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'running': return <span className="flex items-center gap-1.5 text-green-400"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Läuft</span>
      case 'stopped': return <span className="flex items-center gap-1.5 text-foreground/50"><span className="w-2 h-2 rounded-full bg-foreground/30" /> Gestoppt</span>
      default: return <span className="flex items-center gap-1.5 text-foreground/40"><span className="w-2 h-2 rounded-full bg-foreground/20" /> {status}</span>
    }
  }

  if (!appId) return null

  return (
    <Dialog open={!!appId} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-hidden flex flex-col glass-card border-foreground/10 bg-card/95 backdrop-blur-2xl">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-foreground/10 flex-shrink-0">
          <DialogTitle className="flex items-center gap-3">
            {loading ? (
              <div className="w-8 h-8 rounded-lg bg-accent/20 animate-pulse" />
            ) : detail?.icon && !detail.icon.includes('default-app-icon') ? (
              <img src={detail.icon} alt="" className="w-8 h-8 rounded-lg" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                <Cube size={18} className="text-accent" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {detail?.name || 'App'}
              </div>
              <div className="text-[10px] text-foreground/40">
                {detail?.version} · {detail?.developer || 'Unbekannt'}
              </div>
            </div>
            {detail && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {detail.status === 'running' ? (
                  <button onClick={stopApp} disabled={actionLoading === 'stop'}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40">
                    {actionLoading === 'stop' ? <InlineSpinner size={12} /> : <Pause size={12} />} Stoppen
                  </button>
                ) : (
                  <button onClick={startApp} disabled={actionLoading === 'start'}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40">
                    {actionLoading === 'start' ? <InlineSpinner size={12} /> : <Play size={12} />} Starten
                  </button>
                )}
                {detail.open_url && (
                  <button onClick={openApp}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/15 text-accent rounded text-[10px] font-semibold hover:bg-accent/25 transition-colors">
                    <Globe size={12} /> Öffnen
                  </button>
                )}
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Tab Navigation */}
        <div className="flex gap-1 p-2 bg-foreground/5 mx-4 mt-3 rounded-lg flex-shrink-0">
          {(['info', 'logs', 'settings', 'pages'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-semibold transition-all ${
                activeTab === tab
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-foreground/50 hover:text-foreground hover:bg-foreground/5'
              }`}
            >
              {tab === 'info' && <Info size={12} />}
              {tab === 'logs' && <Terminal size={12} />}
              {tab === 'settings' && <Gear size={12} />}
              {tab === 'pages' && <Code size={12} />}
              {tab === 'info' ? 'Info' : tab === 'logs' ? `Logs (${logs.length})` : tab === 'settings' ? 'Einstellungen' : 'Seiten'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <InlineSpinner size={24} />
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">{error}</div>
          ) : !detail ? null : (
            <>
              {/* Info Tab */}
              {activeTab === 'info' && (
                <div className="space-y-3">
                  {/* Status */}
                  <div className="p-3 rounded-lg bg-foreground/3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider">Status</span>
                      <div className="flex items-center gap-2">
                        {getStatusIndicator(detail.status)}
                        {detail.enabled ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-semibold">Aktiv</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/40 font-semibold">Inaktiv</span>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div><span className="text-foreground/40">Typ:</span> <span className="text-foreground/70">{detail.kind}</span></div>
                      <div><span className="text-foreground/40">Vertrauen:</span> <span className="text-foreground/70">{detail.trust_level}</span></div>
                      <div><span className="text-foreground/40">Installiert:</span> <span className="text-foreground/70">{new Date(detail.installed_at).toLocaleDateString('de-DE')}</span></div>
                      <div><span className="text-foreground/40">Quelle:</span> <span className="text-foreground/70">{detail.source}</span></div>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="p-3 rounded-lg bg-foreground/3">
                    <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-1">Beschreibung</div>
                    <p className="text-[11px] text-foreground/70 leading-relaxed">{detail.description || 'Keine Beschreibung'}</p>
                  </div>

                  {/* Permissions */}
                  {detail.permissions.length > 0 && (
                    <div className="p-3 rounded-lg bg-foreground/3">
                      <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-1.5">
                        Berechtigungen ({detail.permissions.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {detail.permissions.map((perm, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">{perm}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Ports */}
                  {detail.ports.length > 0 && (
                    <div className="p-3 rounded-lg bg-foreground/3">
                      <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-1.5">Ports</div>
                      <div className="flex flex-wrap gap-1">
                        {detail.ports.map((p, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono">
                            {p.external}:{p.internal}/{p.protocol}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Logs Tab */}
              {activeTab === 'logs' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider">
                      Live Logs ({logs.length})
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[10px] text-foreground/40 cursor-pointer">
                        <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="w-3 h-3" />
                        Auto-Scroll
                      </label>
                    </div>
                  </div>
                  <div
                    ref={logContainerRef}
                    className="bg-black/40 rounded-lg p-2 font-mono text-[10px] h-[350px] overflow-y-auto space-y-0.5"
                    onScroll={(e) => {
                      const el = e.currentTarget
                      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
                      setAutoScroll(isAtBottom)
                    }}
                  >
                    {logs.length === 0 ? (
                      <div className="text-foreground/30 p-4 text-center">Keine Logs vorhanden</div>
                    ) : (
                      logs.map((log, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 p-1 rounded hover:bg-foreground/5 cursor-pointer transition-colors"
                          onClick={() => setExpandedLog(expandedLog === i ? null : i)}
                        >
                          <span className={`flex-shrink-0 px-1 rounded text-[8px] font-semibold uppercase ${getLogLevelColor(log.level)}`}>
                            {log.level.slice(0, 4)}
                          </span>
                          <span className="text-foreground/30 flex-shrink-0 w-16">
                            {new Date(log.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="text-foreground/70 break-all flex-1 min-w-0 line-clamp-1">
                            {log.message}
                          </span>
                          {log.source && (
                            <span className="text-[8px] text-foreground/30 flex-shrink-0">{log.source}</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="text-[9px] text-foreground/30 text-center">
                    Klicke auf einen Log-Eintrag für Details · {logs.length} Einträge gesamt
                  </div>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="space-y-3">
                  <div className="p-4 rounded-lg bg-foreground/3 text-center">
                    <Gear size={24} className="mx-auto mb-2 text-foreground/30" />
                    <p className="text-xs text-foreground/50">App-Einstellungen</p>
                    <p className="text-[10px] text-foreground/30 mt-1">
                      Einstellungen für diese App können in Kürze hier konfiguriert werden.
                    </p>
                  </div>
                </div>
              )}

              {/* Pages Tab */}
              {activeTab === 'pages' && detail.custom_pages.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-1">
                    App-Seiten ({detail.custom_pages.length})
                  </div>
                  {detail.custom_pages.map((page, i) => (
                    <div key={i} className="p-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors cursor-pointer"
                      onClick={() => window.location.href = `/page/${page.id}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                          <Code size={16} className="text-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-foreground truncate">{page.title}</div>
                          <div className="text-[10px] text-foreground/40 truncate">{page.url}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {page.show_in_nav !== false && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Im Nav</span>
                          )}
                          {page.iframe && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">Iframe</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'pages' && detail.custom_pages.length === 0 && (
                <div className="p-4 rounded-lg bg-foreground/3 text-center">
                  <Code size={24} className="mx-auto mb-2 text-foreground/30" />
                  <p className="text-xs text-foreground/50">Keine eigenen Seiten</p>
                  <p className="text-[10px] text-foreground/30 mt-1">Diese App hat keine benutzerdefinierten Seiten definiert.</p>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
