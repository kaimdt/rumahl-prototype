import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, ArrowClockwise, Bell, Broadcast, CheckCircle, Clock, CloudArrowUp, CloudWarning, Copy, Cpu, Cube, Database, Dog, Eye, Globe, HardDrive, Heartbeat, Key, Lightning, ListBullets, ListChecks, MagnifyingGlass, Megaphone, PaperPlaneTilt, Play, Plug, Plus, Pulse, ShieldWarning, Siren, Stack, Terminal, Timer, ToggleLeft, ToggleRight, Trash, TrendUp, UserMinus, Users, Warning, WebhooksLogo, X, XCircle } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ui/confirmDialog'
import { Tip } from '@/components/ui/tip'
import { getBackendUrl } from '@/lib/config'
import { AdminCard, ErrorMessage, InlineSpinner, LoadingSpinner, StatItem, adminFetch, backendBase, cachedFetch, ccBtnIcon, ccBtnPrimary, ccBtnSecondary, ccCard, ccInput, ccLabel, ccSelect, ccTextarea, formatUptime, notifyError, CLOUD_ENABLE_REVERSE_PROXY_KEY, CLOUD_HOST_KEY, CLOUD_PRIVATE_PORT_KEY, CLOUD_PUBLIC_PORT_KEY, CLOUD_REQUIRE_VPN_KEY, CLOUD_USE_TLS_KEY, type ApiKeyEntry, ApiKeyWithSecret, CloudSettings, WarningLogEntry } from '../AdminPanel'
import { EventGroup, EventOccurrence, EventStats, rumahlLogEntry, Origin, Severity } from './network'
export function CloudSettingsTab({ token }: { token: string }) {
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
      await adminFetch('/api/admin/rumahl-cloud/config', token, {
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

    toast.success('rumahl Cloud Einstellungen gespeichert')
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
      <div className={ccCard()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
            <CloudArrowUp size={18} className="text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">rumahl Cloud Connector</p>
            <p className="text-[11px] text-foreground/40">Konfiguriere den Connector mit IP, Ports und Verschlüsselung.</p>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <label className={ccLabel}>Connector Host / IP</label>
            <input type="text" value={settings.connectorHost} onChange={(e) => setSettings({ ...settings, connectorHost: e.target.value })} placeholder="10.0.0.2" className={ccInput()} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <label className={ccLabel}>Protokoll</label>
              <select value={settings.useTls ? 'https' : 'http'} onChange={(e) => setSettings({ ...settings, useTls: e.target.value === 'https' })} className={ccSelect()}>
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Privater API Port</label>
              <input type="number" min={1} max={65535} value={settings.privatePort} onChange={(e) => setSettings({ ...settings, privatePort: Number(e.target.value) || 3001 })} className={ccInput()} />
            </div>
            <div className="grid gap-1.5">
              <label className={ccLabel}>Öffentlicher Proxy-Port</label>
              <input type="number" min={1} max={65535} value={settings.publicProxyPort} onChange={(e) => setSettings({ ...settings, publicProxyPort: Number(e.target.value) || 443 })} className={ccInput()} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-4 py-3 text-sm text-foreground/80 cursor-pointer hover:border-foreground/[0.12] transition-all duration-200`}>
              <input type="checkbox" checked={settings.enableReverseProxy} onChange={(e) => setSettings({ ...settings, enableReverseProxy: e.target.checked })} className="h-4 w-4 rounded-md border-foreground/30 bg-transparent text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer" />
              Öffentlichen Reverse-Proxy aktivieren
            </label>
            <label className={`flex items-center gap-3 rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-4 py-3 text-sm text-foreground/80 cursor-pointer hover:border-foreground/[0.12] transition-all duration-200`}>
              <input type="checkbox" checked={settings.requireVpnOnly} onChange={(e) => setSettings({ ...settings, requireVpnOnly: e.target.checked })} className="h-4 w-4 rounded-md border-foreground/30 bg-transparent text-accent focus:ring-accent focus:ring-offset-0 cursor-pointer" />
              Nur VPN/Tailscale-Zugriff auf privaten Port
            </label>
          </div>

          <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4 text-sm text-foreground/70">
            <p className="font-semibold text-foreground flex items-center gap-1"><Warning size={14} className="text-amber-400" /> Wichtig</p>
            <p className="mt-2 text-[12px]">Der Connector soll auf allen ihm zugewiesenen IP-Adressen hören. Der private API-Port ist für interne Cloud-Verbindungen vorgesehen, der öffentliche Proxy-Port nur für verschlüsselte Zugriffe.</p>
            <p className="mt-1.5 text-[12px]">Diese Seite ist die einzige Stelle zur Einrichtung und Anpassung des rumahl Cloud Connectors.</p>
          </div>

          <div className="grid gap-1.5">
            <label className={ccLabel}>Berechnete Connector-URL</label>
            <div className={`${ccInput()} font-mono text-xs flex items-center justify-between gap-2`}>
              <span className="truncate">{currentUrl}</span>
              <button onClick={() => { navigator.clipboard.writeText(currentUrl); toast.success('URL kopiert') }} className={ccBtnIcon('flex-shrink-0')}><Copy size={14} /></button>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-2">
            <button onClick={saveSettings} disabled={saving || loading} className={ccBtnPrimary()}>
              {saving ? 'Speichert…' : 'Einstellungen speichern'}
            </button>
            <button onClick={testConnection} disabled={!settings.connectorHost.trim() || testState === 'testing'} className={ccBtnSecondary()}>
              {testState === 'testing' ? 'Teste Verbindung…' : 'Verbindung testen'}
            </button>
          </div>

          {testState === 'success' && testInfo && (
            <div className="rounded-xl border border-green-500/20 bg-green-500/[0.06] p-4">
              <p className="text-sm font-semibold text-green-400 flex items-center gap-1.5"><CheckCircle size={14} weight="fill" /> Verbindung erfolgreich</p>
              <div className="mt-2 space-y-1 text-[12px] text-foreground/60">
                <p>Status: online</p>
                <p>Home Assistant: {testInfo.ha ? 'verbunden' : 'nicht verbunden'}</p>
                <p>Entitäten: {testInfo.entities}</p>
              </div>
            </div>
          )}

          {testState === 'error' && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4">
              <p className="text-sm font-semibold text-red-400 flex items-center gap-1.5"><XCircle size={14} weight="fill" /> Verbindung fehlgeschlagen</p>
              <p className="mt-2 text-[12px] text-red-300">{testError}</p>
            </div>
          )}

          {error && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">{error}</div>}
        </div>
      </div>
    </div>
  )
}

export function ApiKeysTab({ token }: { token: string }) {
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
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (keyId: string) => {
    setActionLoading(keyId)
    try {
      await adminFetch(`/api/keys/${keyId}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
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
            className="rumahl-primary-button-sm"
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
                className="rumahl-field-sm w-full text-sm"
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
                  className="rumahl-field-sm w-full text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-foreground/80 mb-1 block">Gültig (Tage, 0=∞)</label>
                <input
                  type="number"
                  value={form.expires_in_days}
                  onChange={e => setForm({ ...form, expires_in_days: parseInt(e.target.value) || 0 })}
                  className="rumahl-field-sm w-full text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="rumahl-secondary-button-sm"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.name.trim() || actionLoading === 'create'}
                className="rumahl-primary-button-sm"
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


export function BackupsTab({ token }: { token: string }) {
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


export function LogsTab({ token }: { token: string }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<rumahlLogEntry[]>([])
  const [haLogs, setHaLogs] = useState<Array<{ line: string; severity: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all')
  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [liveMode, setLiveMode] = useState(false)
  const [activeView, setActiveView] = useState<'rumahl' | 'ha' | 'sources'>('rumahl')
  const [autoScroll, setAutoScroll] = useState(true)
  const logContainerRef = { current: null as HTMLDivElement | null }

  // Load initial logs
  const load = useCallback(async () => {
    setError('')
    try {
      const [rumahlData, haData] = await Promise.all([
        adminFetch('/api/admin/logs?limit=500' +
          (filter !== 'all' ? `&level=${filter}` : '') +
          (targetFilter ? `&target=${encodeURIComponent(targetFilter)}` : '') +
          (search ? `&search=${encodeURIComponent(search)}` : ''), token),
        adminFetch('/api/admin/ha/logs', token).catch(() => ({ log: [] })),
      ])
      setLogs((rumahlData.entries ?? []) as rumahlLogEntry[])
      setHaLogs(haData.log ?? [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token, filter, targetFilter, search])

  useEffect(() => { load() }, [load])

  // Live SSE mode
  useEffect(() => {
    if (!liveMode || activeView !== 'rumahl') return
    const es = new EventSource(`${backendBase()}/api/admin/logs/live${token ? `?token=${encodeURIComponent(token)}` : ''}`)
    es.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as rumahlLogEntry
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
    } catch (e) { notifyError(e) }
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
              <button onClick={() => setActiveView('rumahl')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'rumahl' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                rumahl System
              </button>
              <button onClick={() => setActiveView('ha')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'ha' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                Home Assistant
              </button>
              <button onClick={() => setActiveView('sources')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${activeView === 'sources' ? 'bg-accent/20 text-accent' : 'text-foreground/60 hover:text-foreground/80'}`}>
                {t('admin.logsSources.title', 'Dienste & Apps')}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeView === 'rumahl' && (
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

      {activeView === 'rumahl' && (
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
                    className="rumahl-field-sm w-full pl-7 pr-2 text-[11px] font-mono" />
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

          {/* rumahl Log Entries */}
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

      {activeView === 'sources' && (
        <SourceLogsView token={token} />
      )}
    </div>
  )
}

// ── Source Logs View (services / apps / plugins / docker) ────

export interface LogSource {
  id: string
  kind: string
  transport: string
  name: string
  running: boolean
  description?: string | null
}


export function SourceLogsView({ token }: { token: string }) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<LogSource[]>([])
  const [selected, setSelected] = useState<string>('self:rumahl-home')
  const [lines, setLines] = useState<number>(500)
  const [logLines, setLogLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [auto, setAuto] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | 'service' | 'app' | 'plugin' | 'docker' | 'self'>('all')

  const loadSources = useCallback(async () => {
    try {
      const data = await adminFetch('/api/admin/logs/sources', token)
      setSources((data.sources ?? []) as LogSource[])
    } catch (e) { setError((e as Error).message) }
  }, [token])

  const loadLogs = useCallback(async () => {
    if (!selected) return
    setError('')
    try {
      const data = await adminFetch(`/api/admin/logs/source/${encodeURIComponent(selected)}?lines=${lines}`, token)
      setLogLines((data.lines ?? []) as string[])
    } catch (e) {
      setError((e as Error).message)
      setLogLines([])
    }
    setLoading(false)
  }, [token, selected, lines])

  useEffect(() => { loadSources() }, [loadSources])
  useEffect(() => { loadLogs() }, [loadLogs])

  useEffect(() => {
    if (!auto) return
    const iv = setInterval(() => { loadLogs() }, 5000)
    return () => clearInterval(iv)
  }, [auto, loadLogs])

  const grouped = useMemo(() => {
    const g: Record<string, LogSource[]> = {}
    const list = kindFilter === 'all' ? sources : sources.filter(s => s.kind === kindFilter)
    for (const s of list) {
      const key = s.kind
      if (!g[key]) g[key] = []
      g[key].push(s)
    }
    return g
  }, [sources, kindFilter])

  const filteredLines = filter
    ? logLines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : logLines

  const kindLabel = (k: string) => {
    switch (k) {
      case 'self': return t('admin.logsSources.kind.self', 'rumahl Home')
      case 'service': return t('admin.logsSources.kind.service', 'Dienste (systemd)')
      case 'app': return t('admin.logsSources.kind.app', 'Apps')
      case 'plugin': return t('admin.logsSources.kind.plugin', 'Plugins')
      case 'docker': return t('admin.logsSources.kind.docker', 'Docker Container')
      default: return k
    }
  }
  const kindIcon = (k: string) => {
    switch (k) {
      case 'self': return <Terminal size={12} />
      case 'service': return <Cpu size={12} />
      case 'app': return <Cube size={12} />
      case 'plugin': return <Plug size={12} />
      case 'docker': return <Cube size={12} />
      default: return <ListBullets size={12} />
    }
  }

  const selectedSource = sources.find(s => s.id === selected)

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 md:col-span-4 lg:col-span-3">
        <AdminCard>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-foreground/70">
                {t('admin.logsSources.heading', 'Quellen')}
              </div>
              <button onClick={loadSources} className="p-1 rounded text-foreground/50 hover:text-accent hover:bg-accent/10 transition">
                <ArrowClockwise size={12} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {(['all', 'self', 'service', 'app', 'plugin', 'docker'] as const).map(k => (
                <button key={k} onClick={() => setKindFilter(k)}
                  className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium transition ${kindFilter === k ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                  {k === 'all' ? t('admin.logsSources.all', 'Alle') : kindLabel(k)}
                </button>
              ))}
            </div>
            <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1">
              {Object.entries(grouped).map(([kind, items]) => (
                <div key={kind} className="space-y-0.5">
                  <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-foreground/40 px-1 pt-1">
                    {kindIcon(kind)} {kindLabel(kind)} <span className="text-foreground/30">({items.length})</span>
                  </div>
                  {items.map(s => (
                    <button key={s.id} onClick={() => setSelected(s.id)}
                      title={s.description ?? s.id}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-[10px] transition ${selected === s.id ? 'bg-accent/15 text-accent border border-accent/30' : 'hover:bg-foreground/5 text-foreground/70 border border-transparent'}`}>
                      <span className="truncate">{s.name}</span>
                      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${s.running ? 'bg-green-400' : 'bg-foreground/20'}`} />
                    </button>
                  ))}
                </div>
              ))}
              {Object.keys(grouped).length === 0 && (
                <div className="text-[10px] text-foreground/40 text-center py-4">
                  {t('admin.logsSources.empty', 'Keine Quellen gefunden.')}
                </div>
              )}
            </div>
          </div>
        </AdminCard>
      </div>

      <div className="col-span-12 md:col-span-8 lg:col-span-9 space-y-3">
        <AdminCard>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              {selectedSource && kindIcon(selectedSource.kind)}
              <div className="text-xs font-medium text-foreground/80 truncate">
                {selectedSource?.name ?? selected}
              </div>
              {selectedSource && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${selectedSource.running ? 'bg-green-500/20 text-green-400' : 'bg-foreground/10 text-foreground/50'}`}>
                  {selectedSource.running ? t('admin.logsSources.running', 'aktiv') : t('admin.logsSources.stopped', 'inaktiv')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select value={lines} onChange={e => setLines(Number(e.target.value))}
                className="rumahl-field-sm text-[10px]">
                {[100, 200, 500, 1000, 2000, 5000].map(n => (
                  <option key={n} value={n}>{n} {t('admin.logsSources.lines', 'Zeilen')}</option>
                ))}
              </select>
              <button onClick={() => setAuto(!auto)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition ${auto ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
                <Broadcast size={11} weight={auto ? 'fill' : 'regular'} />
                {t('admin.logsSources.auto', 'Auto')}
              </button>
              <button onClick={loadLogs} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-foreground/70 hover:text-accent hover:bg-accent/10 transition">
                <ArrowClockwise size={11} /> {t('admin.logsSources.refresh', 'Aktualisieren')}
              </button>
            </div>
          </div>
          <div className="mt-2 relative">
            <MagnifyingGlass size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder={t('admin.logsSources.filterPlaceholder', 'Logs filtern...')}
              className="rumahl-field-sm w-full pl-7 pr-2 text-[11px] font-mono" />
          </div>
        </AdminCard>

        <AdminCard>
          {loading ? (
            <LoadingSpinner />
          ) : error ? (
            <ErrorMessage>{error}</ErrorMessage>
          ) : (
            <div className="max-h-[600px] overflow-y-auto font-mono text-[10px] leading-relaxed">
              {filteredLines.length === 0 ? (
                <div className="text-foreground/50 text-center py-8">
                  {t('admin.logsSources.noLines', 'Keine Log-Einträge.')}
                </div>
              ) : filteredLines.map((line, i) => {
                const lower = line.toLowerCase()
                const isErr = lower.includes('error') || lower.includes(' err ') || lower.includes('panic')
                const isWarn = lower.includes('warn')
                return (
                  <div key={i} className={`py-0.5 px-2 rounded whitespace-pre-wrap break-all ${
                    isErr ? 'text-red-400/90 bg-red-500/5' :
                    isWarn ? 'text-amber-400/80' :
                    'text-foreground/70'
                  }`}>
                    {line}
                  </div>
                )
              })}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  )
}

// ── Database Tab ──────────────────────────────────────────────


export function DatabaseTab({ token }: { token: string }) {
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
    } catch (e) { notifyError(e) }
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
                  className="rumahl-field-sm text-xs"
                />
                <input
                  type="password"
                  placeholder="Passwort (min. 8 Zeichen)"
                  value={newUser.password}
                  onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))}
                  className="rumahl-field-sm text-xs"
                />
                <input
                  type="text"
                  placeholder="Beschreibung (optional)"
                  value={newUser.description}
                  onChange={e => setNewUser(u => ({ ...u, description: e.target.value }))}
                  className="rumahl-field-sm text-xs"
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

export interface SystemNotification {
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

export interface SyncEntityStatus {
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


export function SystemNotificationsTab({ token }: { token: string }) {
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
    } catch (e) { notifyError(e) }
  }

  const handleResolve = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}/resolve`, token, { method: 'PUT' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, resolved: true } : n))
    } catch (e) { notifyError(e) }
  }

  const handleDelete = async (id: string) => {
    try {
      await adminFetch(`/api/admin/system-notifications/${id}`, token, { method: 'DELETE' })
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch (e) { notifyError(e) }
  }

  const handleClearResolved = async () => {
    try {
      await adminFetch('/api/admin/system-notifications/clear-resolved', token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
  }

  const handleForceSync = async (entityId: string) => {
    try {
      await adminFetch(`/api/admin/location-sync/${encodeURIComponent(entityId)}/force-sync`, token, { method: 'POST' })
      load()
    } catch (e) { notifyError(e) }
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


export function WarningsTab({ token }: { token: string }) {
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
    if (!(await confirmDialog({ title: 'Warnungsprotokolle löschen', message: 'Alle Warnungsprotokolle unwiderruflich löschen?', confirmLabel: 'Löschen', danger: true }))) return
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
                        : 'bg-foreground/[0.03] text-foreground/50 border-foreground/[0.06] hover:bg-foreground/[0.06] hover:text-foreground/70'
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
                className={ccInput('text-xs px-3 py-2')}
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
              className={`${ccTextarea('text-xs px-3 py-2')} min-h-[60px]`}
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
                  : 'bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10'
              }`}
            >
              {activeOnly ? <ToggleRight size={14} weight="fill" /> : <ToggleLeft size={14} />}
              Nur aktive
            </button>
            <button
              onClick={() => fetchWarnings()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10 transition-colors"
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
                <div className="flex-shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-foreground/5 border border-foreground/10 flex items-center justify-center">
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
                className="rumahl-secondary-button-sm"
              >
                Zurück
              </button>
              <span className="text-xs text-foreground/50">
                Seite {page + 1} von {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rumahl-secondary-button-sm"
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

export interface WebhookEntry {
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

export interface WebhookDelivery {
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


export function WebhooksTab({ token }: { token: string }) {
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
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (id: string) => {
    setActionLoading(`del-${id}`)
    try {
      await adminFetch(`/api/webhooks/${id}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
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
    } catch (e) { notifyError(e) }
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
    } catch (e) { notifyError(e) }
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
            className="rumahl-primary-button-sm"
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
                className="rumahl-field-sm w-full text-sm" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">URL</label>
              <input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
                placeholder="https://example.com/webhook"
                className="rumahl-field-sm w-full text-sm" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Secret (optional, für HMAC-SHA256 Signatur)</label>
              <input type="text" value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })}
                placeholder="Geheimes Token..."
                className="rumahl-field-sm w-full text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-foreground/80 mb-1 block">Event-Filter (kommagetrennt, * = alle)</label>
              <input type="text" value={form.events} onChange={e => setForm({ ...form, events: e.target.value })}
                placeholder="* oder state_changed, domain.light"
                className="rumahl-field-sm w-full text-sm font-mono" />
              <p className="text-[10px] text-foreground/50 mt-1">Filter: *, state_changed, domain.light, light.wohnzimmer, state_changed.light.wohnzimmer</p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)}
                className="rumahl-secondary-button-sm">
                Abbrechen
              </button>
              <button onClick={handleCreate} disabled={!form.name.trim() || !form.url.trim() || actionLoading === 'create'}
                className="rumahl-primary-button-sm">
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

export interface MetricsSnapshot {
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


export function RealtimeTab({ token }: { token: string }) {
  const { t } = useTranslation()
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
    const es = new EventSource(`${backendBase()}/api/admin/metrics/live${token ? `?token=${encodeURIComponent(token)}` : ''}`)
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
    const es = new EventSource(`${backendBase()}/api/events/stream${params}`)
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
    if (backendBase()) {
      try { wsHost = new URL(backendBase()).host } catch { wsHost = window.location.host }
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
                <span className="text-sm font-semibold text-foreground">rumahl Metrics Dashboard</span>
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
                <div className="rumahl-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.http.requests_total.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">HTTP Requests</div>
                  {metrics.http.errors_total > 0 && <div className="text-[9px] text-red-400 mt-0.5">{metrics.http.errors_total} Fehler</div>}
                </div>
                <div className="rumahl-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.entities.state_changes.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">State Changes</div>
                </div>
                <div className="rumahl-card rounded-2xl p-4 theme-transition text-center">
                  <div className="text-2xl font-bold text-foreground">{metrics.services.calls_total.toLocaleString()}</div>
                  <div className="text-[10px] text-foreground/50 mt-0.5">Service Calls</div>
                </div>
                <div className="rumahl-card rounded-2xl p-4 theme-transition text-center">
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
                    className="rumahl-field-sm w-full text-xs font-mono" />
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
                      {ns === 'entities' ? 'Entities' : ns === 'system' ? t('admin.system') : 'Notifications'}
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
                    className="rumahl-field-sm w-full text-xs font-mono" />
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


export function SchedulerTab({ token }: { token: string }) {
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
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const deleteSchedule = async (id: string) => {
    setActionLoading(`del-s-${id}`)
    try {
      await adminFetch(`/api/integration/schedules/${id}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
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
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const deleteWatchdog = async (id: string) => {
    setActionLoading(`del-w-${id}`)
    try {
      await adminFetch(`/api/integration/watchdogs/${id}`, token, { method: 'DELETE' })
      load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const checkWatchdogs = async () => {
    setActionLoading('check-watchdogs')
    try {
      await adminFetch('/api/integration/watchdogs/check', token, { method: 'POST' })
    } catch (e) { notifyError(e) }
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
                className="rumahl-primary-button-sm">
                <Plus size={12} /> Neuer Zeitplan
              </button>
            </div>

            {showCreateSchedule && (
              <div className="space-y-2 p-3 rounded-lg bg-foreground/5 border border-foreground/10 mb-3">
                <input value={newSchedule.name} onChange={e => setNewSchedule(s => ({...s, name: e.target.value}))}
                  placeholder="Name (optional)" className="rumahl-field-sm w-full text-xs" />
                <input value={newSchedule.entity_id} onChange={e => setNewSchedule(s => ({...s, entity_id: e.target.value}))}
                  placeholder="Entity ID (z.B. light.wohnzimmer)" className="rumahl-field-sm w-full text-xs font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={newSchedule.action} onChange={e => setNewSchedule(s => ({...s, action: e.target.value}))}
                    className="rumahl-field-sm text-xs">
                    <option value="turn_on">Einschalten</option>
                    <option value="turn_off">Ausschalten</option>
                    <option value="toggle">Umschalten</option>
                  </select>
                  <input value={newSchedule.cron} onChange={e => setNewSchedule(s => ({...s, cron: e.target.value}))}
                    placeholder="Cron (z.B. 0 8 * * *)" className="rumahl-field-sm text-xs font-mono" />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateSchedule(false)} className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">Abbrechen</button>
                  <button onClick={createSchedule} disabled={!newSchedule.entity_id || !newSchedule.cron || actionLoading === 'create-schedule'}
                    className="rumahl-primary-button-sm">
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
                  className="rumahl-primary-button-sm">
                  <Plus size={12} /> Neuer Watchdog
                </button>
              </div>
            </div>

            {showCreateWatchdog && (
              <div className="space-y-2 p-3 rounded-lg bg-foreground/5 border border-foreground/10 mb-3">
                <input value={newWatchdog.name} onChange={e => setNewWatchdog(w => ({...w, name: e.target.value}))}
                  placeholder="Name (optional)" className="rumahl-field-sm w-full text-xs" />
                <input value={newWatchdog.entity_id} onChange={e => setNewWatchdog(w => ({...w, entity_id: e.target.value}))}
                  placeholder="Entity ID" className="rumahl-field-sm w-full text-xs font-mono" />
                <div className="grid grid-cols-3 gap-2">
                  <input value={newWatchdog.expected_state} onChange={e => setNewWatchdog(w => ({...w, expected_state: e.target.value}))}
                    placeholder="Erwarteter Zustand" className="rumahl-field-sm text-xs" />
                  <input type="number" value={newWatchdog.timeout_minutes} onChange={e => setNewWatchdog(w => ({...w, timeout_minutes: parseInt(e.target.value) || 30}))}
                    placeholder="Timeout (Min)" className="rumahl-field-sm text-xs" />
                  <select value={newWatchdog.action} onChange={e => setNewWatchdog(w => ({...w, action: e.target.value}))}
                    className="rumahl-field-sm text-xs">
                    <option value="notify">Benachrichtigen</option>
                    <option value="restart">Neustarten</option>
                    <option value="turn_on">Einschalten</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCreateWatchdog(false)} className="px-3 py-1.5 text-xs text-foreground/50 hover:text-foreground transition-colors">Abbrechen</button>
                  <button onClick={createWatchdog} disabled={!newWatchdog.entity_id || actionLoading === 'create-watchdog'}
                    className="rumahl-primary-button-sm">
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


export function AnalyticsTab({ token }: { token: string }) {
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
            <div key={key} className="rumahl-card rounded-xl p-3 text-center">
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
          className="rumahl-secondary-button-sm">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Logbook Tab ──────────────────────────────────────────────────


export function GlobalAlertTab({ token }: { token: string }) {
  const [active, setActive] = useState<boolean>(false)
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState('Wartungsarbeiten')
  const [message, setMessage] = useState('Das System wird in Kürze neu gestartet.')
  const [level, setLevel] = useState<'info' | 'warning' | 'critical'>('warning')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/admin/alert', token)
      setActive(r?.active === true)
      setCurrent((r?.alert ?? null) as Record<string, unknown> | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const send = async () => {
    setBusy(true); setError(null)
    try {
      await adminFetch('/api/admin/alert', token, {
        method: 'PUT',
        body: JSON.stringify({ title, message, level }),
      })
      toast.success('Globaler Alarm gesetzt')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    setBusy(true); setError(null)
    try {
      await adminFetch('/api/admin/alert', token, { method: 'DELETE' })
      toast.success('Alarm zurückgenommen')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const levelColor = level === 'critical' ? 'bg-red-500/20 border-red-500/40 text-red-200'
    : level === 'warning' ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
    : 'bg-blue-500/20 border-blue-500/40 text-blue-200'

  return (
    <div className="space-y-3">
      <AdminCard title="Aktiver Alarm" icon={Megaphone}>
        {loading ? (
          <p className="text-xs text-foreground/50">Lade Status…</p>
        ) : active && current ? (
          <div className="space-y-3">
            <div className={`p-3 rounded-xl border ${levelColor}`}>
              <div className="text-sm font-semibold">{String(current.title ?? '')}</div>
              <div className="text-xs mt-1 opacity-90">{String(current.message ?? '')}</div>
              <div className="text-[10px] opacity-60 mt-2">
                Level: <span className="font-mono">{String(current.level ?? '')}</span>
                {current.created_at != null && current.created_at !== '' && <> · {String(current.created_at)}</>}
              </div>
            </div>
            <button onClick={dismiss} disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-40">
              Alarm zurücknehmen
            </button>
          </div>
        ) : (
          <p className="text-xs text-foreground/60">Kein aktiver Alarm.</p>
        )}
      </AdminCard>

      <AdminCard title="Neuen Alarm setzen" icon={Siren}>
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel"
            className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Nachricht"
            className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
          <div className="flex items-center gap-1">
            {(['info', 'warning', 'critical'] as const).map((l) => (
              <button key={l} onClick={() => setLevel(l)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  level === l ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                }`}>{l}</button>
            ))}
            <button onClick={send} disabled={busy || !title.trim() || !message.trim()}
              className="rumahl-ghost-button-sm ml-auto">
              {busy ? 'Sende…' : 'Senden'}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-300">{error}</p>}
          <p className="text-[11px] text-foreground/40">
            Der Alarm wird sofort an alle verbundenen Clients per WebSocket
            zugestellt und persistiert als Benachrichtigung in der DB.
          </p>
        </div>
      </AdminCard>
    </div>
  )
}

// ─── Notifications tab ──────────────────────────────────────────────────
//
// Generic notification feed produced by the backend. Distinct from
// system-notifications (those are sync/data-quality alerts); this view
// shows everything that lands in the notifications table — alerts,
// admin-set banners, plugin output, etc.
export interface NotificationRow {
  id: string
  title: string
  message: string
  level: string
  source?: string
  icon?: string
  entity_id?: string
  created_at: string
  read: boolean
  auto_dismiss_secs?: number
}


export function NotificationsTab({ token }: { token: string }) {
  const [items, setItems] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/admin/notifications', token)
      setItems(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const markRead = async (id: string) => {
    try {
      await adminFetch(`/api/admin/notifications/${encodeURIComponent(id)}/read`, token, { method: 'PUT' })
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const dismiss = async (id: string) => {
    try {
      await adminFetch(`/api/admin/notifications/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
      setItems((prev) => prev.filter((n) => n.id !== id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const clearAll = async () => {
    if (!(await confirmDialog({ title: 'Benachrichtigungen löschen', message: 'Wirklich alle Benachrichtigungen löschen?', confirmLabel: 'Löschen', danger: true }))) return
    try {
      await adminFetch('/api/admin/notifications', token, { method: 'DELETE' })
      setItems([])
      toast.success('Alle Benachrichtigungen gelöscht')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const filtered = items.filter((n) => {
    if (filter === 'unread') return !n.read
    if (filter === 'critical') return n.level === 'critical' || n.level === 'error'
    return true
  })

  const levelStyle = (lvl: string) => {
    if (lvl === 'critical' || lvl === 'error') return 'border-red-500/40 bg-red-500/10'
    if (lvl === 'warning') return 'border-amber-500/40 bg-amber-500/10'
    if (lvl === 'success') return 'border-green-500/40 bg-green-500/10'
    return 'border-foreground/10 bg-foreground/5'
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Benachrichtigungen" icon={Bell}>
        <div className="flex items-center gap-1 mb-3">
          {(['all', 'unread', 'critical'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                filter === f ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {f === 'all' ? 'Alle' : f === 'unread' ? 'Ungelesen' : 'Kritisch'}
            </button>
          ))}
          <button onClick={load} disabled={loading}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
          <button onClick={clearAll} disabled={loading || items.length === 0}
            className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40">
            <Trash size={13} />
          </button>
        </div>

        {loading && <p className="text-xs text-foreground/50">Lade Benachrichtigungen…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-xs text-foreground/50">Keine Benachrichtigungen.</p>
        )}

        <div className="space-y-2">
          {filtered.map((n) => (
            <div key={n.id} className={`rounded-xl border p-3 ${levelStyle(n.level)} ${n.read ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground truncate">{n.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono uppercase">
                      {n.level}
                    </span>
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </div>
                  <p className="text-xs text-foreground/70 break-words">{n.message}</p>
                  <div className="text-[10px] text-foreground/40 mt-1.5 flex items-center gap-2 flex-wrap">
                    <span>{new Date(n.created_at).toLocaleString('de-DE')}</span>
                    {n.source && <span>· {n.source}</span>}
                    {n.entity_id && <span className="font-mono">· {n.entity_id}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!n.read && (
                    <button onClick={() => markRead(n.id)} title="Als gelesen markieren"
                      className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10">
                      <Eye size={13} />
                    </button>
                  )}
                  <button onClick={() => dismiss(n.id)} title="Löschen"
                    className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25">
                    <X size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// rumahl AI MANAGEMENT TABS
// ════════════════════════════════════════════════════════════════════════
//
// The AI subsystem (rumahl-assist) exposes a rich `/api/assist/*` API that
// previously had no admin UI. These six tabs cover the full surface:
//
//   - AiOverviewTab       /api/assist/health, /api/assist/config/stats
//   - AiProvidersTab      /api/assist/providers, /api/assist/config/providers
//   - AiConversationsTab  /api/assist/history, /api/assist/config/threads,
//                         /api/assist/config/notifications
//   - AiTasksTab          /api/assist/config/tasks
//   - AiToolsTab          /api/assist/tools/{search,scrape,screenshot}
//   - AiVoiceTab          /api/assist/voice/{transcribe,synthesize}
//
// All requests go through the same `adminFetch` helper because the nginx
// front-door proxies `/api/assist/*` to rumahl-assist transparently.

// ─── AI Overview ────────────────────────────────────────────────────────

export function severityBadge(sev: Severity): string {
  switch (sev) {
    case 'error': return 'bg-red-500/15 text-red-500 border-red-500/30'
    case 'warning': return 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    case 'info': return 'bg-blue-500/15 text-blue-500 border-blue-500/30'
  }
}


export function originBadge(origin: Origin): string {
  switch (origin) {
    case 'backend': return 'bg-violet-500/15 text-violet-400 border-violet-500/30'
    case 'tracing': return 'bg-sky-500/15 text-sky-400 border-sky-500/30'
    case 'frontend': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  }
}


export function SystemLogsTab({ token }: { token: string }) {
  const [view, setView] = useState<'grouped' | 'history'>('grouped')
  const [severity, setSeverity] = useState<'all' | Severity>('all')
  const [originFilter, setOriginFilter] = useState<'all' | Origin>('all')
  const [onlyUnresolved, setOnlyUnresolved] = useState(false)
  const [groups, setGroups] = useState<EventGroup[]>([])
  const [occurrences, setOccurrences] = useState<EventOccurrence[]>([])
  const [stats, setStats] = useState<EventStats | null>(null)
  const [selectedFingerprint, setSelectedFingerprint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  const sevQuery = severity === 'all' ? '' : `&severity=${severity}`
  const originQuery = originFilter === 'all' ? '' : `&origin=${originFilter}`
  const unresolvedQuery = onlyUnresolved ? '&unresolved=true' : ''

  const loadGrouped = useCallback(async () => {
    try {
      const r = await fetch(
        `${getBackendUrl()}/api/admin/system-events?limit=200${sevQuery}${unresolvedQuery}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setGroups(data.groups || [])
      setStats(data.stats || null)
      setGeneratedAt(data.generated_at || null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token, sevQuery, unresolvedQuery])

  const loadHistory = useCallback(async () => {
    try {
      const fpQ = selectedFingerprint ? `&fingerprint=${encodeURIComponent(selectedFingerprint)}` : ''
      const r = await fetch(
        `${getBackendUrl()}/api/admin/system-events/occurrences?limit=300${sevQuery}${originQuery}${fpQ}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setOccurrences(data.occurrences || [])
      setGeneratedAt(data.generated_at || null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token, sevQuery, originQuery, selectedFingerprint])

  useEffect(() => {
    setLoading(true)
    if (view === 'grouped') {
      loadGrouped()
      const id = setInterval(loadGrouped, 10_000)
      return () => clearInterval(id)
    } else {
      loadHistory()
      const id = setInterval(loadHistory, 10_000)
      return () => clearInterval(id)
    }
  }, [view, loadGrouped, loadHistory])

  const resolveGroup = async (fp: string) => {
    try {
      await fetch(`${getBackendUrl()}/api/admin/system-events/${encodeURIComponent(fp)}/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      loadGrouped()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const unresolveGroup = async (fp: string) => {
    try {
      await fetch(`${getBackendUrl()}/api/admin/system-events/${encodeURIComponent(fp)}/unresolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      loadGrouped()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const deleteGroup = async (fp: string) => {
    if (!(await confirmDialog({ title: 'Fehlergruppe löschen', message: 'Diese Fehlergruppe inklusive aller Vorkommen löschen?', confirmLabel: 'Löschen', danger: true }))) return
    try {
      await fetch(`${getBackendUrl()}/api/admin/system-events/${encodeURIComponent(fp)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      loadGrouped()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const clearAll = async () => {
    if (!(await confirmDialog({ title: 'System-Events löschen', message: 'Wirklich ALLE gespeicherten System-Events löschen? Dies kann nicht rückgängig gemacht werden.', confirmLabel: 'Löschen', danger: true }))) return
    try {
      await fetch(`${getBackendUrl()}/api/admin/system-events`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setGroups([])
      setOccurrences([])
      loadGrouped()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-4">
      {/* Stats KPI cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-red-500/80">Fehler offen</div>
            <div className="text-2xl font-semibold text-red-500">{stats.unresolved_errors}</div>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-amber-500/80">Warnungen offen</div>
            <div className="text-2xl font-semibold text-amber-500">{stats.unresolved_warnings}</div>
          </div>
          <div className="rounded-lg border border-foreground/15 bg-foreground/[0.02] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-foreground/60">Letzte Stunde</div>
            <div className="text-2xl font-semibold text-foreground">{stats.occurrences_last_hour}</div>
          </div>
          <div className="rounded-lg border border-foreground/15 bg-foreground/[0.02] px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-foreground/60">Letzte 24h</div>
            <div className="text-2xl font-semibold text-foreground">{stats.occurrences_last_day}</div>
          </div>
        </div>
      )}

      <AdminCard
        title="rumahl Control Center · System-Events"
        description="Alle Fehler, Warnungen und Infos aus dem gesamten Stack — Backend-Tracing, Hintergrund-Tasks, Frontend, SDK-Clients. Gleiche Fehler werden gruppiert mit Zähler; im Verlauf bleibt jedes Vorkommen einzeln erhalten."
      >
        {/* View tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex rounded-md border border-foreground/15 overflow-hidden">
            <button
              onClick={() => { setView('grouped'); setSelectedFingerprint(null) }}
              className={`px-3 py-1.5 text-xs transition ${
                view === 'grouped' ? 'bg-foreground/10 text-foreground' : 'text-foreground/60 hover:bg-foreground/5'
              }`}
            >
              Gruppiert
            </button>
            <button
              onClick={() => setView('history')}
              className={`px-3 py-1.5 text-xs transition border-l border-foreground/15 ${
                view === 'history' ? 'bg-foreground/10 text-foreground' : 'text-foreground/60 hover:bg-foreground/5'
              }`}
            >
              Verlauf {selectedFingerprint ? '(gefiltert)' : ''}
            </button>
          </div>

          {/* Severity filter */}
          <div className="flex flex-wrap items-center gap-1 ml-2">
            {(['all', 'error', 'warning', 'info'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className={`px-2 py-1 text-[11px] rounded-md border transition ${
                  severity === s
                    ? 'bg-foreground/10 border-foreground/30 text-foreground'
                    : 'border-foreground/15 text-foreground/60 hover:border-foreground/30'
                }`}
              >
                {s === 'all' ? 'Alle' : s === 'error' ? 'Fehler' : s === 'warning' ? 'Warn.' : 'Info'}
              </button>
            ))}
          </div>

          {view === 'grouped' && (
            <label className="flex items-center gap-1.5 ml-2 text-[11px] text-foreground/70">
              <input
                type="checkbox"
                checked={onlyUnresolved}
                onChange={(e) => setOnlyUnresolved(e.target.checked)}
                className="accent-foreground/60"
              />
              Nur ungelöste
            </label>
          )}

          {view === 'history' && (
            <select
              value={originFilter}
              onChange={(e) => setOriginFilter(e.target.value as 'all' | Origin)}
              className="ml-2 px-2 py-1 text-[11px] rounded-md border border-foreground/15 bg-transparent text-foreground/70"
            >
              <option value="all">Alle Quellen</option>
              <option value="backend">Backend</option>
              <option value="tracing">Tracing</option>
              <option value="frontend">Frontend</option>
            </select>
          )}

          {view === 'history' && selectedFingerprint && (
            <button
              onClick={() => setSelectedFingerprint(null)}
              className="px-2 py-1 text-[11px] rounded-md border border-foreground/15 text-foreground/60 hover:border-foreground/30"
            >
              Filter aufheben
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => (view === 'grouped' ? loadGrouped() : loadHistory())}
              className="px-3 py-1 text-xs rounded-md border border-foreground/15 text-foreground/70 hover:border-foreground/30"
            >
              Aktualisieren
            </button>
            <button
              onClick={clearAll}
              className="px-3 py-1 text-xs rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10"
            >
              Alles löschen
            </button>
          </div>
        </div>

        {loading && groups.length === 0 && occurrences.length === 0 ? (
          <div className="text-sm text-foreground/50 py-8 text-center">Lade Events…</div>
        ) : error ? (
          <div className="text-sm text-red-500 py-8 text-center">Fehler: {error}</div>
        ) : view === 'grouped' ? (
          groups.length === 0 ? (
            <div className="text-sm text-foreground/50 py-8 text-center">
              Keine Events {onlyUnresolved ? 'ungelöst' : 'vorhanden'} — alles ruhig.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-foreground/50 text-left">
                  <tr className="border-b border-foreground/10">
                    <th className="py-2 px-2 font-medium">Schwere</th>
                    <th className="py-2 px-2 font-medium">Quelle</th>
                    <th className="py-2 px-2 font-medium">Meldung</th>
                    <th className="py-2 px-2 font-medium text-right">Anzahl</th>
                    <th className="py-2 px-2 font-medium">Zuerst</th>
                    <th className="py-2 px-2 font-medium">Zuletzt</th>
                    <th className="py-2 px-2 font-medium">Status</th>
                    <th className="py-2 px-2 font-medium text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(g => (
                    <tr key={g.fingerprint} className={`border-b border-foreground/5 hover:bg-foreground/[0.02] ${g.resolved ? 'opacity-50' : ''}`}>
                      <td className="py-2 px-2">
                        <span className={`inline-block px-2 py-0.5 rounded border text-[10px] uppercase tracking-wider ${severityBadge(g.severity)}`}>
                          {g.severity}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-mono text-foreground/70 whitespace-nowrap max-w-[180px] truncate" title={g.source}>{g.source}</td>
                      <td className="py-2 px-2 text-foreground/90 max-w-[480px] truncate" title={g.message}>{g.message}</td>
                      <td className="py-2 px-2 text-foreground/80 text-right font-mono">{g.count}</td>
                      <td className="py-2 px-2 text-foreground/50 whitespace-nowrap">{new Date(g.first_seen).toLocaleString()}</td>
                      <td className="py-2 px-2 text-foreground/50 whitespace-nowrap">{new Date(g.last_seen).toLocaleString()}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        {g.resolved ? (
                          <span className="text-emerald-500 text-[10px]">✓ gelöst{g.resolved_by ? ` (${g.resolved_by})` : ''}</span>
                        ) : (
                          <span className="text-foreground/40 text-[10px]">offen</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => { setSelectedFingerprint(g.fingerprint); setView('history') }}
                          className="px-2 py-0.5 text-[10px] rounded border border-foreground/15 text-foreground/70 hover:border-foreground/30 mr-1"
                        >
                          Verlauf
                        </button>
                        {g.resolved ? (
                          <button
                            onClick={() => unresolveGroup(g.fingerprint)}
                            className="px-2 py-0.5 text-[10px] rounded border border-foreground/15 text-foreground/70 hover:border-foreground/30 mr-1"
                          >
                            Wieder öffnen
                          </button>
                        ) : (
                          <button
                            onClick={() => resolveGroup(g.fingerprint)}
                            className="px-2 py-0.5 text-[10px] rounded border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 mr-1"
                          >
                            Auflösen
                          </button>
                        )}
                        <button
                          onClick={() => deleteGroup(g.fingerprint)}
                          className="px-2 py-0.5 text-[10px] rounded border border-red-500/30 text-red-500 hover:bg-red-500/10"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          occurrences.length === 0 ? (
            <div className="text-sm text-foreground/50 py-8 text-center">Keine Vorkommen.</div>
          ) : (
            <div className="space-y-2">
              {occurrences.map(o => <OccurrenceRow key={o.id} occ={o} />)}
            </div>
          )
        )}
      </AdminCard>

      {generatedAt && (
        <p className="text-[10px] text-foreground/40 text-center">
          Auto-Refresh alle 10s · Daten generiert {new Date(generatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}


export function OccurrenceRow({ occ }: { occ: EventOccurrence }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-md border border-foreground/10 bg-foreground/[0.015]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-foreground/[0.03]"
      >
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${severityBadge(occ.severity)}`}>
          {occ.severity}
        </span>
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${originBadge(occ.origin)}`}>
          {occ.origin}
        </span>
        <span className="font-mono text-foreground/60 truncate max-w-[180px]" title={occ.source}>{occ.source}</span>
        <span className="text-foreground/90 truncate flex-1" title={occ.message}>{occ.message}</span>
        <span className="text-foreground/40 whitespace-nowrap text-[10px]">{new Date(occ.occurred_at).toLocaleString()}</span>
        <span className="text-foreground/40 text-[10px]">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 text-[11px] text-foreground/70 space-y-1 border-t border-foreground/10">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-foreground/40">Fingerprint:</span> <code className="text-foreground/80">{occ.fingerprint}</code></div>
            {occ.user_id && <div><span className="text-foreground/40">User:</span> {occ.user_id}</div>}
            {occ.request_path && <div><span className="text-foreground/40">Pfad:</span> <code>{occ.request_method ?? ''} {occ.request_path}</code></div>}
            {occ.status_code != null && <div><span className="text-foreground/40">Status:</span> {occ.status_code}</div>}
            {occ.file && <div><span className="text-foreground/40">Datei:</span> <code>{occ.file}{occ.line ? `:${occ.line}` : ''}</code></div>}
            {occ.target && <div><span className="text-foreground/40">Target:</span> <code>{occ.target}</code></div>}
          </div>
          {occ.error_chain && (
            <div>
              <div className="text-foreground/40 mt-1">Error-Chain / Stack:</div>
              <pre className="mt-1 text-[10px] bg-foreground/[0.04] border border-foreground/10 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{occ.error_chain}</pre>
            </div>
          )}
          {occ.details != null && (
            <div>
              <div className="text-foreground/40 mt-1">Details:</div>
              <pre className="mt-1 text-[10px] bg-foreground/[0.04] border border-foreground/10 rounded p-2 overflow-x-auto">{JSON.stringify(occ.details, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
