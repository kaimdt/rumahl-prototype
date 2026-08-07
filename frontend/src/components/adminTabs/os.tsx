import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowClockwise, Broadcast, CheckCircle, CircleNotch, CloudArrowUp, Code, Copy, Cpu, Cube, File, FolderOpen, Gauge, Gear, Globe, HardDrive, Key, LinkSimple, ListBullets, MapPin, Plus, Power, Pulse, ShareNetwork, Terminal, Users, Warning, WifiHigh, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getDevBridgeUrl, getBackendUrl } from '@/lib/config'
import { AdminCard, ErrorMessage, LoadingSpinner, adminFetch, ccBtnDanger, ccBtnIcon, ccBtnPrimary, ccBtnSecondary, ccInput, ccLabel, formatUptime } from '../AdminPanel'
import { ServiceJsonBlock } from '../AdminPanel'
export const OS_BASE = '/api/admin/iora-control'
import { devBridgeFetch } from './ai'
export function DevBridgeTab({ token: _token }: { token: string }) {
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [bridgeStatusText, setBridgeStatusText] = useState('')
  const [devToken, setDevToken] = useState<string | null>(null)
  const [bridgeBuild, setBridgeBuild] = useState('')
  const [activeSubTab, setActiveSubTab] = useState<'services' | 'system-info' | 'filesystem' | 'build' | 'journal' | 'compose'>('services')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginError, setLoginError] = useState('')

  // ─── Bridge-Konnektivität prüfen ────────────────────────────
  const checkBridge = useCallback(async () => {
    setBridgeStatus('checking')
    try {
      const baseUrl = getDevBridgeUrl()
      const res = await fetch(`${baseUrl}/dev/health`, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) {
        const data = await res.json()
        setBridgeStatus('online')
        setBridgeBuild(data.build || '')
        setBridgeStatusText(`Build ${data.build || '?'}, Uptime ${data.uptime_seconds || 0}s`)
      } else {
        setBridgeStatus('offline')
        setBridgeStatusText(`HTTP ${res.status}`)
      }
    } catch (e) {
      setBridgeStatus('offline')
      setBridgeStatusText(e instanceof Error ? e.message : 'Unbekannter Fehler')
    }
  }, [])

  useEffect(() => { checkBridge() }, [checkBridge])

  // ─── Auto-Login via gespeichertem Session-Token ─────────────
  useEffect(() => {
    const stored = localStorage.getItem('iora-dev-session-token') || sessionStorage.getItem('iora-dev-session-token')
    // Fallback: statischer Dev-Token
    const staticToken = localStorage.getItem('iora-dev-token')
    if (stored) {
      setDevToken(stored)
    } else if (staticToken) {
      setDevToken(staticToken)
    }
  }, [])

  // ─── Login bei der Dev Bridge ───────────────────────────────
  const handleDevBridgeLogin = async () => {
    if (!loginUser || !loginPass) return
    setLoginLoading(true)
    setLoginError('')
    try {
      const res = await fetch(`${getDevBridgeUrl()}/dev/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setDevToken(data.token)
      localStorage.setItem('iora-dev-session-token', data.token)
      toast.success('Dev Bridge Login erfolgreich')
      setLoginUser('')
      setLoginPass('')
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : String(e))
    }
    setLoginLoading(false)
  }

  const handleLogout = () => {
    setDevToken(null)
    localStorage.removeItem('iora-dev-session-token')
    sessionStorage.removeItem('iora-dev-session-token')
  }

  // ─── Subtabs ─────────────────────────────────────────────────
  if (bridgeStatus === 'checking') {
    return (
      <div className="space-y-3">
        <AdminCard title="Dev Bridge" icon={Terminal}>
          <div className="flex items-center gap-3 p-4">
            <div className="w-5 h-5 rounded-full border-2 border-foreground/30 border-t-accent animate-spin" />
            <p className="text-sm text-foreground/60">Prüfe Verbindung zur Dev Bridge unter {getDevBridgeUrl()}...</p>
          </div>
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Bridge-Status-Karte mit Login */}
      <AdminCard title="Dev Bridge Status" icon={Terminal}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              bridgeStatus === 'online' ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]'
            }`} />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {bridgeStatus === 'online' ? 'Verbunden' : 'Nicht erreichbar'}
              </p>
              <p className="text-xs text-foreground/50 font-mono">
                {getDevBridgeUrl()} — {bridgeStatusText}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {devToken ? (
              <button onClick={handleLogout} className={ccBtnDanger('text-xs')}>
                <X size={14} /> Abmelden
              </button>
            ) : null}
            <button onClick={checkBridge} className={ccBtnSecondary('text-xs')}>
              <ArrowClockwise size={14} /> Neu prüfen
            </button>
          </div>
        </div>

        {/* Login-Formular wenn kein Token vorhanden */}
        {!devToken && bridgeStatus === 'online' && (
          <div className="mt-4 p-4 rounded-xl bg-foreground/3 border border-foreground/5">
            <p className="text-xs font-semibold text-foreground/80 mb-3">
              Anmeldung an der Dev Bridge erforderlich — verwende deine IORA-Dashboard-Zugangsdaten:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)}
                placeholder="Benutzername" className={ccInput('text-xs')}
                onKeyDown={e => e.key === 'Enter' && handleDevBridgeLogin()} />
              <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
                placeholder="Passwort" className={ccInput('text-xs')}
                onKeyDown={e => e.key === 'Enter' && handleDevBridgeLogin()} />
              <button onClick={handleDevBridgeLogin} disabled={loginLoading || !loginUser || !loginPass}
                className={ccBtnPrimary('text-xs whitespace-nowrap')}>
                {loginLoading ? 'Verbindet…' : 'Anmelden'}
              </button>
            </div>
            {loginError && <p className="text-xs text-red-400 mt-2">{loginError}</p>}
          </div>
        )}
      </AdminCard>

      {/* Subtabs (nur wenn authentifiziert) */}
      {devToken && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {([
              { id: 'services' as const, label: 'Dienste & Logs', icon: Gauge },
              { id: 'system-info' as const, label: 'System-Info', icon: Cpu },
              { id: 'filesystem' as const, label: 'Dateisystem', icon: FolderOpen },
              { id: 'build' as const, label: 'Build & Replace', icon: Code },
            { id: 'journal' as const, label: 'Journal', icon: ListBullets },
            { id: 'compose' as const, label: 'Docker Compose', icon: Cube },
            ]).map(sub => (
              <button key={sub.id} onClick={() => setActiveSubTab(sub.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSubTab === sub.id ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
                }`}>
                <sub.icon size={14} className="inline mr-1.5" />
                {sub.label}
              </button>
            ))}
          </div>

          {activeSubTab === 'services' && <DevBridgeServices devToken={devToken} />}
          {activeSubTab === 'system-info' && <DevBridgeSystemInfo devToken={devToken} />}
          {activeSubTab === 'filesystem' && <DevBridgeFilesystem devToken={devToken} />}
          {activeSubTab === 'build' && <DevBridgeBuild devToken={devToken} />}
          {activeSubTab === 'journal' && <DevBridgeJournal devToken={devToken} />}
          {activeSubTab === 'compose' && <DevBridgeCompose devToken={devToken} />}
        </>
      )}
    </div>
  )
}

// ─── Dev Bridge: Dienste & Logs ─────────────────────────────────────────


export function DevBridgeServices({ devToken }: { devToken: string | null }) {
  const [services, setServices] = useState<Array<{ name: string; status: string; url?: string; version?: string; response_time_ms?: number; uptime?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState<string | null>(null)
  const [streamingService, setStreamingService] = useState<string | null>(null)
  const [streamLogs, setStreamLogs] = useState<string[]>([])
  const streamRef = useRef<EventSource | null>(null)

  const loadServices = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await devBridgeFetch('/dev/services', devToken)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      const data = await res.json()
      const list = data.services || data || []
      setServices(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken])

  useEffect(() => { if (devToken) loadServices() }, [devToken, loadServices])

  const restartService = async (name: string) => {
    setRestarting(name)
    try {
      const res = await devBridgeFetch(`/dev/service/${encodeURIComponent(name)}/restart`, devToken, { method: 'POST' })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `HTTP ${res.status}`)
      }
      toast.success(`${name} wird neu gestartet…`)
      setTimeout(() => loadServices(), 3000)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    setRestarting(null)
  }

  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)

  const startStream = (name: string, attempt = 0) => {
    if (streamRef.current) {
      streamRef.current.close()
    }
    if (attempt === 0) {
      setStreamLogs([])
      reconnectAttemptRef.current = 0
    }
    setStreamingService(name)

    const baseUrl = getDevBridgeUrl()
    const tokenParam = devToken ? `&token=${encodeURIComponent(devToken)}` : ''
    const es = new EventSource(`${baseUrl}/dev/service/${encodeURIComponent(name)}/logs/stream?tail=50${tokenParam}`)

    es.addEventListener('hello', (e: Event) => {
      const msgEvent = e as MessageEvent
      reconnectAttemptRef.current = 0 // Verbindung steht – Backoff zurücksetzen
      setStreamLogs(prev => [...prev, `── ${msgEvent.data}`])
    })

    es.onmessage = (e: MessageEvent) => {
      setStreamLogs(prev => {
        const next = [...prev, e.data]
        return next.length > 500 ? next.slice(-500) : next
      })
    }

    es.addEventListener('error', (e: Event) => {
      const msgEvent = e as MessageEvent
      if (msgEvent.data) {
        setStreamLogs(prev => [...prev, `⚠️ ${msgEvent.data}`])
      }
    })

    es.onerror = () => {
      es.close()
      // Auto-Reconnect mit exponentiellem Backoff (1s, 2s, 4s, max 30s)
      const retry = reconnectAttemptRef.current
      if (retry < 10) {
        const delay = Math.min(1000 * Math.pow(2, retry), 30_000)
        reconnectAttemptRef.current = retry + 1
        setStreamLogs(prev => [...prev, `⚠️ Verbindung unterbrochen – erneuter Versuch in ${delay / 1000}s…`])
        if (reconnectRef.current) clearTimeout(reconnectRef.current)
        reconnectRef.current = setTimeout(() => {
          startStream(name, retry + 1)
        }, delay)
      } else {
        setStreamLogs(prev => [...prev, '⚠️ Verbindung endgültig getrennt (max. Wiederholungen)'])
        setStreamingService(null)
      }
    }

    streamRef.current = es
  }

  // Cleanup auch den reconnect-Timeout
  const stopStream = () => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.close()
      streamRef.current = null
    }
    setStreamingService(null)
    setStreamLogs([])
    reconnectAttemptRef.current = 0
  }

  // Clean up on unmount (schließt Stream + reconnect-Timeout)
  useEffect(() => {
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (streamRef.current) streamRef.current.close()
    }
  }, [])

  if (!devToken) {
    return (
      <AdminCard>
        <div className="p-4 text-center">
          <p className="text-sm text-foreground/60">Dev-Token nicht gefunden.</p>
          <p className="text-xs text-foreground/40 mt-2">
            Bitte im Developer-Mode-Tab den Dev-Bridge-Token hinterlegen oder das
            OS-Entwickler-Image verwenden.
          </p>
        </div>
      </AdminCard>
    )
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const onlineCount = services.filter(s => s.status === 'online').length

  return (
    <div className="space-y-3">
      {/* Live-Log-Stream */}
      {streamingService && (
        <AdminCard title={`Live-Log: ${streamingService}`} icon={Broadcast}>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400 font-medium">Live-Stream aktiv</span>
              </div>
              <button onClick={stopStream} className={ccBtnDanger('text-xs')}>
                <X size={14} /> Stream beenden
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3 space-y-0.5">
              {streamLogs.length === 0 ? (
                <p className="text-foreground/50 text-center py-4">Warte auf Log-Einträge…</p>
              ) : streamLogs.map((line, i) => (
                <div key={i} className={`${
                  line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
                  line.includes('WARN') || line.includes('warn') ? 'text-amber-400' :
                  line.startsWith('⚠') ? 'text-amber-300' :
                  line.startsWith('──') ? 'text-foreground/40' :
                  'text-foreground/70'
                }`}>{line}</div>
              ))}
            </div>
          </div>
        </AdminCard>
      )}

      {/* Service-Übersicht */}
      <AdminCard title={`Dienste (${onlineCount}/${services.length} online)`} icon={Gauge}>
        <div className="space-y-2">
          {services.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine Dienste gefunden.</p>
          ) : services.map(svc => (
            <div key={svc.name} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-foreground/3 border border-foreground/5">
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  svc.status === 'online' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' :
                  svc.status === 'degraded' ? 'bg-amber-400' :
                  svc.status === 'not_deployed' ? 'bg-foreground/30' :
                  'bg-red-400'
                }`} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{svc.name}</p>
                  {svc.url && <p className="text-[10px] text-foreground/40 font-mono truncate">{svc.url}</p>}
                  <div className="flex gap-2 mt-0.5">
                    {svc.response_time_ms && <span className="text-[10px] text-foreground/50">{svc.response_time_ms}ms</span>}
                    {svc.version && <span className="text-[10px] text-foreground/50">v{svc.version}</span>}
                    {svc.uptime && <span className="text-[10px] text-foreground/50">{svc.uptime}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => startStream(svc.name)}
                  disabled={streamingService === svc.name}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                    streamingService === svc.name
                      ? 'bg-green-500/20 text-green-300'
                      : 'bg-foreground/8 text-foreground/60 hover:text-accent hover:bg-accent/10'
                  }`}
                  title="Live-Log streamen">
                  <Broadcast size={11} className="inline mr-1" />
                  {streamingService === svc.name ? 'Streamt' : 'Live'}
                </button>
                <button onClick={() => restartService(svc.name)}
                  disabled={restarting === svc.name}
                  className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                  title="Dienst neu starten">
                  <ArrowClockwise size={11} className={restarting === svc.name ? 'animate-spin inline mr-1' : 'inline mr-1'} />
                  {restarting === svc.name ? 'Starte…' : 'Restart'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-2">
          <button onClick={loadServices} className={ccBtnSecondary('text-xs')}>
            <ArrowClockwise size={14} /> Aktualisieren
          </button>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── Dev Bridge: System-Info ────────────────────────────────────────────


export function DevBridgeSystemInfo({ devToken }: { devToken: string | null }) {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!devToken) return
    setLoading(true)
    setError('')
    try {
      const res = await devBridgeFetch('/dev/system/info', devToken)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setInfo(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken])

  useEffect(() => { load() }, [load])

  if (!devToken) return null
  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!info) return null

  const [rebooting, setRebooting] = useState(false)

  const handleReboot = async () => {
    if (!confirm('⚠️  System wirklich neu starten? Die Verbindung wird getrennt.')) return
    setRebooting(true)
    try {
      const res = await devBridgeFetch('/dev/system/reboot', devToken, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Neustart wird ausgeführt… Die Verbindung wird in Kürze getrennt.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      setRebooting(false)
    }
  }

  const formatBytes = (b: number) => {
    if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toFixed(1)} GB`
    if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`
    if (b >= 1_000) return `${(b / 1_000).toFixed(1)} KB`
    return `${b} B`
  }

  const formatUptime = (sec: number) => {
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return `${d}d ${h}h ${m}m`
  }

  return (
    <AdminCard title="System-Informationen" icon={Cpu}>
      <div className="flex items-start justify-between mb-4">
        <div />
        <button onClick={handleReboot} disabled={rebooting}
          className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            rebooting
              ? 'bg-red-500/20 text-red-300 cursor-wait'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
          }`}>
          <Power size={14} className={`inline mr-1.5 ${rebooting ? 'animate-pulse' : ''}`} />
          {rebooting ? 'Starte neu…' : 'System neu starten'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Hostname</div>
          <div className="text-sm font-semibold text-foreground font-mono">{String(info.hostname || '–')}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Build</div>
          <div className="text-sm font-semibold text-foreground font-mono">{String(info.build || '–')}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Uptime</div>
          <div className="text-sm font-semibold text-foreground">{formatUptime(Number(info.uptime_seconds || 0))}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">CPU</div>
          <div className="text-sm font-semibold text-foreground">{String(info.cpu_count || '?')} Kerne</div>
          <div className="text-[10px] text-foreground/40 mt-0.5">Load: {String(info.loadavg || '–')}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Arbeitsspeicher</div>
          <div className="text-sm font-semibold text-foreground">{formatBytes(Number(info.mem_total_bytes || 0))}</div>
          <div className="text-[10px] text-foreground/40 mt-0.5">Frei: {formatBytes(Number(info.mem_available_bytes || 0))}</div>
        </div>
        <div className="p-3 rounded-xl bg-foreground/3 border border-foreground/5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/50 mb-1">Festplatte (/)</div>
          <div className="text-sm font-semibold text-foreground">{formatBytes(Number(info.disk_total_bytes || 0))}</div>
          <div className="text-[10px] text-foreground/40 mt-0.5">
            Genutzt: {formatBytes(Number(info.disk_used_bytes || 0))} · Frei: {formatBytes(Number(info.disk_free_bytes || 0))}
          </div>
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <button onClick={load} className={ccBtnSecondary('text-xs')}>
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </AdminCard>
  )
}

// ─── Dev Bridge: Dateisystem ────────────────────────────────────────────


export function DevBridgeFilesystem({ devToken }: { devToken: string | null }) {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<Array<{ name: string; path: string; kind: string; size: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; bytes: number; total_bytes: number; truncated: boolean; binary_hint: boolean } | null>(null)
  const [pathHistory, setPathHistory] = useState<string[]>(['/'])

  const listDir = useCallback(async (path: string) => {
    if (!devToken) return
    setLoading(true)
    setError('')
    setSelectedFile(null)
    try {
      const res = await devBridgeFetch('/dev/fs/list', devToken, {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setEntries(data.entries || [])
      setCurrentPath(data.path || path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken])

  useEffect(() => { if (devToken) listDir('/') }, [devToken, listDir])

  const navigateTo = (path: string) => {
    setPathHistory(prev => [...prev, path])
    listDir(path)
  }

  const goBack = () => {
    if (pathHistory.length <= 1) return
    const prev = pathHistory.slice(0, -1)
    setPathHistory(prev)
    listDir(prev[prev.length - 1])
  }

  const readFile = async (path: string) => {
    if (!devToken) return
    try {
      const res = await devBridgeFetch('/dev/fs/read', devToken, {
        method: 'POST',
        body: JSON.stringify({ path, max_bytes: 64 * 1024 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSelectedFile(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  if (!devToken) return null

  if (loading && entries.length === 0) return <LoadingSpinner />
  if (error && entries.length === 0) return <ErrorMessage>{error}</ErrorMessage>

  const parentPath = currentPath === '/' ? '/' : currentPath.split('/').slice(0, -1).join('/') || '/'

  return (
    <div className="space-y-3">
      <AdminCard title={`Dateisystem: ${currentPath}`} icon={FolderOpen}>
        {/* Navigation */}
        <div className="flex items-center gap-2 mb-3">
          <button onClick={goBack} disabled={pathHistory.length <= 1}
            className={`px-2 py-1 rounded-lg text-xs ${pathHistory.length <= 1 ? 'text-foreground/30' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'}`}>
            ← Zurück
          </button>
          <span className="text-xs text-foreground/40 font-mono truncate">{currentPath}</span>
          <button onClick={() => listDir(currentPath)} className={ccBtnIcon('ml-auto')}>
            <ArrowClockwise size={14} />
          </button>
        </div>

        <div className="max-h-[400px] overflow-y-auto space-y-0.5">
          {entries.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-8">Leeres Verzeichnis</p>
          ) : entries.map(entry => (
            <div key={entry.path}
              onClick={() => entry.kind === 'dir' ? navigateTo(entry.path) : readFile(entry.path)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-foreground/5 cursor-pointer transition-colors group">
              <span className={`text-xs ${
                entry.kind === 'dir' ? 'text-accent' :
                entry.kind === 'symlink' ? 'text-cyan-400' :
                'text-foreground/50'
              }`}>
                {entry.kind === 'dir' ? <FolderOpen size={13} /> : entry.kind === 'symlink' ? <LinkSimple size={13} /> : <File size={13} />}
              </span>
              <span className="text-xs text-foreground/80 font-mono truncate flex-1">{entry.name}</span>
              <span className="text-[10px] text-foreground/40 group-hover:text-foreground/60 transition-colors">
                {entry.kind === 'file' ? formatFileSize(entry.size) : ''}
              </span>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Datei-Ansicht */}
      {selectedFile && (
        <AdminCard title={selectedFile.path} icon={Code}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-foreground/50">
              <span>{formatFileSize(selectedFile.total_bytes)}</span>
              {selectedFile.truncated && <span className="text-amber-400">(gekürzt, erste {formatFileSize(selectedFile.bytes)})</span>}
              {selectedFile.binary_hint && <span className="text-red-400">(binär)</span>}
            </div>
            <div className="max-h-[500px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3">
              {selectedFile.binary_hint ? (
                <p className="text-foreground/50 text-center py-4">Binäre Datei kann nicht als Text angezeigt werden.</p>
              ) : (
                <pre className="text-foreground/80 whitespace-pre-wrap">{selectedFile.content}</pre>
              )}
            </div>
          </div>
        </AdminCard>
      )}
    </div>
  )
}


export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

// ─── Dev Bridge: Build & Replace ────────────────────────────────────────


export function DevBridgeBuild({ devToken }: { devToken: string | null }) {
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [component, setComponent] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

  // Self-Update State
  const [selfUpdateSource, setSelfUpdateSource] = useState<'http' | 'ssh' | 'ftp'>('http')
  const [suUrl, setSuUrl] = useState('')
  const [suHost, setSuHost] = useState('')
  const [suPath, setSuPath] = useState('/usr/bin/iora-dev-bridge')
  const [suUser, setSuUser] = useState('root')
  const [suPort, setSuPort] = useState('22')
  const [suKeyPath, setSuKeyPath] = useState('/root/.ssh/id_rsa')
  const [suPassword, setSuPassword] = useState('')
  const [suSha, setSuSha] = useState('')
  const [suInsecure, setSuInsecure] = useState(false)
  const [suRunning, setSuRunning] = useState(false)
  const [suResult, setSuResult] = useState<string | null>(null)

  const handleReplace = async () => {
    if (!devToken || !target) return
    setBuilding(true)
    setStatus(null)
    try {
      // Read the binary file from local machine via file input
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return

        const formData = new FormData()
        formData.append('target', target)
        if (unit) formData.append('unit', unit)
        formData.append('file', file)

        const res = await fetch(`${getDevBridgeUrl()}/dev/replace-binary`, {
          method: 'POST',
          headers: devToken ? { 'x-iora-dev-token': devToken } : {},
          body: formData,
        })

        const data = await res.json()
        setStatus(JSON.stringify(data, null, 2))
        if (data.restart?.ok) toast.success('Binary ersetzt und Dienst neu gestartet')
        else toast.error('Fehler beim Ersetzen')
        setBuilding(false)
      }
      input.click()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
      setBuilding(false)
    }
  }

  // ── Self-Update Handler ──────────────────────────────────────
  const handleSelfUpdate = async () => {
    if (!devToken) return
    setSuRunning(true)
    setSuResult(null)

    const body: Record<string, unknown> = { source: selfUpdateSource }

    if (selfUpdateSource === 'http' || selfUpdateSource === 'ftp') {
      if (!suUrl) { toast.error('Bitte eine URL angeben'); setSuRunning(false); return }
      body.url = suUrl
      if (selfUpdateSource === 'ftp') {
        body.user = suUser
        if (suPassword) body.password = suPassword
      }
    } else if (selfUpdateSource === 'ssh') {
      if (!suHost) { toast.error('Bitte Host angeben'); setSuRunning(false); return }
      body.host = suHost
      body.path = suPath
      body.user = suUser
      body.port = parseInt(suPort) || 22
      body.key_path = suKeyPath
    }

    if (suSha) body.expected_sha = suSha
    if (suInsecure) body.insecure = true

    try {
      const res = await fetch(`${getDevBridgeUrl()}/dev/self-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-iora-dev-token': devToken,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setSuResult(JSON.stringify(data, null, 2))
      if (data.ok) {
        toast.success('Self-Update gestartet! Die Dev Bridge wird neu gestartet…')
      } else {
        toast.error('Self-Update fehlgeschlagen: ' + (data.error || 'Unbekannter Fehler'))
      }
    } catch (e) {
      setSuResult(e instanceof Error ? e.message : String(e))
      toast.error('Self-Update fehlgeschlagen')
    }
    setSuRunning(false)
  }

  if (!devToken) return null

  return (
    <div className="space-y-4">
      {/* Binary Replace */}
      <AdminCard title="Binary Replace" icon={Code}>
        <div className="space-y-4">
          <p className="text-xs text-foreground/60">
            Ersetze ein Binary auf dem Gerät und starte den zugehörigen Dienst neu.
            Der Upload erfolgt per Datei-Auswahl.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label className={ccLabel}>Target-Pfad</label>
              <input type="text" value={target} onChange={e => setTarget(e.target.value)}
                placeholder="/usr/bin/iora-home" className={ccInput()} />
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Systemd-Unit (optional)</label>
              <input type="text" value={unit} onChange={e => setUnit(e.target.value)}
                placeholder="iora-home.service" className={ccInput()} />
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Component (für Build)</label>
              <input type="text" value={component} onChange={e => setComponent(e.target.value)}
                placeholder="iora-home" className={ccInput()} />
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={handleReplace} disabled={building || !target} className={ccBtnPrimary()}>
              {building ? 'Wird hochgeladen…' : 'Binary auswählen & ersetzen'}
            </button>
          </div>

          {status && (
            <div className="rounded-xl bg-black/20 border border-foreground/10 p-3">
              <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-[300px] overflow-y-auto">{status}</pre>
            </div>
          )}
        </div>
      </AdminCard>

      {/* Self-Update: Dev Bridge via SSH/FTP/HTTP */}
      <AdminCard title="Dev Bridge Self-Update" icon={Terminal}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Warning size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-200 mb-1">⚠️  Achtung</p>
              <p className="text-[10px] text-amber-200/70">
                Dies ersetzt <code className="font-mono">/usr/bin/iora-dev-bridge</code> auf dem Gerät und
                startet den Dienst neu. Die aktuelle Verbindung wird dabei getrennt.
                Der Dev Bridge muss dann von der CLI/IDE neu verbunden werden.
              </p>
            </div>
          </div>

          {/* Source selector */}
          <div className="flex gap-1.5">
            {([
              { id: 'http' as const, label: 'HTTP/HTTPS', icon: Globe },
              { id: 'ssh' as const, label: 'SSH/SCP', icon: Terminal },
              { id: 'ftp' as const, label: 'FTP', icon: CloudArrowUp },
            ]).map(src => (
              <button key={src.id} onClick={() => setSelfUpdateSource(src.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selfUpdateSource === src.id ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground hover:bg-foreground/8'
                }`}>
                <src.icon size={12} className="inline mr-1" />
                {src.label}
              </button>
            ))}
          </div>

          {/* HTTP source */}
          {selfUpdateSource === 'http' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <label className={ccLabel}>Download-URL</label>
                <input type="url" value={suUrl} onChange={e => setSuUrl(e.target.value)}
                  placeholder="https://build-server.local/iora-dev-bridge-latest" className={ccInput()} />
              </div>
              <label className="flex items-center gap-2 text-xs text-foreground/70 cursor-pointer">
                <input type="checkbox" checked={suInsecure} onChange={e => setSuInsecure(e.target.checked)}
                  className="h-4 w-4 rounded border-foreground/30" />
                TLS-Verifikation deaktivieren (--insecure)
              </label>
            </div>
          )}

          {/* SSH source */}
          {selfUpdateSource === 'ssh' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className={ccLabel}>Host</label>
                <input type="text" value={suHost} onChange={e => setSuHost(e.target.value)}
                  placeholder="192.168.2.100" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>Remote-Pfad</label>
                <input type="text" value={suPath} onChange={e => setSuPath(e.target.value)}
                  placeholder="/usr/bin/iora-dev-bridge" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>SSH-Benutzer</label>
                <input type="text" value={suUser} onChange={e => setSuUser(e.target.value)}
                  placeholder="root" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>SSH-Port</label>
                <input type="number" value={suPort} onChange={e => setSuPort(e.target.value)}
                  placeholder="22" min={1} max={65535} className={ccInput()} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <label className={ccLabel}>SSH-Key-Pfad (auf dem Gerät)</label>
                <input type="text" value={suKeyPath} onChange={e => setSuKeyPath(e.target.value)}
                  placeholder="/root/.ssh/id_rsa" className={ccInput()} />
              </div>
            </div>
          )}

          {/* FTP source */}
          {selfUpdateSource === 'ftp' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <label className={ccLabel}>FTP-URL</label>
                <input type="url" value={suUrl} onChange={e => setSuUrl(e.target.value)}
                  placeholder="ftp://build-server.local/iora-dev-bridge-latest" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>FTP-Benutzer</label>
                <input type="text" value={suUser} onChange={e => setSuUser(e.target.value)}
                  placeholder="anonymous" className={ccInput()} />
              </div>
              <div className="grid gap-1.5">
                <label className={ccLabel}>FTP-Passwort</label>
                <input type="password" value={suPassword} onChange={e => setSuPassword(e.target.value)}
                  placeholder="optional" className={ccInput()} />
              </div>
            </div>
          )}

          {/* Optional SHA */}
          <div className="grid gap-1.5">
            <label className={ccLabel}>SHA-256 Hash (optional — zur Verifikation)</label>
            <input type="text" value={suSha} onChange={e => setSuSha(e.target.value)}
              placeholder="a1b2c3d4..." className={ccInput('font-mono')} />
          </div>

          <div className="flex gap-2">
            <button onClick={handleSelfUpdate} disabled={suRunning || !devToken} className={ccBtnDanger()}>
              {suRunning ? (
                <><CircleNotch size={14} className="animate-spin mr-1" /> Lade herunter & ersetze…</>
              ) : (
                <><Terminal size={14} className="mr-1" /> Dev Bridge Self-Update starten</>
              )}
            </button>
          </div>

          {suResult && (
            <div className="rounded-xl bg-black/20 border border-foreground/10 p-3">
              <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-[300px] overflow-y-auto">{suResult}</pre>
            </div>
          )}
        </div>
      </AdminCard>
    </div>
  )
}


export function DevBridgeJournal({ devToken }: { devToken: string | null }) {
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tail, setTail] = useState(200)
  const [priority, setPriority] = useState('warning')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadLogs = useCallback(async (t?: number, p?: string) => {
    if (!devToken) return
    setLoading(true)
    setError('')
    try {
      const tVal = t ?? tail
      const pVal = p ?? priority
      const res = await devBridgeFetch(`/dev/system/journal?tail=${tVal}&priority=${encodeURIComponent(pVal)}`, devToken)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const stdout = data.stdout || ''
      setLogs(stdout.split('\n').filter(Boolean))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }, [devToken, tail, priority])

  useEffect(() => { if (devToken) loadLogs() }, [devToken, loadLogs])

  // Auto-Refresh
  useEffect(() => {
    if (autoRefresh && devToken) {
      autoRefreshRef.current = setInterval(() => loadLogs(), 10_000)
    } else if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current)
      autoRefreshRef.current = null
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current) }
  }, [autoRefresh, devToken, loadLogs])

  if (!devToken) return null

  return (
    <AdminCard title="System-Journal" icon={ListBullets}>
      <div className="space-y-3">
        {/* Filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <select value={priority} onChange={e => { setPriority(e.target.value); loadLogs(tail, e.target.value) }}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-foreground/5 border border-foreground/10 text-foreground">
            <option value="emerg">emerg</option>
            <option value="alert">alert</option>
            <option value="crit">crit</option>
            <option value="error">error</option>
            <option value="warning">warning</option>
            <option value="notice">notice</option>
            <option value="info">info</option>
            <option value="debug">debug</option>
          </select>
          <select value={tail} onChange={e => { setTail(Number(e.target.value)); loadLogs(Number(e.target.value), priority) }}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-foreground/5 border border-foreground/10 text-foreground">
            <option value={50}>50 Zeilen</option>
            <option value={200}>200 Zeilen</option>
            <option value={500}>500 Zeilen</option>
            <option value={1000}>1000 Zeilen</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-foreground/60 cursor-pointer ml-2">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-foreground/30" />
            Auto-Refresh (10s)
          </label>
          <button onClick={() => loadLogs()} disabled={loading} className={ccBtnSecondary('text-xs ml-auto')}>
            <ArrowClockwise size={12} className={loading ? 'animate-spin' : ''} /> Aktualisieren
          </button>
        </div>

        {/* Log-Ansicht */}
        {loading && logs.length === 0 ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage>{error}</ErrorMessage>
        ) : logs.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-8">Keine Log-Einträge gefunden.</p>
        ) : (
          <div className="max-h-[500px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3 space-y-0.5">
            {logs.map((line, i) => {
              const level = line.includes('EMERG') || line.includes('emerg') ? 'text-red-300' :
                line.includes('ALERT') || line.includes('alert') ? 'text-red-400' :
                line.includes('CRIT') || line.includes('crit') ? 'text-red-500' :
                line.includes('ERR') || line.includes('error') ? 'text-red-400' :
                line.includes('WARN') || line.includes('warning') ? 'text-amber-400' :
                line.includes('NOTICE') || line.includes('notice') ? 'text-blue-400' :
                line.includes('INFO') || line.includes('info') ? 'text-foreground/70' :
                line.includes('DEBUG') || line.includes('debug') ? 'text-foreground/40' :
                'text-foreground/60'
              return (
                <div key={i} className={`${level} truncate hover:text-foreground hover:bg-foreground/5 px-1 rounded transition-colors`}>
                  {line}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AdminCard>
  )
}

// ─── Dev Bridge: Docker Compose ─────────────────────────────────────────


export function DevBridgeCompose({ devToken }: { devToken: string | null }) {
  const [svcName, setSvcName] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [composeLogs, setComposeLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(false)

  const handleReload = async () => {
    if (!devToken || !svcName) return
    setLoading(true)
    setStatus(null)
    try {
      const res = await devBridgeFetch(`/dev/compose/${encodeURIComponent(svcName)}/reload`, devToken, { method: 'POST' })
      const data = await res.json()
      setStatus(JSON.stringify(data, null, 2))
      if (data.ok) toast.success(`${svcName} wird neu geladen…`)
      else toast.error('Fehler beim Neuladen')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
      toast.error('Fehler beim Neuladen')
    }
    setLoading(false)
  }

  const handleLogs = async () => {
    if (!devToken || !svcName) return
    setLoading(true)
    try {
      const res = await devBridgeFetch(`/dev/compose/${encodeURIComponent(svcName)}/logs`, devToken, {
        method: 'POST',
        body: JSON.stringify({ tail: 100 }),
      })
      const data = await res.json()
      const stdout = data.stdout || ''
      setComposeLogs(stdout.split('\n').filter(Boolean))
      setShowLogs(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  if (!devToken) return null

  return (
    <AdminCard title="Docker Compose Services" icon={Cube}>
      <div className="space-y-4">
        <p className="text-xs text-foreground/60">
          Steuere Docker-Compose-Services im IORA-Compose-Verzeichnis ({' '}
          <code className="font-mono">{'/mnt/data/iora'}</code> ).
        </p>

        <div className="flex gap-2">
          <input type="text" value={svcName} onChange={e => setSvcName(e.target.value)}
            placeholder="Service-Name (z.B. iora-home)" className={ccInput('flex-1')}
            onKeyDown={e => e.key === 'Enter' && handleReload()} />
          <button onClick={handleReload} disabled={loading || !svcName} className={ccBtnSecondary()}>
            <ArrowClockwise size={14} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>
          <button onClick={handleLogs} disabled={loading || !svcName} className={ccBtnPrimary()}>
            <ListBullets size={14} />
            Logs
          </button>
        </div>

        {status && (
          <div className="rounded-xl bg-black/20 border border-foreground/10 p-3">
            <pre className="text-[10px] font-mono text-foreground/70 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{status}</pre>
          </div>
        )}

        {showLogs && composeLogs.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground/70">Logs: {svcName}</span>
              <button onClick={() => setShowLogs(false)} className={ccBtnIcon()}>
                <X size={14} />
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto font-mono text-[10px] leading-relaxed bg-black/20 rounded-xl p-3 space-y-0.5">
              {composeLogs.map((line, i) => (
                <div key={i} className={`${
                  line.includes('ERROR') || line.includes('error') ? 'text-red-400' :
                  line.includes('WARN') || line.includes('warn') ? 'text-amber-400' :
                  'text-foreground/70'
                } truncate`}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminCard>
  )
}


// ─── Secrets (iora-secrets) ─────────────────────────────────────────────



export function OsSshTab({ token }: { token: string }) {
  const [status, setStatus] = useState<{ enabled?: boolean; running?: boolean } | null>(null)
  const [users, setUsers] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newUser, setNewUser] = useState('')
  const [pubKey, setPubKey] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, u] = await Promise.all([
        adminFetch(OS_BASE + '/ssh/status', token),
        adminFetch(OS_BASE + '/ssh/users', token),
      ])
      setStatus(s as { enabled?: boolean; running?: boolean })
      setUsers(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/ssh/enable', token, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      })
      toast.success(enabled ? 'SSH aktiviert' : 'SSH deaktiviert')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const addUser = async () => {
    if (!newUser.trim() || !pubKey.trim()) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/ssh/users', token, {
        method: 'POST',
        body: JSON.stringify({ username: newUser.trim(), public_key: pubKey.trim() }),
      })
      toast.success('SSH-Benutzer hinzugefuegt')
      setNewUser('')
      setPubKey('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const removeUser = async (username: string) => {
    if (!confirm("SSH-Benutzer '" + username + "' entfernen?")) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/ssh/users/' + encodeURIComponent(username), token, { method: 'DELETE' })
      toast.success('Benutzer entfernt')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="SSH-Server-Status" icon={Terminal}>
        {loading && <p className="text-xs text-foreground/50">Lade...</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {status && (
          <div className="flex items-center gap-3">
            <span className={'px-2 py-0.5 rounded-full text-xs font-semibold ' + (status.running ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300')}>
              {status.running ? 'Aktiv' : 'Inaktiv'}
            </span>
            <span className="text-xs text-foreground/60">Aktiviert beim Boot: {status.enabled ? 'ja' : 'nein'}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => toggle(true)} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">SSH aktivieren</button>
              <button onClick={() => toggle(false)} disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40">SSH deaktivieren</button>
            </div>
          </div>
        )}
        {status && <div className="mt-3"><ServiceJsonBlock data={status} /></div>}
      </AdminCard>

      <AdminCard title="SSH-Benutzer hinzufuegen" icon={Plus}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="Benutzername"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <input value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder="ssh-ed25519 AAAA..."
            className="sm:col-span-2 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground font-mono" />
        </div>
        <button onClick={addUser} disabled={busy || !newUser.trim() || !pubKey.trim()}
          className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">Hinzufuegen</button>
      </AdminCard>

      <AdminCard title="Bestehende SSH-Benutzer" icon={Users}>
        {users !== null && <ServiceJsonBlock data={users} max="max-h-96" />}
        {Array.isArray((users as { users?: unknown[] })?.users) && ((users as { users: { username: string }[] }).users).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(users as { users: { username: string }[] }).users.map((u) => (
              <button key={u.username} onClick={() => removeUser(u.username)}
                className="px-2 py-1 text-xs rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25">
                {u.username} entfernen
              </button>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  )
}


export function OsNetworkConfigTab({ token }: { token: string }) {
  const [interfaces, setInterfaces] = useState<any[]>([])
  const [currentIp, setCurrentIp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<'dhcp' | 'static' | 'dhcp-v4-only' | 'dhcp-v6-only' | 'hybrid'>('dhcp')
  const [ipv4, setIpv4] = useState('')
  const [gateway4, setGateway4] = useState('')
  const [ipv6, setIpv6] = useState('')
  const [gateway6, setGateway6] = useState('')
  const [dns4Primary, setDns4Primary] = useState('')
  const [dns4Secondary, setDns4Secondary] = useState('')
  const [dns6Primary, setDns6Primary] = useState('')
  const [dns6Secondary, setDns6Secondary] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  // Validation
  const isValidIpv4 = (value: string) => {
    const [address, prefix] = value.split('/')
    const octets = address.split('.')
    if (octets.length !== 4) return false
    if (!octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)) return false
    return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= 32)
  }
  const isValidIpv6 = (value: string) => {
    const [address, prefix] = value.split('/')
    if (!address.includes(':') || address.length < 3) return false
    return prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= 128)
  }
  const isValidDns = (value: string) => !value || isValidIpv4(value) || isValidIpv6(value)
  const isFormValid = () => {
    if (mode === 'dhcp') return true
    if (mode === 'static' || mode === 'dhcp-v6-only') {
      if (ipv4 && !isValidIpv4(ipv4)) return false
    }
    if (mode === 'static' || mode === 'dhcp-v4-only') {
      if (ipv6 && !isValidIpv6(ipv6)) return false
    }
    if (mode === 'hybrid') {
      if (ipv4 && !isValidIpv4(ipv4)) return false
      if (ipv6 && !isValidIpv6(ipv6)) return false
    }
    if (![dns4Primary, dns4Secondary, dns6Primary, dns6Secondary].every(isValidDns)) return false
    return true
  }

  const loadStatus = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const healthRes = await fetch(getBackendUrl() + '/api/health', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (healthRes.ok) {
        const health = await healthRes.json()
        const v4 = (health.ipv4_addrs || [health.ipv4_addrs].filter(Boolean)) as string[]
        const v6 = (health.ipv6_addrs || [health.ipv6_addrs].filter(Boolean)) as string[]
        const all = [...(Array.isArray(health.ipv4_addrs) ? health.ipv4_addrs : [health.ipv4_addrs].filter(Boolean)),
                     ...(Array.isArray(health.ipv6_addrs) ? health.ipv6_addrs : [health.ipv6_addrs].filter(Boolean))]
        const seen = new Set<string>()
        const parsed: any[] = []
        for (const addr of all) {
          const m = String(addr).match(/^(.+?)\s+\((.+?)\)$/)
          if (m && !seen.has(m[2])) {
            seen.add(m[2])
            const iv4 = v4.find((a: string) => a.includes(`(${m[2]})`))
            const iv6 = v6.find((a: string) => a.includes(`(${m[2]})`))
            parsed.push({
              name: m[2],
              ipv4: iv4 ? String(iv4).split(' ')[0] : '-',
              ipv6: iv6 ? String(iv6).split(' ')[0] : '-',
            })
          }
        }
        setInterfaces(parsed.length > 0 ? parsed : [{ name: 'eth0', ipv4: '—', ipv6: '—' }])
        const primary = typeof health.primary_ipv4 === 'string'
          ? health.primary_ipv4
          : (parsed.find((iface) => iface.ipv4 && iface.ipv4 !== '-')?.ipv4 || '').split('/')[0]
        setCurrentIp(primary)

        // Try to load current config via iora-control
        try {
          const netRes = await adminFetch(OS_BASE + '/os/network', token)
          const content: string = netRes?.netctl?.content || netRes?.content || ''
          if (content) {
            if (content.includes('DHCP=yes')) setMode('dhcp')
            else if (content.includes('DHCP=ipv4')) setMode('dhcp-v4-only')
            else if (content.includes('DHCP=ipv6')) setMode('dhcp-v6-only')
            else if (content.includes('Address=')) setMode('static')
            const v4a = content.match(/^Address=([0-9.]+\/\d+)$/m)
            const v6a = content.match(/^Address=([0-9a-f:]+\/\d+)$/mi)
            if (v4a) setIpv4(v4a[1])
            if (v6a) setIpv6(v6a[1])
            const g4 = content.match(/^Gateway=([0-9.]+)$/m)
            const g6 = content.match(/^Gateway=([0-9a-f:]+)$/mi)
            if (g4) setGateway4(g4[1])
            if (g6) setGateway6(g6[1])
            const dnsLines = content.match(/^DNS=(.+)$/gm)
            if (dnsLines) {
              const dnsList = dnsLines.map(l => l.replace(/^DNS=/, '').trim())
              const dns4 = dnsList.filter(isValidIpv4)
              const dns6 = dnsList.filter(isValidIpv6)
              if (dns4[0]) setDns4Primary(dns4[0])
              if (dns4[1]) setDns4Secondary(dns4[1])
              if (dns6[0]) setDns6Primary(dns6[0])
              if (dns6[1]) setDns6Secondary(dns6[1])
            }
          }
        } catch {}
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { loadStatus() }, [loadStatus])

  const doApply = async () => {
    setSaving(true); setShowConfirm(false)
    try {
      const dns4 = [dns4Primary, dns4Secondary].map((value) => value.trim()).filter(Boolean)
      const dns6 = [dns6Primary, dns6Secondary].map((value) => value.trim()).filter(Boolean)
      const config: Record<string, any> = {
        mode,
        ipv4_config: {
          method: showV4 ? 'static' : 'dhcp',
          address: ipv4.trim(),
          gateway: gateway4.trim(),
          dns: dns4,
        },
        ipv6_config: {
          method: showV6 ? 'static' : 'dhcp',
          address: ipv6.trim(),
          gateway: gateway6.trim(),
          dns: dns6,
        },
      }
      if (mode === 'static' || mode === 'dhcp-v6-only' || mode === 'hybrid') {
        if (ipv4.trim()) config.ipv4 = ipv4.trim()
        if (gateway4.trim()) config.gateway4 = gateway4.trim()
      }
      if (mode === 'static' || mode === 'dhcp-v4-only' || mode === 'hybrid') {
        if (ipv6.trim()) config.ipv6 = ipv6.trim()
        if (gateway6.trim()) config.gateway6 = gateway6.trim()
      }
      const dnsList = [...dns4, ...dns6]
      if (dnsList.length > 0) config.dns = dnsList

      await adminFetch(OS_BASE + '/os/network/set', token, {
        method: 'POST', body: JSON.stringify(config),
      })
      setSaved(true)
      toast.success('Netzwerkkonfiguration wurde übernommen')
      setTimeout(() => {
        setSaved(false)
        loadStatus()
      }, 3000)
    } catch (e) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    } finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />

  const showV4 = mode === 'static' || mode === 'dhcp-v6-only' || mode === 'hybrid'
  const showV6 = mode === 'static' || mode === 'dhcp-v4-only' || mode === 'hybrid'

  return (
    <div className="space-y-6">
      {/* ── Live network status ── */}
      <AdminCard icon={WifiHigh} title="Live-Netzwerkstatus">
        <p className="text-xs text-foreground/50 mb-3">
          Alle Netzwerkschnittstellen mit aktuellen IP-Adressen (IPv4 + IPv6)
        </p>
        {currentIp && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/15 bg-accent/[0.06] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent/80">Aktuelle IP</span>
            <code className="text-xs font-mono text-foreground/90">{currentIp}</code>
            <button onClick={() => { navigator.clipboard.writeText(currentIp); toast.success('Aktuelle IP kopiert') }}
              className="p-1 rounded text-foreground/35 hover:text-accent transition-colors" title="Kopieren">
              <Copy size={12} />
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400 mb-2 bg-red-500/10 p-2 rounded-lg">{error}</p>}
        <div className="space-y-2">
          {interfaces.map((iface, i) => (
            <div key={i} className="flex items-center gap-4 p-3.5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] hover:border-foreground/10 transition-colors">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iface.ipv4 !== '-' ? 'bg-success/10' : 'bg-foreground/5'}`}>
                <Globe size={18} className={iface.ipv4 !== '-' ? 'text-success' : 'text-foreground/30'} weight="fill" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground capitalize">{iface.name}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider w-8">IPv4</span>
                    <code className={`text-[11px] font-mono ${iface.ipv4 !== '-' ? 'text-foreground/80' : 'text-foreground/30'}`}>
                      {iface.ipv4}
                    </code>
                    {iface.ipv4 !== '-' && (
                      <button onClick={() => { navigator.clipboard.writeText(iface.ipv4.split('/')[0]); toast.success('IPv4 kopiert') }}
                        className="p-0.5 rounded text-foreground/20 hover:text-foreground/50 transition-colors" title="Kopieren">
                        <Copy size={10} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider w-8">IPv6</span>
                    <code className={`text-[11px] font-mono ${iface.ipv6 !== '-' ? 'text-foreground/80' : 'text-foreground/30'}`}>
                      {iface.ipv6 !== '-' ? iface.ipv6 : '—'}
                    </code>
                    {iface.ipv6 !== '-' && (
                      <button onClick={() => { navigator.clipboard.writeText(iface.ipv6.split('/')[0]); toast.success('IPv6 kopiert') }}
                        className="p-0.5 rounded text-foreground/20 hover:text-foreground/50 transition-colors" title="Kopieren">
                        <Copy size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={loadStatus} className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors">
          Neu laden
        </button>
      </AdminCard>

      {/* ── IP-Konfiguration ── */}
      <AdminCard icon={Gear} title="IP-Konfiguration">
        <p className="text-xs text-foreground/50 mb-5 leading-relaxed">
          Wähle aus, wie dein Gerät IP-Adressen bezieht. Bei <strong>„Statisch"</strong> oder <strong>„Hybrid"</strong>
          kannst du feste Adressen eingeben. Die Einstellungen werden sofort aktiv.
        </p>

        {/* ── Modus-Auswahl ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 mb-6">
          {[
            { id: 'dhcp' as const, label: 'DHCP (Auto)', icon: Globe, desc: 'IPv4 + IPv6 automatisch', detail: 'Der Router weist Adressen zu' },
            { id: 'dhcp-v4-only' as const, label: 'DHCPv4 + Statisches IPv6', icon: WifiHigh, desc: 'IPv4 automatisch', detail: 'IPv6 gibst du manuell ein' },
            { id: 'dhcp-v6-only' as const, label: 'Statisches IPv4 + DHCPv6', icon: ShareNetwork, desc: 'IPv6 automatisch', detail: 'IPv4 gibst du manuell ein' },
            { id: 'static' as const, label: 'Vollständig statisch', icon: MapPin, desc: 'Alles manuell', detail: 'IPv4 + IPv6 fest vergeben' },
            { id: 'hybrid' as const, label: 'Hybrid', icon: LinkSimple, desc: 'DHCP + Extra-IPs', detail: 'DHCP + zusätzliche statische IPs' },
          ].map(opt => (
            <button key={opt.id} onClick={() => setMode(opt.id)}
              className={`relative p-3.5 rounded-xl border-2 transition-all text-left group ${
                mode === opt.id
                  ? 'border-accent bg-accent/[0.08] shadow-sm shadow-accent/10'
                  : 'border-foreground/8 bg-foreground/[0.02] hover:border-foreground/20 hover:bg-foreground/[0.04]'
              }`}>
              <opt.icon size={18} className={`mb-2 ${mode === opt.id ? 'text-accent' : 'text-foreground/60'}`} weight="duotone" />
              <p className={`text-[12px] font-semibold leading-tight ${mode === opt.id ? 'text-accent' : 'text-foreground'}`}>{opt.label}</p>
              <p className="text-[10px] text-foreground/50 mt-0.5 leading-tight">{opt.detail}</p>
              {mode === opt.id && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent" />}
            </button>
          ))}
        </div>

        {/* ── IPv4 Felder ── */}
        {showV4 && (
          <div className="mb-5 p-4 rounded-xl border border-blue-500/15 bg-blue-500/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">IPv4</span>
              <span className="text-[9px] text-foreground/40">Nur bei statischer IPv4-Konfiguration nötig</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">IP-Adresse</label>
                <input value={ipv4} onChange={e => setIpv4(e.target.value)}
                  placeholder="z.B. 192.168.1.100/24"
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${
                    ipv4 && !isValidIpv4(ipv4) ? 'bg-red-500/10 border border-red-500/30 text-red-300' :
                    'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'
                  } focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                {ipv4 && !isValidIpv4(ipv4) && <p className="text-[9px] text-red-400 mt-1">Ungültiges Format (z.B. 192.168.1.100/24)</p>}
              </div>
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Gateway (Standardroute)</label>
                <input value={gateway4} onChange={e => setGateway4(e.target.value)}
                  placeholder="z.B. 192.168.1.1"
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20 focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20 transition-colors" />
              </div>
            </div>
          </div>
        )}

        {/* ── IPv6 Felder ── */}
        {showV6 && (
          <div className="mb-5 p-4 rounded-xl border border-purple-500/15 bg-purple-500/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">IPv6</span>
              <span className="text-[9px] text-foreground/40">Nur bei statischer IPv6-Konfiguration nötig</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">IPv6-Adresse</label>
                <input value={ipv6} onChange={e => setIpv6(e.target.value)}
                  placeholder="z.B. 2001:db8::1/64"
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${
                    ipv6 && !isValidIpv6(ipv6) ? 'bg-red-500/10 border border-red-500/30 text-red-300' :
                    'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'
                  } focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                {ipv6 && !isValidIpv6(ipv6) && <p className="text-[9px] text-red-400 mt-1">Ungültiges Format (z.B. 2001:db8::1/64)</p>}
              </div>
              <div>
                <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Gateway IPv6</label>
                <input value={gateway6} onChange={e => setGateway6(e.target.value)}
                  placeholder="z.B. 2001:db8::1"
                  className="w-full px-3 py-2.5 rounded-xl text-xs font-mono bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20 focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20 transition-colors" />
              </div>
            </div>
          </div>
        )}

        {/* ── DNS ── */}
        <div className="mb-5 p-4 rounded-xl border border-amber-500/15 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">DNS-Server</span>
            <span className="text-[9px] text-foreground/40">IPv4 und IPv6 werden getrennt abgelegt</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
              <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-foreground/70"><Globe size={14} /> IPv4 DNS</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Bevorzugt</label>
                  <input value={dns4Primary} onChange={e => setDns4Primary(e.target.value)}
                    placeholder="z.B. 1.1.1.1"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns4Primary && !isValidDns(dns4Primary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Alternativ</label>
                  <input value={dns4Secondary} onChange={e => setDns4Secondary(e.target.value)}
                    placeholder="z.B. 8.8.8.8"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns4Secondary && !isValidDns(dns4Secondary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
              <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-foreground/70"><ShareNetwork size={14} /> IPv6 DNS</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Bevorzugt</label>
                  <input value={dns6Primary} onChange={e => setDns6Primary(e.target.value)}
                    placeholder="z.B. 2606:4700:4700::1111"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns6Primary && !isValidDns(dns6Primary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-foreground/50 mb-1 block">Alternativ</label>
                  <input value={dns6Secondary} onChange={e => setDns6Secondary(e.target.value)}
                    placeholder="z.B. 2001:4860:4860::8888"
                    className={`w-full px-3 py-2.5 rounded-xl text-xs font-mono transition-colors ${dns6Secondary && !isValidDns(dns6Secondary) ? 'bg-red-500/10 border border-red-500/30 text-red-300' : 'bg-foreground/[0.04] border border-foreground/10 text-foreground hover:border-foreground/20'} focus:border-accent/50 focus:outline-none focus:bg-accent/5 placeholder:text-foreground/20`} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Buttons ── */}
        <div className="flex items-center gap-3">
          {showConfirm ? (
            <>
              <div className="flex-1 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-foreground/70">
                <span className="inline-flex items-center gap-1.5"><Warning size={14} className="text-amber-400" /> Die Konfiguration wird sofort übernommen. Bei Fehlern setzt iora-netctl automatisch zurück.</span>
              </div>
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2.5 rounded-xl border border-foreground/10 text-xs text-foreground/50 hover:bg-foreground/5 transition-colors shrink-0">
                Abbrechen
              </button>
              <button onClick={doApply} disabled={!isFormValid()}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 transition-all shrink-0">
                Bestätigen
              </button>
            </>
          ) : saved ? (
            <div className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-success/10 border border-success/20">
              <CheckCircle size={16} className="text-success shrink-0" />
              <span className="text-xs text-success">Konfiguration wurde erfolgreich übernommen</span>
            </div>
          ) : (
            <button onClick={() => setShowConfirm(true)} disabled={!isFormValid() || saving}
              className="w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-accent text-white hover:bg-accent/90 disabled:opacity-40 shadow-sm shadow-accent/20">
              {saving ? <><div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Wird angewendet…</> : 'Konfiguration übernehmen'}
            </button>
          )}
        </div>
      </AdminCard>
    </div>
  )
}

export interface OsDisk { name: string; mount_point: string; file_system: string; total_bytes: number; available_bytes: number; used_bytes: number; usage_percent: number; is_removable: boolean }

export function OsDisksTab({ token }: { token: string }) {
  const [data, setData] = useState<{ disks?: OsDisk[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch(OS_BASE + '/os/disks', token)
      setData(r as { disks?: OsDisk[] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const fmt = (n: number) => {
    if (n < 1024) return n + ' B'
    const u = ['KB', 'MB', 'GB', 'TB']
    let v = n / 1024, i = 0
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return v.toFixed(1) + ' ' + u[i]
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Festplatten & Dateisysteme" icon={HardDrive}>
        {loading && <p className="text-xs text-foreground/50">Lade...</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {data?.disks && (
          <div className="space-y-2">
            {data.disks.map((d, i) => (
              <div key={i} className="rounded-lg border border-foreground/10 p-3 bg-foreground/5">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-semibold text-foreground">{d.mount_point}</div>
                    <div className="text-[10px] text-foreground/50">{d.name} - {d.file_system}{d.is_removable ? ' - removable' : ''}</div>
                  </div>
                  <div className="text-xs text-foreground/70">{fmt(d.used_bytes)} / {fmt(d.total_bytes)}</div>
                </div>
                <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                  <div className={'h-full ' + (d.usage_percent > 90 ? 'bg-red-500' : d.usage_percent > 75 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: Math.min(100, d.usage_percent) + '%' }} />
                </div>
                <div className="text-[10px] text-foreground/50 mt-1">{d.usage_percent.toFixed(1)} % belegt - {fmt(d.available_bytes)} frei</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={load} className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30">Aktualisieren</button>
      </AdminCard>
    </div>
  )
}

export interface OsProc { pid: number; name: string; cpu_percent: number; memory_bytes: number }

export function OsProcessesTab({ token }: { token: string }) {
  const [data, setData] = useState<{ processes?: OsProc[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await adminFetch(OS_BASE + '/os/processes', token)
      setData(r as { processes?: OsProc[] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!auto) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [auto, load])

  const fmtMem = (n: number) => {
    const u = ['B','KB','MB','GB']; let v = n, i = 0
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return v.toFixed(1) + ' ' + u[i]
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Top-Prozesse (CPU)" icon={Pulse}>
        <div className="flex items-center gap-3 mb-3">
          <button onClick={load} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30">Aktualisieren</button>
          <label className="text-xs text-foreground/70 flex items-center gap-1.5">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-Refresh (3s)
          </label>
        </div>
        {loading && <p className="text-xs text-foreground/50">Lade...</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {data?.processes && (
          <div className="overflow-auto max-h-[32rem]">
            <table className="w-full text-xs">
              <thead className="text-foreground/60 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left py-1">PID</th><th className="text-left">Name</th><th className="text-right">CPU %</th><th className="text-right">RAM</th></tr>
              </thead>
              <tbody className="font-mono">
                {data.processes.map((p) => (
                  <tr key={p.pid} className="border-t border-foreground/5">
                    <td className="py-1 pr-2">{p.pid}</td>
                    <td className="pr-2 truncate max-w-[260px]">{p.name}</td>
                    <td className="text-right pr-2">{p.cpu_percent.toFixed(1)}</td>
                    <td className="text-right">{fmtMem(p.memory_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
    </div>
  )
}


export function OsPowerTab({ token }: { token: string }) {
  const [hostname, setHostname] = useState('')
  const [current, setCurrent] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [delay, setDelay] = useState(5)

  const load = useCallback(async () => {
    try {
      const r = await adminFetch(OS_BASE + '/os/hostname', token) as { hostname?: string }
      setCurrent(r.hostname || '')
      if (!hostname) setHostname(r.hostname || '')
    } catch (e) {
      console.error(e)
    }
  }, [token, hostname])
  useEffect(() => { load() }, [load])

  const saveHostname = async () => {
    if (!hostname.trim()) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/os/hostname', token, {
        method: 'PUT',
        body: JSON.stringify({ hostname: hostname.trim() }),
      })
      toast.success('Hostname gesetzt')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const power = async (action: 'reboot' | 'shutdown') => {
    const label = action === 'reboot' ? 'IORA OS jetzt neu starten' : 'IORA OS jetzt herunterfahren'
    if (!confirm(label + '? (Verzoegerung: ' + delay + 's)')) return
    setBusy(true)
    try {
      await adminFetch(OS_BASE + '/os/' + action, token, {
        method: 'POST',
        body: JSON.stringify({ delay_seconds: delay, reason: 'admin-panel' }),
      })
      toast.success(action === 'reboot' ? 'Neustart geplant' : 'Shutdown geplant')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Hostname" icon={Gear}>
        <p className="text-xs text-foreground/60 mb-2">Aktueller Hostname: <code className="text-accent">{current || '-'}</code></p>
        <div className="flex gap-2">
          <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="iora-os"
            className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground font-mono" />
          <button onClick={saveHostname} disabled={busy || !hostname.trim() || hostname === current}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40">Speichern</button>
        </div>
        <p className="text-[10px] text-foreground/50 mt-2">Erfordert Root-Rechte auf dem Host (hostnamectl/hostname). Persistiert in <code>/etc/hostname</code>.</p>
      </AdminCard>

      <AdminCard title="System neu starten / herunterfahren" icon={Power}>
        <p className="text-xs text-amber-300 mb-3 flex items-center gap-1.5">
          <Warning size={14} /> Diese Aktionen beenden alle laufenden Container und Dienste auf dem IORA-OS-Host.
        </p>
        <label className="text-xs text-foreground/70 flex items-center gap-2 mb-3">
          Verzoegerung:
          <input type="number" min={0} max={3600} value={delay} onChange={(e) => setDelay(Math.max(0, parseInt(e.target.value || '0', 10)))}
            className="w-20 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1 text-foreground" />
          Sekunden
        </label>
        <div className="flex gap-2">
          <button onClick={() => power('reboot')} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 disabled:opacity-40 flex items-center gap-1.5">
            <ArrowClockwise size={14} /> Neustart
          </button>
          <button onClick={() => power('shutdown')} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40 flex items-center gap-1.5">
            <Power size={14} /> Herunterfahren
          </button>
        </div>
      </AdminCard>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Health Intelligence Tab — AI-powered system analysis & self-repair insights
// ═══════════════════════════════════════════════════════════════════════════

export interface IntelligenceData {
  overall_score: number
  overall_status: string
  services: HealthScoreEntry[]
  anomalies: AnomalyEntry[]
  suggestions: SuggestionEntry[]
  maintenance_tasks: MaintenanceTaskEntry[]
  metrics: SystemMetricsData
  timestamp: string
}

export interface HealthScoreEntry {
  service_name: string
  score: number
  trend: 'improving' | 'stable' | 'degrading' | 'critical'
  status: string
  uptime_percent: number
  response_time_ms: number | null
  consecutive_failures: number
  predicted_failure_in: string | null
  suggestions: string[]
}

export interface AnomalyEntry {
  anomaly_type: string
  service_name: string
  severity: string
  description: string
  current_value: string
  baseline_value: string
  detected_at: string
}

export interface SuggestionEntry {
  priority: number
  category: string
  title: string
  description: string
  action: string
  auto_fixable: boolean
  auto_fix_command: string | null
}

export interface MaintenanceTaskEntry {
  task_type: string
  last_run: string | null
  next_run: string
  status: string
  auto_enabled: boolean
}

export interface SystemMetricsData {
  cpu_percent: number
  memory_used_mb: number
  memory_total_mb: number
  memory_percent: number
  disk_used_gb: number
  disk_total_gb: number
  disk_percent: number
  uptime_hours: number
  service_count: number
  healthy_count: number
}
