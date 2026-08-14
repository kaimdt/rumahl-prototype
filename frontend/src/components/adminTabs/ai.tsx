import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Brain, ChartLine, ChatCircle, Code, Database, Desktop, Hand, MagicWand, Microphone, PaperPlaneTilt, Plus, Robot, Trash } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getDevBridgeUrl } from '@/lib/config'
import { AdminCard, adminFetch, baseUrlFor, formatUptime } from '../AdminPanel'
export function AiOverviewTab({ token }: { token: string }) {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
      try { return await p } catch { return null }
    }
    const [h, s, p] = await Promise.all([
      safe(adminFetch('/api/assist/health', token)),
      safe(adminFetch('/api/assist/config/stats', token)),
      safe(adminFetch('/api/assist/providers', token)),
    ])
    setHealth(h as Record<string, unknown> | null)
    setStats(s as Record<string, unknown> | null)
    setProviders(p as Record<string, unknown> | null)
    if (!h && !s && !p) setError('iora-assist ist nicht erreichbar.')
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const stat = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
      <div className="text-[10px] uppercase tracking-wide text-foreground/40">{label}</div>
      <div className="text-base font-semibold text-foreground mt-1">{value}</div>
      {sub && <div className="text-[11px] text-foreground/50 mt-0.5">{sub}</div>}
    </div>
  )

  const aiAvailable = health?.ai_available === true
  const providerName = String(health?.ai_provider ?? '–')
  const uptime = Number(health?.uptime_seconds ?? 0)
  const caps = (health?.capabilities ?? {}) as Record<string, boolean>

  return (
    <div className="space-y-3">
      <AdminCard title="IORA Assist Status" icon={Brain}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade Status…</p>
        ) : error ? (
          <p className="text-xs text-red-300">{error}</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {stat('Provider', providerName, aiAvailable ? 'verbunden' : 'getrennt')}
              {stat('Uptime', formatUptime(uptime))}
              {stat('Status', aiAvailable ? 'OK' : 'OFFLINE')}
              {stat('Service', String(health?.service ?? 'iora-assist'))}
            </div>

            <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
              <div className="text-xs font-semibold text-foreground mb-2">Fähigkeiten</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(caps).map(([k, v]) => (
                  <span key={k} className={`text-[11px] px-2 py-0.5 rounded-full ${v ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
                    {k} {v ? '✓' : '×'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </AdminCard>

      {stats && (
        <AdminCard title="Orchestrator Statistiken" icon={ChartLine}>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 max-h-72 overflow-auto">{JSON.stringify(stats?.stats ?? stats, null, 2)}</pre>
        </AdminCard>
      )}

      {providers && (
        <AdminCard title="Aktive Provider" icon={MagicWand}>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 max-h-72 overflow-auto">{JSON.stringify(providers, null, 2)}</pre>
        </AdminCard>
      )}

      <div className="flex justify-center">
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/10 transition-colors border border-foreground/10 disabled:opacity-40">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ─── AI Providers ───────────────────────────────────────────────────────
export interface AiProviderConfig {
  id?: string
  provider_type: string
  purpose: string
  config?: Record<string, unknown>
  priority?: number
  enabled?: boolean
  // Set by 008 migration; backend returns these via SELECT *
  model_count?: number
  last_model_fetch_at?: string | null
  last_model_fetch_error?: string | null
}

// Mirrors the response of `GET /api/assist/models`
export interface GlobalModelsGroup {
  provider_id: string
  provider_type: string
  purpose: string
  is_live: boolean
  model_count: number
  models: Array<{ id: string; name: string; last_seen?: string; is_live?: boolean }>
}


export function AiProvidersTab({ token }: { token: string }) {
  const [active, setActive] = useState<Record<string, unknown> | null>(null)
  const [list, setList] = useState<AiProviderConfig[]>([])
  const [globalModels, setGlobalModels] = useState<GlobalModelsGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [providerType, setProviderType] = useState('openai')
  const [purpose, setPurpose] = useState('chat')
  const [priority, setPriority] = useState(0)
  const [configJson, setConfigJson] = useState('{\n  "api_key": "",\n  "model": "gpt-4o-mini"\n}')
  const [saving, setSaving] = useState(false)

  const [switchTarget, setSwitchTarget] = useState('')
  const [switching, setSwitching] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [a, l, m] = await Promise.all([
        adminFetch('/api/assist/providers', token).catch(() => null),
        adminFetch('/api/assist/config/providers', token).catch(() => null),
        adminFetch('/api/assist/models', token).catch(() => null),
      ])
      setActive(a as Record<string, unknown> | null)
      const arr = (l as Record<string, unknown> | null)?.providers
      setList(Array.isArray(arr) ? (arr as AiProviderConfig[]) : [])
      const groups = (m as Record<string, unknown> | null)?.providers
      setGlobalModels(Array.isArray(groups) ? (groups as GlobalModelsGroup[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setSaving(true); setError(null)
    let cfg: Record<string, unknown>
    try { cfg = JSON.parse(configJson) } catch (e) {
      setError(`Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`)
      setSaving(false); return
    }
    try {
      await adminFetch('/api/assist/config/providers', token, {
        method: 'POST',
        body: JSON.stringify({ provider_type: providerType, purpose, priority, config: cfg }),
      })
      toast.success('Provider gespeichert — Modelle werden im Hintergrund geladen')
      setShowForm(false)
      // Give the backend a moment to fetch models, then reload.
      setTimeout(load, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const refreshModels = async (providerId: string) => {
    setRefreshingId(providerId); setError(null)
    try {
      const res: any = await adminFetch(
        `/api/assist/config/providers/${providerId}/refresh-models`,
        token,
        { method: 'POST' },
      )
      toast.success(`${res?.model_count ?? 0} Modelle aktualisiert`)
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Refresh fehlgeschlagen: ${msg}`)
      toast.error(`Refresh fehlgeschlagen: ${msg}`)
    } finally {
      setRefreshingId(null)
    }
  }

  const deleteProvider = async (providerId: string) => {
    if (!confirm('Provider löschen? Verknüpfte Modelle werden ebenfalls entfernt.')) return
    try {
      await adminFetch(`/api/assist/config/providers/${providerId}`, token, { method: 'DELETE' })
      toast.success('Provider gelöscht')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const switchProvider = async () => {
    if (!switchTarget.trim()) return
    setSwitching(true); setError(null)
    try {
      await adminFetch('/api/assist/providers/switch', token, {
        method: 'POST',
        body: JSON.stringify({ provider: switchTarget }),
      })
      toast.success(`Aktiver Provider: ${switchTarget}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSwitching(false)
    }
  }

  const totalModels = globalModels.reduce((sum, g) => sum + g.model_count, 0)

  // Pre-fill helpful config templates when the user picks a provider type.
  const configTemplate = (t: string): string => {
    switch (t) {
      case 'openai':
        return '{\n  "api_key": "sk-...",\n  "model": "gpt-4o-mini",\n  "base_url": "https://api.openai.com/v1"\n}'
      case 'anthropic':
        return '{\n  "api_key": "sk-ant-...",\n  "model": "claude-3-5-sonnet-latest",\n  "base_url": "https://api.anthropic.com"\n}'
      case 'local':
        return '{\n  "base_url": "",\n  "model": "llama3.2"\n}'
      case 'desktop':
        return '{\n  "base_url": "https://your-desktop-ai-proxy/v1",\n  "api_key": "lm-studio",\n  "model": "auto"\n}'
      case 'deepseek':
        return '{\n  "api_key": "sk-...",\n  "model": "deepseek-chat",\n  "base_url": "https://api.deepseek.com"\n}'
      case 'grok':
        return '{\n  "api_key": "xai-...",\n  "model": "grok-2-latest",\n  "base_url": "https://api.x.ai/v1"\n}'
      case 'mistral':
        return '{\n  "api_key": "...",\n  "model": "mistral-large-latest",\n  "base_url": "https://api.mistral.ai/v1"\n}'
      case 'cohere':
        return '{\n  "api_key": "...",\n  "model": "command-r-plus",\n  "base_url": "https://api.cohere.com"\n}'
      case 'together':
        return '{\n  "api_key": "...",\n  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",\n  "base_url": "https://api.together.xyz/v1"\n}'
      case 'fireworks':
        return '{\n  "api_key": "...",\n  "model": "accounts/fireworks/models/llama-v3p1-70b-instruct",\n  "base_url": "https://api.fireworks.ai/inference/v1"\n}'
      case 'perplexity':
        return '{\n  "api_key": "pplx-...",\n  "model": "llama-3.1-sonar-large-128k-online",\n  "base_url": "https://api.perplexity.ai"\n}'
      case 'compatible':
        return '{\n  "api_key": "",\n  "base_url": "https://your-host/v1",\n  "model": "your-model"\n}'
      default:
        return '{}'
    }
  }

  const formatTime = (iso?: string | null) => {
    if (!iso) return 'nie'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Aktiver Provider" icon={MagicWand}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade…</p>
        ) : (
          <div className="space-y-3">
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/80 max-h-48 overflow-auto">{JSON.stringify(active, null, 2)}</pre>
            <div className="flex items-center gap-2">
              <input value={switchTarget} onChange={(e) => setSwitchTarget(e.target.value)}
                placeholder="openai | anthropic | local | desktop"
                className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
              <button onClick={switchProvider} disabled={switching || !switchTarget.trim()}
                className="ora-ghost-button-sm">
                {switching ? 'Wechsle…' : 'Provider wechseln'}
              </button>
            </div>
          </div>
        )}
      </AdminCard>

      <AdminCard title={`Globaler Model-Katalog (${totalModels} Modelle)`} icon={Brain}>
        <p className="text-[11px] text-foreground/50 mb-2">
          Modelle werden beim Anlegen eines Providers automatisch geladen, alle 30&nbsp;Min. für Cloud-Provider
          und alle 60&nbsp;Sek. für lokale/Desktop-Provider aktualisiert. Sie stehen global für ORA AI
          und das Agent-System zur Verfügung.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try { await adminFetch('/api/assist/models/refresh', token, { method: 'POST' }); toast.success('Refresh angestoßen'); await load() } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
            }}
            className="ora-ghost-button-sm"
          >
            Alle Modelle jetzt aktualisieren
          </button>
        </div>
      </AdminCard>

      <AdminCard title="Konfigurierte Provider" icon={Database}>
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => setShowForm((s) => !s)}
            className="ora-ghost-button-sm">
            {showForm ? 'Abbrechen' : <span className="flex items-center gap-1"><Plus size={12} /> Neu</span>}
          </button>
          <button onClick={load} disabled={loading}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>

        {showForm && (
          <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3 mb-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-foreground/40">Typ</label>
                <select value={providerType}
                  onChange={(e) => { setProviderType(e.target.value); setConfigJson(configTemplate(e.target.value)) }}
                  className="w-full mt-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="grok">xAI (Grok)</option>
                  <option value="mistral">Mistral</option>
                  <option value="cohere">Cohere</option>
                  <option value="together">Together AI</option>
                  <option value="fireworks">Fireworks AI</option>
                  <option value="perplexity">Perplexity</option>
                  <option value="local">Local (Ollama / llama.cpp)</option>
                  <option value="desktop">Desktop (IORA Desktop bridge / LM Studio)</option>
                  <option value="compatible">OpenAI-Compatible (custom)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-foreground/40">Verwendung</label>
                <select value={purpose} onChange={(e) => setPurpose(e.target.value)}
                  className="w-full mt-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground">
                  <option value="chat">chat</option>
                  <option value="general">general</option>
                  <option value="agent">agent (Code-Aufgaben)</option>
                  <option value="voice_stt">voice_stt</option>
                  <option value="voice_tts">voice_tts</option>
                  <option value="embeddings">embeddings</option>
                  <option value="vision">vision</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-foreground/40">Priorität</label>
                <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))}
                  className="w-full mt-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-foreground/40">Konfiguration (JSON)</label>
              <textarea value={configJson} onChange={(e) => setConfigJson(e.target.value)} rows={6} spellCheck={false}
                className="w-full mt-1 font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
              <p className="text-[10px] text-foreground/40 mt-1">
                Beim Speichern werden verfügbare Modelle automatisch beim Provider abgerufen und gespeichert.
              </p>
            </div>
            <button onClick={create} disabled={saving}
              className="ora-ghost-button-sm">
              {saving ? 'Speichere…' : 'Provider anlegen + Modelle laden'}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}

        {list.length === 0 ? (
          <p className="text-xs text-foreground/50">Keine konfigurierten Provider in der Datenbank.</p>
        ) : (
          <div className="space-y-2">
            {list.map((p, i) => {
              const group = globalModels.find((g) => g.provider_id === p.id)
              return (
                <div key={p.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-foreground">{p.provider_type}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{p.purpose}</span>
                    {group?.is_live && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">live</span>
                    )}
                    <span className="ml-auto text-[10px] text-foreground/40">prio: {p.priority ?? 0}</span>
                    {p.id && (
                      <>
                        <button
                          onClick={() => refreshModels(p.id!)}
                          disabled={refreshingId === p.id}
                          title="Modelle für diesen Provider neu laden"
                          className="px-2 py-0.5 text-[10px] rounded bg-foreground/10 text-foreground/70 hover:bg-foreground/20 disabled:opacity-40"
                        >
                          {refreshingId === p.id ? 'Lade…' : 'Refresh'}
                        </button>
                        <button
                          onClick={() => deleteProvider(p.id!)}
                          title="Provider löschen"
                          className="px-2 py-0.5 text-[10px] rounded bg-red-500/15 text-red-300 hover:bg-red-500/30"
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-foreground/50 mb-2">
                    <span>Modelle: <span className="text-foreground/80 font-mono">{p.model_count ?? group?.model_count ?? 0}</span></span>
                    <span>Letztes Update: <span className="font-mono">{formatTime(p.last_model_fetch_at)}</span></span>
                  </div>
                  {p.last_model_fetch_error && (
                    <p className="text-[10px] text-red-300 mb-2 font-mono">⚠ {p.last_model_fetch_error}</p>
                  )}
                  {group && group.models.length > 0 && (
                    <details className="mb-2">
                      <summary className="text-[10px] text-foreground/50 cursor-pointer hover:text-foreground/80">
                        Modelle anzeigen ({group.models.length})
                      </summary>
                      <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {group.models.map((m) => (
                          <span key={m.id} className="text-[10px] font-mono px-2 py-1 rounded bg-foreground/5 text-foreground/70 truncate">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                  {p.config && (
                    <details>
                      <summary className="text-[10px] text-foreground/40 cursor-pointer hover:text-foreground/70">Konfiguration</summary>
                      <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-words bg-foreground/5 rounded p-2 text-foreground/70 max-h-32 overflow-auto">{JSON.stringify(p.config, null, 2)}</pre>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── AI Conversations ───────────────────────────────────────────────────
export interface AiHistoryMsg { id: string; role: string; content: string; timestamp?: string }
export interface AiThread { id?: string; user_id?: string; created_at?: string; context?: unknown; message_count?: number }
export interface AiPendingNotification { id?: string; message: string; notification_type?: string; priority?: number; created_at?: string }


export function AiConversationsTab({ token }: { token: string }) {
  const [history, setHistory] = useState<AiHistoryMsg[]>([])
  const [threads, setThreads] = useState<AiThread[]>([])
  const [notifications, setNotifications] = useState<AiPendingNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'history' | 'threads' | 'notifications'>('history')

  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  const [notifMsg, setNotifMsg] = useState('')
  const [notifType, setNotifType] = useState('info')
  const [notifPrio, setNotifPrio] = useState(1)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [h, t, n] = await Promise.all([
        adminFetch('/api/assist/history', token).catch(() => null),
        adminFetch('/api/assist/config/threads', token).catch(() => null),
        adminFetch('/api/assist/config/notifications', token).catch(() => null),
      ])
      const hr = h as Record<string, unknown> | null
      const tr = t as Record<string, unknown> | null
      const nr = n as Record<string, unknown> | null
      setHistory(Array.isArray(hr?.messages) ? (hr.messages as AiHistoryMsg[]) : [])
      setThreads(Array.isArray(tr?.threads) ? (tr.threads as AiThread[]) : [])
      setNotifications(Array.isArray(nr?.notifications) ? (nr.notifications as AiPendingNotification[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const sendChat = async () => {
    if (!chatInput.trim()) return
    setChatBusy(true)
    try {
      await adminFetch('/api/assist/chat', token, {
        method: 'POST',
        body: JSON.stringify({ message: chatInput }),
      })
      setChatInput('')
      toast.success('Nachricht gesendet')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setChatBusy(false)
    }
  }

  const clearHistory = async () => {
    if (!confirm('Verlauf wirklich löschen?')) return
    try {
      await adminFetch('/api/assist/history/clear', token, { method: 'POST' })
      setHistory([])
      toast.success('Verlauf gelöscht')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const sendNotif = async () => {
    if (!notifMsg.trim()) return
    try {
      await adminFetch('/api/assist/config/notifications/send', token, {
        method: 'POST',
        body: JSON.stringify({ message: notifMsg, notification_type: notifType, priority: notifPrio }),
      })
      toast.success('Proaktive Benachrichtigung in Warteschlange')
      setNotifMsg('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Konversationen" icon={ChatCircle}>
        <div className="flex items-center gap-1 mb-3">
          {(['history', 'threads', 'notifications'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {v === 'history' ? `Verlauf (${history.length})` : v === 'threads' ? `Threads (${threads.length})` : `Benachrichtigungen (${notifications.length})`}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>

        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}

        {!loading && view === 'history' && (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} rows={2} placeholder="Test-Nachricht an den Assistenten…"
                className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
              <button onClick={sendChat} disabled={chatBusy || !chatInput.trim()}
                className="ora-ghost-button-sm">
                {chatBusy ? '…' : 'Senden'}
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={clearHistory} disabled={history.length === 0}
                className="text-[11px] text-red-300 hover:text-red-200 disabled:opacity-40 flex items-center gap-1"><Trash size={11} /> Verlauf löschen</button>
            </div>
            <div className="space-y-1.5 max-h-96 overflow-auto">
              {history.length === 0 ? (
                <p className="text-xs text-foreground/50">Kein Verlauf.</p>
              ) : history.map((m) => (
                <div key={m.id} className={`rounded-lg p-2.5 border ${m.role === 'user' ? 'bg-accent/10 border-accent/20' : 'bg-foreground/5 border-foreground/10'}`}>
                  <div className="text-[10px] font-mono text-foreground/40 uppercase">{m.role}</div>
                  <div className="text-xs text-foreground/85 whitespace-pre-wrap break-words mt-0.5">{m.content}</div>
                  {m.timestamp && <div className="text-[10px] text-foreground/30 mt-1">{m.timestamp}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && view === 'threads' && (
          <div className="space-y-2 max-h-96 overflow-auto">
            {threads.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine aktiven Threads.</p>
            ) : threads.map((t, i) => (
              <div key={t.id ?? i} className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
                <div className="text-xs font-mono text-foreground/70 break-all">{t.id ?? '–'}</div>
                <div className="text-[10px] text-foreground/40 mt-1">
                  {t.user_id && <span className="mr-2">user: {t.user_id}</span>}
                  {t.message_count !== undefined && <span className="mr-2">msgs: {t.message_count}</span>}
                  {t.created_at && <span>seit: {new Date(t.created_at).toLocaleString('de-DE')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && view === 'notifications' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3 space-y-2">
              <div className="text-xs font-semibold text-foreground">Proaktive Benachrichtigung senden</div>
              <textarea value={notifMsg} onChange={(e) => setNotifMsg(e.target.value)} rows={2} placeholder="Nachricht…"
                className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-2 text-foreground" />
              <div className="flex items-center gap-2">
                <select value={notifType} onChange={(e) => setNotifType(e.target.value)}
                  className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1.5 text-foreground">
                  <option value="info">info</option>
                  <option value="reminder">reminder</option>
                  <option value="alert">alert</option>
                  <option value="suggestion">suggestion</option>
                </select>
                <input type="number" min={1} max={10} value={notifPrio} onChange={(e) => setNotifPrio(Number(e.target.value))}
                  className="w-20 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-2 py-1.5 text-foreground" />
                <button onClick={sendNotif} disabled={!notifMsg.trim()}
                  className="ora-ghost-button-sm ml-auto">
                  Senden
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-72 overflow-auto">
              {notifications.length === 0 ? (
                <p className="text-xs text-foreground/50">Keine ausstehenden Benachrichtigungen.</p>
              ) : notifications.map((n, i) => (
                <div key={n.id ?? i} className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
                  <div className="text-xs text-foreground/85 break-words">{n.message}</div>
                  <div className="text-[10px] text-foreground/40 mt-1 flex gap-2">
                    {n.notification_type && <span className="font-mono">{n.notification_type}</span>}
                    {n.priority !== undefined && <span>P{n.priority}</span>}
                    {n.created_at && <span>{new Date(n.created_at).toLocaleString('de-DE')}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── AI Tasks ───────────────────────────────────────────────────────────
export interface AiAutoTask {
  id?: string
  name?: string
  task_type?: string
  schedule?: string
  enabled?: boolean
  last_run?: string
  next_run?: string
  config?: Record<string, unknown>
}


export function AiTasksTab({ token }: { token: string }) {
  const [tasks, setTasks] = useState<AiAutoTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/assist/config/tasks', token)
      const arr = (r as Record<string, unknown>)?.tasks
      setTasks(Array.isArray(arr) ? (arr as AiAutoTask[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-3">
      <AdminCard title="Autonome AI-Aufgaben" icon={Robot}>
        <p className="text-xs text-foreground/60 mb-3">
          Hintergrund-Agenten, die der Conversation Manager periodisch
          ausführt — z. B. Routinen-Auswertung, Anomalie-Reports oder
          proaktive Vorschläge. Aktivierung erfolgt im AI-Provider-Tab
          oder direkt in der Datenbank.
        </p>
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {!loading && !error && tasks.length === 0 && (
          <p className="text-xs text-foreground/50">Keine autonomen Aufgaben aktiv.</p>
        )}
        <div className="space-y-2">
          {tasks.map((t, i) => (
            <div key={t.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-foreground">{t.name ?? t.id ?? 'Unbenannt'}</span>
                {t.task_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{t.task_type}</span>}
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${t.enabled ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
                  {t.enabled ? 'aktiv' : 'inaktiv'}
                </span>
              </div>
              <div className="text-[10px] text-foreground/40 flex gap-3 flex-wrap">
                {t.schedule && <span>Plan: <span className="font-mono">{t.schedule}</span></span>}
                {t.last_run && <span>letzter Lauf: {new Date(t.last_run).toLocaleString('de-DE')}</span>}
                {t.next_run && <span>nächster Lauf: {new Date(t.next_run).toLocaleString('de-DE')}</span>}
              </div>
              {t.config && Object.keys(t.config).length > 0 && (
                <pre className="text-[10px] font-mono whitespace-pre-wrap break-words bg-foreground/5 rounded p-2 text-foreground/70 max-h-32 overflow-auto mt-2">{JSON.stringify(t.config, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={load} disabled={loading}
            className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── AI Tools ───────────────────────────────────────────────────────────

export function AiToolsTab({ token }: { token: string }) {
  const [tab, setTab] = useState<'search' | 'scrape' | 'screenshot'>('search')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [maxResults, setMaxResults] = useState(5)
  const [url, setUrl] = useState('')

  const run = async () => {
    setBusy(true); setError(null); setResult(null)
    try {
      let endpoint = '', body: Record<string, unknown> = {}
      if (tab === 'search') { endpoint = '/api/assist/tools/search'; body = { query, max_results: maxResults } }
      else if (tab === 'scrape') { endpoint = '/api/assist/tools/scrape'; body = { url } }
      else { endpoint = '/api/assist/tools/screenshot'; body = { url } }
      const r = await adminFetch(endpoint, token, { method: 'POST', body: JSON.stringify(body) })
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="AI Tools" icon={Hand}>
        <p className="text-xs text-foreground/60 mb-3">
          Werkzeuge, die der Assistent intern für Tool-Calls nutzt. Hier
          direkt ausführbar zum Testen.
        </p>
        <div className="flex items-center gap-1 mb-3">
          {(['search', 'scrape', 'screenshot'] as const).map((t) => (
            <button key={t} onClick={() => { setTab(t); setResult(null); setError(null) }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                tab === t ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {t === 'search' ? 'Internet-Suche' : t === 'scrape' ? 'Web Scrapen' : 'Screenshot'}
            </button>
          ))}
        </div>

        {tab === 'search' ? (
          <div className="flex items-center gap-2 mb-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchbegriff…"
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <input type="number" min={1} max={20} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))}
              className="w-20 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={run} disabled={busy || !query.trim()}
              className="ora-ghost-button-sm">
              {busy ? '…' : 'Suchen'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-3">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={run} disabled={busy || !url.trim()}
              className="ora-ghost-button-sm">
              {busy ? '…' : (tab === 'scrape' ? 'Scrapen' : 'Aufnehmen')}
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}

        {result !== null && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/85 max-h-96 overflow-auto">{JSON.stringify(result, null, 2)}</pre>
        )}
      </AdminCard>
    </div>
  )
}

// ─── AI Voice ───────────────────────────────────────────────────────────

export function AiVoiceTab({ token }: { token: string }) {
  const [text, setText] = useState('Hallo, dies ist ein IORA Assist Sprachtest.')
  const [voice, setVoice] = useState('default')
  const [busy, setBusy] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [recError, setRecError] = useState<string | null>(null)
  const mediaRef = useState<{ rec?: MediaRecorder; chunks: Blob[] }>({ chunks: [] })[0]

  const synthesize = async () => {
    setBusy(true); setError(null); setAudioUrl(null)
    try {
      const r = await fetch(`${baseUrlFor('/api/assist/voice/synthesize')}/api/assist/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text, voice }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const blob = await r.blob()
      setAudioUrl(URL.createObjectURL(blob))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startRec = async () => {
    setRecError(null); setTranscript(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      mediaRef.chunks = []
      rec.ondataavailable = (e) => { if (e.data.size > 0) mediaRef.chunks.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(mediaRef.chunks, { type: 'audio/webm' })
        const fd = new FormData()
        fd.append('audio', blob, 'recording.webm')
        try {
          const r = await fetch(`${baseUrlFor('/api/assist/voice/transcribe')}/api/assist/voice/transcribe`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const j = await r.json()
          setTranscript(j.text ?? JSON.stringify(j))
        } catch (e) {
          setRecError(e instanceof Error ? e.message : String(e))
        }
      }
      mediaRef.rec = rec
      rec.start()
      setRecording(true)
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e))
    }
  }

  const stopRec = () => {
    mediaRef.rec?.stop()
    setRecording(false)
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Text-to-Speech" icon={PaperPlaneTilt}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
          className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
        <div className="flex items-center gap-2 mt-2">
          <input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="Stimme (default)"
            className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <button onClick={synthesize} disabled={busy || !text.trim()}
            className="ora-ghost-button-sm">
            {busy ? 'Synthetisiere…' : 'Sprechen'}
          </button>
        </div>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {audioUrl && <audio controls src={audioUrl} className="w-full mt-3" />}
      </AdminCard>

      <AdminCard title="Speech-to-Text (STT)" icon={Microphone}>
        <p className="text-xs text-foreground/60 mb-3">
          Aufnahme über das Browser-Mikrofon, Transkription via
          /api/assist/voice/transcribe.
        </p>
        <div className="flex items-center gap-2">
          {!recording ? (
            <button onClick={startRec}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-500/20 text-red-200 hover:bg-red-500/30 flex items-center gap-1.5">
              <Microphone size={13} /> Aufnahme starten
            </button>
          ) : (
            <button onClick={stopRec}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-500/30 text-red-100 animate-pulse flex items-center gap-1.5">
              <Hand size={13} /> Stoppen
            </button>
          )}
        </div>
        {recError && <p className="text-xs text-red-300 mt-2">{recError}</p>}
        {transcript && (
          <div className="mt-3 rounded-xl bg-foreground/5 border border-foreground/10 p-3">
            <div className="text-[10px] uppercase tracking-wide text-foreground/40 mb-1">Transkript</div>
            <div className="text-xs text-foreground/85 whitespace-pre-wrap">{transcript}</div>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// CONNECTED DEVICES TAB
// ════════════════════════════════════════════════════════════════════════
//
// Shows every dashboard client (IORA Desktop, browser tabs, kiosks)
// that has registered with iora-home, plus a live count of currently
// connected WebSocket clients. Backed by /api/admin/devices, which
// pairs the `devices` DB table with `ws_manager.client_count()`.

export interface AdminDevice {
  id: string
  device_name: string
  device_type?: string | null
  user_agent?: string | null
  is_terminal?: boolean
  terminal_name?: string | null
  assigned_profile_id?: string | null
  last_seen: string
  created_at: string
  online: boolean
  seconds_since_seen: number
}

export interface AdminDevicesPayload {
  devices: AdminDevice[]
  total: number
  online: number
  connected_ws_clients: number
  online_threshold_seconds: number
}

// ═════════════════════════════════════════════════════════════════
// Dev Bridge Tab — IORA OS Dev Bridge Management
// ═════════════════════════════════════════════════════════════════
//
// Vollständige Integration der iora-dev-bridge (Port 8101) ins WebUI:
// - Service-Status und Logs (auch Live-Stream über SSE)
// - System-Info (CPU, RAM, Disk, Uptime)
// - Docker-Compose-Management
// - Dateisystem-Browser und Datei-Reader
// - Binary Build und Replace

/**
 * Ruft einen Dev-Bridge-Endpunkt auf. Authentifizierung erfolgt wahlweise
 * per Session-Token (Bearer, via /dev/auth) oder per Statischem Dev-Token.
 */
export async function devBridgeFetch(path: string, devToken?: string | null, options?: RequestInit): Promise<Response> {
  const baseUrl = getDevBridgeUrl()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (devToken) {
    headers['x-iora-dev-token'] = devToken
  }
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  })
}
