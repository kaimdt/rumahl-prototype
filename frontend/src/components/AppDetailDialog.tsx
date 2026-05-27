import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Cube, Play, Pause, TrashSimple, ShieldCheck, Gear,
  Terminal, Warning, X, Clock, ArrowClockwise,
  Code, PlugsConnected, Globe, Star, Info, CaretDown, CaretUp,
  Stack, CubeFocus, DownloadSimple, ArrowSquareOut
} from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { adminFetch, InlineSpinner } from './AdminPanel'
import { toast } from 'sonner'
import { getBackendUrl } from '@/lib/config'

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
  autostart?: boolean
  last_started_at?: string
  last_stopped_at?: string
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
  storage_usage?: {
    total_file_bytes: number
    file_count: number
    kv_entry_count: number
    usage_percent: number
  }
  user_data?: {
    config_entries: number
    kv_entries: number
    stored_files: number
    total_file_bytes: number
  }
  dev_terminal_available?: boolean
  open_url?: string
  is_bundle?: boolean
  bundle_config?: any
  services?: any[]
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
  const [activeTab, setActiveTab] = useState<'info' | 'logs' | 'terminal' | 'settings' | 'pages' | 'bundle'>('info')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [terminalCommand, setTerminalCommand] = useState('')
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalRunning, setTerminalRunning] = useState(false)
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null)
  const [terminalSessionProject, setTerminalSessionProject] = useState('')
  const [terminalSessionService, setTerminalSessionService] = useState('')
  const [selectedTerminalService, setSelectedTerminalService] = useState('')
  const [terminalHistory, setTerminalHistory] = useState<string[]>([])
  const [terminalHistoryIndex, setTerminalHistoryIndex] = useState(-1)
  const terminalEsRef = useRef<EventSource | null>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  // Load app detail
  useEffect(() => {
    if (!appId) return
    setLoading(true)
    setError('')
    setLogs([])
    setTerminalOutput('')
    setTerminalCommand('')
    setTerminalSessionId(null)
    setTerminalSessionProject('')
    setTerminalSessionService('')
    setSelectedTerminalService('')
    setTerminalHistory([])
    setTerminalHistoryIndex(-1)

    ;(async () => {
      try {
        const data = await adminFetch(`/api/apps/${appId}/detail`, token) as AppDetail
        setDetail(data)
        setLogs(data.recent_logs || [])
        const firstService = typeof data.services?.[0]?.name === 'string' ? data.services[0].name : ''
        setSelectedTerminalService(firstService)
      } catch (e) {
        setError((e as Error).message)
      }
      setLoading(false)
    })()
  }, [appId, token])

  const sendTerminalInput = useCallback(async (input: string, appendNewline = true) => {
    if (!appId || !terminalSessionId) return
    await adminFetch(`/api/apps/${appId}/terminal/sessions/${terminalSessionId}/input`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, append_newline: appendNewline }),
    })
  }, [appId, terminalSessionId, token])

  // Subscribe to live logs via SSE
  useEffect(() => {
    if (!appId || activeTab !== 'logs') return

    const baseUrl = getBackendUrl()
    // EventSource cannot send custom Authorization headers, so we pass
    // the JWT via the `?token=` query param (the auth middleware accepts it).
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ''
    const eventSource = new EventSource(`${baseUrl}/api/apps/${appId}/logs/stream${tokenQuery}`)

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
      setDetail(prev => prev ? { ...prev, status: 'starting', enabled: true } : prev)
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

  const pauseApp = async () => {
    if (!appId) return
    setActionLoading('pause')
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/pause`, token, { method: 'POST' })
      toast.success('App pausiert')
      setDetail(prev => prev ? { ...prev, status: 'paused' } : prev)
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const resumeApp = async () => {
    if (!appId) return
    setActionLoading('resume')
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/resume`, token, { method: 'POST' })
      toast.success('App fortgesetzt')
      setDetail(prev => prev ? { ...prev, status: 'running' } : prev)
      onReload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setActionLoading(null)
  }

  const runTerminalCommand = async () => {
    if (!appId || !terminalSessionId || !terminalCommand.trim() || terminalRunning) return
    setTerminalRunning(true)
    try {
      const cmd = terminalCommand
      setTerminalOutput(prev => prev ? `${prev}\n$ ${cmd}` : `$ ${cmd}`)
      setTerminalCommand('')
      setTerminalHistory(prev => {
        if (!cmd.trim()) return prev
        if (prev[prev.length - 1] === cmd) return prev
        return [...prev, cmd]
      })
      setTerminalHistoryIndex(-1)

      await sendTerminalInput(cmd, true)
    } catch (e) {
      const msg = (e as Error).message
      setTerminalOutput(prev => prev ? `${prev}\nERROR: ${msg}` : `ERROR: ${msg}`)
      toast.error(msg)
    }
    setTerminalRunning(false)
  }

  const navigateTerminalHistory = (direction: 'up' | 'down') => {
    if (terminalHistory.length === 0) return

    if (direction === 'up') {
      const nextIndex = terminalHistoryIndex < 0
        ? terminalHistory.length - 1
        : Math.max(0, terminalHistoryIndex - 1)
      setTerminalHistoryIndex(nextIndex)
      setTerminalCommand(terminalHistory[nextIndex] || '')
      return
    }

    if (terminalHistoryIndex < 0) return
    if (terminalHistoryIndex >= terminalHistory.length - 1) {
      setTerminalHistoryIndex(-1)
      setTerminalCommand('')
      return
    }

    const nextIndex = terminalHistoryIndex + 1
    setTerminalHistoryIndex(nextIndex)
    setTerminalCommand(terminalHistory[nextIndex] || '')
  }

  useEffect(() => {
    if (!appId || activeTab !== 'terminal' || !detail?.dev_terminal_available) return

    let cancelled = false
    let createdSessionId: string | null = null
    setTerminalOutput('')
    setTerminalCommand('')
    setTerminalHistory([])
    setTerminalHistoryIndex(-1)
    ;(async () => {
      try {
        const session = await adminFetch(`/api/apps/${appId}/terminal/sessions`, token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service: selectedTerminalService || undefined }),
        }) as { session_id: string; service?: string; project?: string }

        if (cancelled) return
        createdSessionId = session.session_id
        setTerminalSessionId(session.session_id)
        setTerminalSessionProject(session.project || '')
        setTerminalSessionService(session.service || '')
        if (session.service) {
          setSelectedTerminalService(session.service)
        }

        const baseUrl = getBackendUrl()
        const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : ''
        const es = new EventSource(`${baseUrl}/api/apps/${appId}/terminal/sessions/${session.session_id}/stream${tokenQuery}`)
        terminalEsRef.current = es

        es.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as { type?: string; data?: string }
            const data = payload.data ?? ''
            setTerminalOutput(prev => prev ? `${prev}${data}` : data)
          } catch {
            setTerminalOutput(prev => prev ? `${prev}${event.data}` : event.data)
          }
        }
      } catch (e) {
        if (!cancelled) {
          const msg = (e as Error).message
          setTerminalOutput(prev => prev ? `${prev}\nERROR: ${msg}` : `ERROR: ${msg}`)
          toast.error(msg)
        }
      }
    })()

    return () => {
      cancelled = true
      if (terminalEsRef.current) {
        terminalEsRef.current.close()
        terminalEsRef.current = null
      }
      if (createdSessionId) {
        adminFetch(`/api/apps/${appId}/terminal/sessions/${createdSessionId}`, token, { method: 'DELETE' }).catch(() => {})
      }
      setTerminalSessionId(null)
      setTerminalSessionProject('')
      setTerminalSessionService('')
    }
  }, [appId, activeTab, detail?.dev_terminal_available, selectedTerminalService, token])

  const openApp = () => {
    if (detail?.open_url) {
      window.location.href = detail.open_url
    } else if (detail?.custom_pages?.[0]) {
      window.location.href = `/page/${detail.custom_pages[0].id}`
    }
  }

  const downloadCompose = () => {
    if (!appId) return
    const baseUrl = getBackendUrl()
    window.open(`${baseUrl}/api/supervisor/apps/${appId}/compose`, '_blank')
  }

  const bundleStart = async () => {
    if (!appId) return
    setActionLoading('bundle-start')
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/bundle/start`, token, { method: 'POST' })
      toast.success('Bundle gestartet')
      setDetail(prev => prev ? { ...prev, status: 'running' } : prev)
      onReload()
    } catch (e) { toast.error((e as Error).message) }
    setActionLoading(null)
  }

  const bundleStop = async () => {
    if (!appId) return
    setActionLoading('bundle-stop')
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/bundle/stop`, token, { method: 'POST' })
      toast.success('Bundle gestoppt')
      setDetail(prev => prev ? { ...prev, status: 'stopped' } : prev)
      onReload()
    } catch (e) { toast.error((e as Error).message) }
    setActionLoading(null)
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
      case 'starting': return <span className="flex items-center gap-1.5 text-amber-300"><span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse" /> Startet</span>
      case 'installing': return <span className="flex items-center gap-1.5 text-blue-300"><span className="w-2 h-2 rounded-full bg-blue-300 animate-pulse" /> Verarbeitet</span>
      case 'paused': return <span className="flex items-center gap-1.5 text-yellow-300"><span className="w-2 h-2 rounded-full bg-yellow-300" /> Pausiert</span>
      case 'error': return <span className="flex items-center gap-1.5 text-red-300"><span className="w-2 h-2 rounded-full bg-red-300" /> Fehler</span>
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
                  <>
                    <button onClick={pauseApp} disabled={actionLoading === 'pause'}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-yellow-500/15 text-yellow-300 rounded text-[10px] font-semibold hover:bg-yellow-500/25 transition-colors disabled:opacity-40">
                      {actionLoading === 'pause' ? <InlineSpinner size={12} /> : <Pause size={12} />} Pausieren
                    </button>
                    <button onClick={stopApp} disabled={actionLoading === 'stop'}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40">
                      {actionLoading === 'stop' ? <InlineSpinner size={12} /> : <Pause size={12} />} Stoppen
                    </button>
                  </>
                ) : detail.status === 'paused' ? (
                  <button onClick={resumeApp} disabled={actionLoading === 'resume'}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40">
                    {actionLoading === 'resume' ? <InlineSpinner size={12} /> : <Play size={12} />} Fortsetzen
                  </button>
                ) : detail.status === 'starting' || detail.status === 'installing' ? (
                  <button disabled
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 text-amber-300 rounded text-[10px] font-semibold opacity-80 cursor-default">
                    <InlineSpinner size={12} /> {detail.status === 'installing' ? 'Verarbeitet…' : 'Startet…'}
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
          {([
            'info',
            'logs',
            ...(detail?.dev_terminal_available ? ['terminal' as const] : []),
            'settings',
            'pages',
            ...(detail?.is_bundle ? ['bundle' as const] : []),
          ] as const).map(tab => (
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
              {tab === 'terminal' && <Terminal size={12} />}
              {tab === 'settings' && <Gear size={12} />}
              {tab === 'pages' && <Code size={12} />}
              {tab === 'bundle' && <Stack size={12} />}
              {tab === 'info' ? 'Info'
                : tab === 'logs' ? `Logs (${logs.length})`
                : tab === 'terminal' ? 'Terminal'
                : tab === 'settings' ? 'Einstellungen'
                : tab === 'pages' ? 'Seiten'
                : 'Bundle'}
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
                      <div><span className="text-foreground/40">Typ:</span> <span className="text-foreground/70">{detail.is_bundle ? 'Bundle' : detail.kind}</span></div>
                      <div><span className="text-foreground/40">Vertrauen:</span> <span className="text-foreground/70">{detail.trust_level}</span></div>
                      <div><span className="text-foreground/40">Installiert:</span> <span className="text-foreground/70">{new Date(detail.installed_at).toLocaleDateString('de-DE')}</span></div>
                      <div><span className="text-foreground/40">Quelle:</span> <span className="text-foreground/70">{detail.source}</span></div>
                      <div><span className="text-foreground/40">Autostart:</span> <span className="text-foreground/70">{detail.autostart ? 'An' : 'Aus'}</span></div>
                      <div><span className="text-foreground/40">Letzter Start:</span> <span className="text-foreground/70">{detail.last_started_at ? new Date(detail.last_started_at).toLocaleString('de-DE') : '—'}</span></div>
                      <div className="col-span-2"><span className="text-foreground/40">Letzter Stopp:</span> <span className="text-foreground/70">{detail.last_stopped_at ? new Date(detail.last_stopped_at).toLocaleString('de-DE') : '—'}</span></div>
                      {detail.is_bundle && (
                        <div className="col-span-2"><span className="text-foreground/40">Services:</span> <span className="text-foreground/70">{detail.services?.length || 0} Container</span></div>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <div className="p-3 rounded-lg bg-foreground/3">
                    <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-1">Beschreibung</div>
                    <p className="text-[11px] text-foreground/70 leading-relaxed">{detail.description || 'Keine Beschreibung'}</p>
                  </div>

                  {/* Storage + user data */}
                  <div className="p-3 rounded-lg bg-foreground/3">
                    <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-1.5">Speicherplatz & Benutzerdaten</div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div><span className="text-foreground/40">Dateien:</span> <span className="text-foreground/70">{detail.storage_usage?.file_count ?? 0}</span></div>
                      <div><span className="text-foreground/40">KV-Einträge:</span> <span className="text-foreground/70">{detail.storage_usage?.kv_entry_count ?? 0}</span></div>
                      <div><span className="text-foreground/40">Speicher belegt:</span> <span className="text-foreground/70">{((detail.storage_usage?.total_file_bytes ?? 0) / (1024 * 1024)).toFixed(2)} MB</span></div>
                      <div><span className="text-foreground/40">Nutzung:</span> <span className="text-foreground/70">{(detail.storage_usage?.usage_percent ?? 0).toFixed(1)}%</span></div>
                      <div><span className="text-foreground/40">Config-Einträge:</span> <span className="text-foreground/70">{detail.user_data?.config_entries ?? 0}</span></div>
                    </div>
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

              {/* Terminal Tab */}
              {activeTab === 'terminal' && (
                <div className="space-y-2">
                  <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider flex items-center gap-2">
                    Container-Terminal (Developer Mode)
                    <span className={`px-1.5 py-0.5 rounded text-[9px] ${terminalSessionId ? 'bg-green-500/15 text-green-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {terminalSessionId ? 'Verbunden' : 'Verbinde…'}
                    </span>
                  </div>
                  {terminalSessionId && (
                    <div className="text-[9px] text-foreground/45">
                      Aktive Session: {terminalSessionProject || '-'} / {terminalSessionService || selectedTerminalService || '-'}
                    </div>
                  )}
                  {(detail.services?.length || 0) > 0 && (
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-foreground/50">Service:</label>
                      <select
                        value={selectedTerminalService}
                        onChange={(e) => setSelectedTerminalService(e.target.value)}
                        className="px-2 py-1.5 rounded-md bg-foreground/5 border border-foreground/10 text-[10px] text-foreground focus:outline-none focus:border-accent"
                      >
                        {detail.services
                          .map((svc) => typeof svc?.name === 'string' ? svc.name : '')
                          .filter(Boolean)
                          .map((serviceName) => (
                            <option key={serviceName} value={serviceName}>{serviceName}</option>
                          ))}
                      </select>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      value={terminalCommand}
                      onChange={(e) => setTerminalCommand(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          runTerminalCommand()
                          return
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault()
                          navigateTerminalHistory('up')
                          return
                        }
                        if (e.key === 'ArrowDown') {
                          e.preventDefault()
                          navigateTerminalHistory('down')
                        }
                      }}
                      placeholder="z.B. ls -la /app"
                      className="flex-1 px-3 py-2 rounded-lg bg-foreground/5 border border-foreground/10 text-[11px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={runTerminalCommand}
                      disabled={!terminalSessionId || !terminalCommand.trim() || terminalRunning}
                      className="px-3 py-2 rounded-lg bg-accent/20 text-accent text-[10px] font-semibold hover:bg-accent/30 transition-colors disabled:opacity-40"
                    >
                      {terminalRunning ? <InlineSpinner size={12} /> : 'Ausführen'}
                    </button>
                    <button
                      onClick={() => setTerminalOutput('')}
                      className="px-3 py-2 rounded-lg bg-foreground/10 text-foreground/60 text-[10px] font-semibold hover:bg-foreground/15 transition-colors"
                    >
                      Löschen
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => sendTerminalInput('\u0003', false)}
                      disabled={!terminalSessionId}
                      className="px-2 py-1 rounded-md bg-red-500/15 text-red-300 text-[10px] font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-40"
                    >
                      Ctrl+C
                    </button>
                    <button
                      onClick={() => sendTerminalInput('', true)}
                      disabled={!terminalSessionId}
                      className="px-2 py-1 rounded-md bg-foreground/10 text-foreground/70 text-[10px] font-semibold hover:bg-foreground/15 transition-colors disabled:opacity-40"
                    >
                      Enter
                    </button>
                    <button
                      onClick={() => sendTerminalInput('\t', false)}
                      disabled={!terminalSessionId}
                      className="px-2 py-1 rounded-md bg-foreground/10 text-foreground/70 text-[10px] font-semibold hover:bg-foreground/15 transition-colors disabled:opacity-40"
                    >
                      Tab
                    </button>
                    <button
                      onClick={() => sendTerminalInput('\u0004', false)}
                      disabled={!terminalSessionId}
                      className="px-2 py-1 rounded-md bg-foreground/10 text-foreground/70 text-[10px] font-semibold hover:bg-foreground/15 transition-colors disabled:opacity-40"
                    >
                      Ctrl+D
                    </button>
                  </div>

                  <div className="bg-black/50 rounded-lg p-3 font-mono text-[10px] min-h-[280px] max-h-[420px] overflow-auto text-foreground/80 whitespace-pre-wrap">
                    {terminalOutput || 'Noch keine Ausgabe. Einen Befehl ausführen, um die Container-Shell zu verwenden.'}
                  </div>
                  <p className="text-[9px] text-foreground/30">
                    Session bleibt offen. Pfeil hoch/runter durchsucht die Command-History, Sondertasten werden direkt an die Shell gesendet.
                  </p>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="space-y-3">
                  <div className="p-4 rounded-lg bg-foreground/3 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
                      <Gear size={20} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">App-Einstellungen</p>
                      <p className="text-[10px] text-foreground/50 mt-0.5">
                        Konfiguration, Storage, Datenbank, Schedules, Webhooks &amp; Messaging dieser App.
                      </p>
                    </div>
                    <button
                      onClick={() => { window.location.href = `/app-settings/${appId}` }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-1.5 flex-shrink-0"
                    >
                      Öffnen
                      <ArrowSquareOut size={12} />
                    </button>
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

              {/* Bundle Tab */}
              {activeTab === 'bundle' && detail.is_bundle && (
                <div className="space-y-3">
                  {/* Bundle Header */}
                  <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Stack size={18} weight="fill" className="text-purple-400" />
                      <span className="text-xs font-semibold text-purple-300">App Bundle</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-semibold">
                        {(detail.services?.length || 0)} Services
                      </span>
                    </div>
                    <p className="text-[10px] text-purple-300/70">
                      Diese App besteht aus mehreren Docker-Containern, die über ein internes Netzwerk kommunizieren.
                    </p>
                  </div>

                  {/* Bundle Actions */}
                  <div className="flex items-center gap-2">
                    {detail.status === 'running' ? (
                      <button onClick={bundleStop} disabled={actionLoading === 'bundle-stop'}
                        className="flex items-center gap-1 px-3 py-2 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors disabled:opacity-40">
                        {actionLoading === 'bundle-stop' ? <InlineSpinner size={12} /> : <Pause size={12} />}
                        Bundle stoppen
                      </button>
                    ) : detail.status === 'starting' || detail.status === 'installing' ? (
                      <button disabled
                        className="flex items-center gap-1 px-3 py-2 bg-amber-500/10 text-amber-300 rounded text-[10px] font-semibold opacity-80 cursor-default">
                        <InlineSpinner size={12} /> {detail.status === 'installing' ? 'Verarbeitet…' : 'Startet…'}
                      </button>
                    ) : (
                      <button onClick={bundleStart} disabled={actionLoading === 'bundle-start'}
                        className="flex items-center gap-1 px-3 py-2 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40">
                        {actionLoading === 'bundle-start' ? <InlineSpinner size={12} /> : <Play size={12} />}
                        Bundle starten
                      </button>
                    )}
                    <button onClick={downloadCompose}
                      className="flex items-center gap-1 px-3 py-2 bg-accent/15 text-accent rounded text-[10px] font-semibold hover:bg-accent/25 transition-colors">
                      <DownloadSimple size={12} /> docker-compose.yml
                    </button>
                  </div>

                  {/* Service List */}
                  {detail.services && detail.services.length > 0 && (
                    <div>
                      <div className="text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mb-2">Services</div>
                      <div className="space-y-1.5">
                        {detail.services.map((svc: any, i: number) => (
                          <div key={i} className="p-2.5 rounded-lg bg-foreground/3 border border-foreground/5">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <CubeFocus size={14} className="text-accent" />
                                <span className="text-[11px] font-semibold text-foreground">{svc.name}</span>
                              </div>
                              {svc.image && (
                                <span className="text-[9px] font-mono text-foreground/40 bg-foreground/5 px-1.5 py-0.5 rounded truncate max-w-[200px]">
                                  {svc.image}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 text-[9px] text-foreground/40">
                              {svc.build && <span className="flex items-center gap-1">🔨 Build: {svc.build.context}</span>}
                              {svc.command && <span className="flex items-center gap-1">▶ {svc.command}</span>}
                              {svc.restart && <span className="flex items-center gap-1">↻ {svc.restart}</span>}
                              {(svc.internal_ports?.length ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                  🔌 {svc.internal_ports.map((p: any) => `${p.port}/${p.protocol}`).join(', ')}
                                </span>
                              )}
                              {(svc.depends_on?.length ?? 0) > 0 && (
                                <span className="flex items-center gap-1 text-purple-400/70">
                                  → {svc.depends_on.join(', ')}
                                </span>
                              )}
                            </div>
                            {/* Service env vars */}
                            {svc.environment && Object.keys(svc.environment).length > 0 && (
                              <details className="mt-1.5">
                                <summary className="text-[9px] text-foreground/30 cursor-pointer hover:text-foreground/50">
                                  {Object.keys(svc.environment).length} Umgebungsvariablen
                                </summary>
                                <pre className="mt-1 text-[9px] font-mono text-foreground/40 bg-black/30 rounded p-1.5 max-h-24 overflow-auto">
                                  {JSON.stringify(svc.environment, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No services */}
                  {(!detail.services || detail.services.length === 0) && (
                    <div className="p-4 rounded-lg bg-foreground/3 text-center">
                      <Stack size={24} className="mx-auto mb-2 text-foreground/20" />
                      <p className="text-xs text-foreground/50">Keine Services definiert</p>
                      <p className="text-[10px] text-foreground/30 mt-1">
                        Die Bundle-Konfiguration enthält keine Service-Definitionen.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'bundle' && !detail.is_bundle && (
                <div className="p-4 rounded-lg bg-foreground/3 text-center">
                  <Cube size={24} className="mx-auto mb-2 text-foreground/30" />
                  <p className="text-xs text-foreground/50">Kein Bundle</p>
                  <p className="text-[10px] text-foreground/30 mt-1">Diese App ist eine Standard-App mit einem einzelnen Container.</p>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
