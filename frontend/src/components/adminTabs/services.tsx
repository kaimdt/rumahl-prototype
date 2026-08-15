import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, ChartLine, Clock, Code, Copy, Cube, Dog, Envelope, Eye, FileArrowDown, FolderOpen, HardDrive, LockKey, Plus, ShareNetwork, ShieldCheck, Stack, Trash, Vault, WifiHigh, X } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ui/confirmDialog'
import { AdminCard, adminFetch, backendBase } from '../AdminPanel'
import { ServiceJsonBlock } from '../AdminPanel'
export interface SecretRow {
  id: string
  name: string
  description?: string | null
  category?: string | null
  created_at?: string
  updated_at?: string
  rotation_due?: string | null
}

export function SecretsTab({ token }: { token: string }) {
  const [list, setList] = useState<SecretRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [audit, setAudit] = useState<unknown>(null)
  const [auditFor, setAuditFor] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [category, setCategory] = useState('api-key')
  const [description, setDescription] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/secrets', token)
      const arr = (r as Record<string, unknown>)?.secrets ?? r
      setList(Array.isArray(arr) ? (arr as SecretRow[]) : [])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!name.trim() || !value) return
    try {
      await adminFetch('/api/secrets', token, {
        method: 'POST',
        body: JSON.stringify({ name, value, category, description: description || null }),
      })
      toast.success('Secret gespeichert')
      setName(''); setValue(''); setDescription('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const rotate = async (id: string) => {
    const v = prompt('Neuer Wert für das Secret?')
    if (!v) return
    try {
      await adminFetch(`/api/secrets/${id}/rotate`, token, {
        method: 'POST',
        body: JSON.stringify({ value: v }),
      })
      toast.success('Secret rotiert')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const remove = async (id: string) => {
    if (!(await confirmDialog({ title: 'Secret löschen', message: 'Secret wirklich löschen?', confirmLabel: 'Löschen', danger: true }))) return
    try {
      await adminFetch(`/api/secrets/${id}`, token, { method: 'DELETE' })
      toast.success('Secret gelöscht'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const showAudit = async (id: string) => {
    try {
      const r = await adminFetch(`/api/secrets/${id}/audit`, token)
      setAudit(r); setAuditFor(id)
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Neues Secret anlegen" icon={Plus}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (z. B. OPENAI_API_KEY)"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground">
            <option value="api-key">api-key</option>
            <option value="password">password</option>
            <option value="token">token</option>
            <option value="certificate">certificate</option>
            <option value="other">other</option>
          </select>
          <input value={value} onChange={(e) => setValue(e.target.value)} type="password" placeholder="Wert"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Beschreibung (optional)"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
        </div>
        <div className="mt-2">
          <button onClick={create} disabled={!name.trim() || !value}
            className="ora-ghost-button-sm">
            Speichern
          </button>
        </div>
      </AdminCard>

      <AdminCard title={`Secrets (${list.length})`} icon={Vault}>
        <div className="flex justify-end mb-2">
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {!loading && list.length === 0 && <p className="text-xs text-foreground/50">Keine Secrets gespeichert.</p>}
        <div className="space-y-2">
          {list.map((s) => (
            <div key={s.id} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <LockKey size={14} className="text-foreground/50" />
                <span className="text-sm font-semibold text-foreground">{s.name}</span>
                {s.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{s.category}</span>}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => showAudit(s.id)} title="Audit-Log" className="p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10"><Eye size={13} /></button>
                  <button onClick={() => rotate(s.id)} title="Rotieren" className="p-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25"><ArrowClockwise size={13} /></button>
                  <button onClick={() => remove(s.id)} title="Löschen" className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={13} /></button>
                </div>
              </div>
              {s.description && <div className="text-[11px] text-foreground/60 mt-1">{s.description}</div>}
              <div className="text-[10px] text-foreground/40 mt-1 flex gap-3 flex-wrap">
                <span className="font-mono">{s.id.slice(0, 12)}</span>
                {s.updated_at && <span>aktualisiert: {new Date(s.updated_at).toLocaleString('de-DE')}</span>}
                {s.rotation_due && <span className="text-amber-300">Rotation fällig: {new Date(s.rotation_due).toLocaleDateString('de-DE')}</span>}
              </div>
            </div>
          ))}
        </div>
        {auditFor && audit !== null && (
          <div className="mt-3 rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
            <div className="flex items-center mb-2">
              <span className="text-xs font-semibold text-foreground">Audit-Log <span className="font-mono text-foreground/50">{auditFor.slice(0, 12)}</span></span>
              <button onClick={() => { setAudit(null); setAuditFor(null) }} className="ml-auto p-1 rounded bg-foreground/5 text-foreground/50 hover:bg-foreground/10"><X size={12} /></button>
            </div>
            <ServiceJsonBlock data={audit} />
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Files (iora-files) ─────────────────────────────────────────────────
export interface FileRow {
  id: string
  name: string
  size?: number
  mime_type?: string | null
  is_folder?: boolean
  parent_id?: string | null
  created_at?: string
  updated_at?: string
  is_deleted?: boolean
}
export interface ShareRow { id: string; file_id: string; token: string; expires_at?: string | null; created_at?: string }
export interface QuotaInfo { used?: number; limit?: number; file_count?: number }


export function FilesTab({ token }: { token: string }) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [shares, setShares] = useState<ShareRow[]>([])
  const [quota, setQuota] = useState<QuotaInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'files' | 'shares' | 'quota'>('files')
  const [folderName, setFolderName] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [f, s, q] = await Promise.all([
        adminFetch('/api/files/', token).catch(() => null),
        adminFetch('/api/files/shares', token).catch(() => null),
        adminFetch('/api/files/quota', token).catch(() => null),
      ])
      const fa = (f as Record<string, unknown> | null)?.files ?? f
      const sa = (s as Record<string, unknown> | null)?.shares ?? s
      setFiles(Array.isArray(fa) ? (fa as FileRow[]) : [])
      setShares(Array.isArray(sa) ? (sa as ShareRow[]) : [])
      setQuota(q as QuotaInfo | null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const fmtSize = (n?: number) => {
    if (!n) return '0 B'
    const u = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0; let v = n
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
  }

  const createFolder = async () => {
    if (!folderName.trim()) return
    try {
      await adminFetch('/api/files/folders', token, { method: 'POST', body: JSON.stringify({ name: folderName }) })
      toast.success('Ordner erstellt'); setFolderName(''); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const removeFile = async (id: string) => {
    if (!(await confirmDialog({ title: 'Datei verschieben', message: 'Datei in den Papierkorb verschieben?', confirmLabel: 'Verschieben', danger: true }))) return
    try {
      await adminFetch(`/api/files/${id}`, token, { method: 'DELETE' })
      toast.success('Verschoben'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  const revokeShare = async (id: string) => {
    if (!(await confirmDialog({ title: 'Freigabe widerrufen', message: 'Freigabe widerrufen?', confirmLabel: 'Widerrufen', danger: true }))) return
    try {
      await adminFetch(`/api/files/shares/${id}`, token, { method: 'DELETE' })
      toast.success('Freigabe widerrufen'); await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Datei-Verwaltung" icon={FolderOpen}>
        <div className="flex items-center gap-1 mb-3">
          {(['files', 'shares', 'quota'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
              {v === 'files' ? `Dateien (${files.length})` : v === 'shares' ? `Freigaben (${shares.length})` : 'Quota'}
            </button>
          ))}
          <button onClick={load} disabled={loading} className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40"><ArrowClockwise size={13} /></button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}

        {!loading && view === 'files' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Neuer Ordner-Name…"
                className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
              <button onClick={createFolder} disabled={!folderName.trim()}
                className="ora-ghost-button-sm">Ordner anlegen</button>
            </div>
            {files.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine Dateien.</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-auto">
                {files.map((f) => (
                  <div key={f.id} className="rounded-lg bg-foreground/5 border border-foreground/10 p-2.5 flex items-center gap-2">
                    {f.is_folder ? <FolderOpen size={14} className="text-amber-300" /> : <FileArrowDown size={14} className="text-foreground/50" />}
                    <span className="text-xs font-medium text-foreground truncate">{f.name}</span>
                    {f.mime_type && <span className="text-[10px] font-mono text-foreground/40">{f.mime_type}</span>}
                    <span className="ml-auto text-[10px] text-foreground/50">{fmtSize(f.size)}</span>
                    <button onClick={() => removeFile(f.id)} className="p-1 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && view === 'shares' && (
          <div className="space-y-2 max-h-96 overflow-auto">
            {shares.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine aktiven Freigabe-Links.</p>
            ) : shares.map((s) => (
              <div key={s.id} className="rounded-lg bg-foreground/5 border border-foreground/10 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-foreground/70 truncate">{s.token}</span>
                  <button onClick={() => revokeShare(s.id)} className="ml-auto p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                </div>
                <div className="text-[10px] text-foreground/40 mt-1">
                  Datei: <span className="font-mono">{s.file_id.slice(0, 8)}</span>
                  {s.expires_at && <span className="ml-2">läuft ab: {new Date(s.expires_at).toLocaleString('de-DE')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && view === 'quota' && quota && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase text-foreground/40">Benutzt</div>
                <div className="text-base font-semibold text-foreground mt-1">{fmtSize(quota.used)}</div>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase text-foreground/40">Limit</div>
                <div className="text-base font-semibold text-foreground mt-1">{quota.limit ? fmtSize(quota.limit) : '–'}</div>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase text-foreground/40">Dateien</div>
                <div className="text-base font-semibold text-foreground mt-1">{quota.file_count ?? 0}</div>
              </div>
            </div>
            {quota.limit && quota.used !== undefined && (
              <div className="h-2 bg-foreground/10 rounded-full overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (quota.used / quota.limit) * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Gateway (iora-gateway) ─────────────────────────────────────────────

export function GatewayTab({ token }: { token: string }) {
  const [view, setView] = useState<'email' | 'search' | 'http' | 'log' | 'ai-log'>('email')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  const [searchQ, setSearchQ] = useState('')
  const [httpUrl, setHttpUrl] = useState('https://')

  const [requestLog, setRequestLog] = useState<unknown>(null)
  const [aiLog, setAiLog] = useState<unknown>(null)

  const sendEmail = async () => {
    if (!emailTo.trim() || !emailSubject.trim()) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await adminFetch('/api/gateway/email', token, { method: 'POST', body: JSON.stringify({ to: emailTo, subject: emailSubject, body: emailBody }) })
      setResult(r); toast.success('E-Mail versendet')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const search = async () => {
    if (!searchQ.trim()) return
    setBusy(true); setError(null); setResult(null)
    try { setResult(await adminFetch('/api/gateway/search', token, { method: 'POST', body: JSON.stringify({ query: searchQ }) })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const httpGet = async () => {
    if (!httpUrl.trim()) return
    setBusy(true); setError(null); setResult(null)
    try { setResult(await adminFetch('/api/gateway/http/get', token, { method: 'POST', body: JSON.stringify({ url: httpUrl }) })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const loadLog = useCallback(async () => {
    try { setRequestLog(await adminFetch('/api/gateway/requests', token)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [token])
  const loadAiLog = useCallback(async () => {
    try { setAiLog(await adminFetch('/api/gateway/ai-requests', token)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [token])
  useEffect(() => { if (view === 'log') loadLog(); if (view === 'ai-log') loadAiLog() }, [view, loadLog, loadAiLog])

  return (
    <div className="space-y-3">
      <AdminCard title="External Gateway" icon={Envelope}>
        <p className="text-xs text-foreground/60 mb-3">
          Egress-Service für E-Mail, Web-Suche und externe HTTP-Aufrufe — alle ausgehenden Anfragen werden geloggt und können dem AI-Assistenten als Tool zur Verfügung gestellt werden.
        </p>
        <div className="flex flex-wrap items-center gap-1 mb-3">
          {(['email', 'search', 'http', 'log', 'ai-log'] as const).map((v) => (
            <button key={v} onClick={() => { setView(v); setResult(null); setError(null) }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
              {v === 'email' ? 'E-Mail' : v === 'search' ? 'Web-Suche' : v === 'http' ? 'HTTP GET' : v === 'log' ? 'Request-Log' : 'AI-Anfragen'}
            </button>
          ))}
        </div>

        {view === 'email' && (
          <div className="space-y-2">
            <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="empfänger@example.com"
              className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="Betreff"
              className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={4} placeholder="Inhalt…"
              className="w-full text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground" />
            <button onClick={sendEmail} disabled={busy || !emailTo.trim() || !emailSubject.trim()}
              className="ora-ghost-button-sm">{busy ? '…' : 'Senden'}</button>
          </div>
        )}
        {view === 'search' && (
          <div className="flex items-center gap-2">
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Suchbegriff…"
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={search} disabled={busy || !searchQ.trim()}
              className="ora-ghost-button-sm">{busy ? '…' : 'Suchen'}</button>
          </div>
        )}
        {view === 'http' && (
          <div className="flex items-center gap-2">
            <input value={httpUrl} onChange={(e) => setHttpUrl(e.target.value)}
              className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
            <button onClick={httpGet} disabled={busy || !httpUrl.trim()}
              className="ora-ghost-button-sm">{busy ? '…' : 'GET'}</button>
          </div>
        )}
        {view === 'log' && requestLog !== null && <ServiceJsonBlock data={requestLog} max="max-h-96" />}
        {view === 'ai-log' && aiLog !== null && <ServiceJsonBlock data={aiLog} max="max-h-96" />}

        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        {result !== null && view !== 'log' && view !== 'ai-log' && <div className="mt-3"><ServiceJsonBlock data={result} /></div>}
      </AdminCard>
    </div>
  )
}

// ─── Watchdog (iora-watchdog) ───────────────────────────────────────────
export interface WatchdogService { name?: string; status?: string; last_heartbeat?: string; failure_count?: number }

export function WatchdogTab({ token }: { token: string }) {
  const [status, setStatus] = useState<unknown>(null)
  const [services, setServices] = useState<WatchdogService[]>([])
  const [metrics, setMetrics] = useState<unknown>(null)
  const [recovery, setRecovery] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [st, sv, m, r] = await Promise.all([
        adminFetch('/api/watchdog/status', token).catch(() => null),
        adminFetch('/api/watchdog/services', token).catch(() => null),
        adminFetch('/api/watchdog/metrics', token).catch(() => null),
        adminFetch('/api/watchdog/recovery', token).catch(() => null),
      ])
      setStatus(st)
      const arr = (sv as Record<string, unknown> | null)?.services ?? sv
      setServices(Array.isArray(arr) ? (arr as WatchdogService[]) : [])
      setMetrics(m); setRecovery(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load(); const i = setInterval(load, 20000); return () => clearInterval(i) }, [load])

  const statusColor = (s?: string) => {
    const v = (s ?? '').toLowerCase()
    if (v.includes('healthy') || v === 'ok' || v === 'up') return 'bg-green-500/15 text-green-300'
    if (v.includes('degraded') || v.includes('warn')) return 'bg-amber-500/15 text-amber-300'
    if (v.includes('down') || v.includes('fail') || v.includes('crash')) return 'bg-red-500/15 text-red-300'
    return 'bg-foreground/10 text-foreground/50'
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Watchdog Status" icon={Dog}>
        {loading ? <p className="text-xs text-foreground/50">Lade…</p> : error ? <p className="text-xs text-red-300">{error}</p> : (
          <div className="space-y-3">
            {status !== null && <ServiceJsonBlock data={status} max="max-h-40" />}
            <div>
              <div className="text-xs font-semibold text-foreground mb-2">Überwachte Dienste ({services.length})</div>
              {services.length === 0 ? <p className="text-xs text-foreground/50">Keine registrierten Dienste.</p> : (
                <div className="space-y-1.5 max-h-72 overflow-auto">
                  {services.map((s, i) => (
                    <div key={s.name ?? i} className="rounded-lg bg-foreground/5 border border-foreground/10 p-2.5 flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground truncate">{s.name ?? '–'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${statusColor(s.status)}`}>{s.status ?? '?'}</span>
                      {s.failure_count !== undefined && s.failure_count > 0 && <span className="text-[10px] text-red-300">{s.failure_count} Fehler</span>}
                      <span className="ml-auto text-[10px] text-foreground/40">{s.last_heartbeat && new Date(s.last_heartbeat).toLocaleTimeString('de-DE')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <details className="rounded-xl bg-foreground/[0.03] border border-foreground/10">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Metriken</summary>
              <div className="p-3 pt-0">{metrics !== null && <ServiceJsonBlock data={metrics} />}</div>
            </details>
            <details className="rounded-xl bg-foreground/[0.03] border border-foreground/10">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground">Recovery-Verlauf</summary>
              <div className="p-3 pt-0">{recovery !== null && <ServiceJsonBlock data={recovery} />}</div>
            </details>
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Connector (iora-connector) ─────────────────────────────────────────
export interface TunnelRow { id?: string; name?: string; status?: string; endpoint?: string; created_at?: string; last_seen?: string }
export interface ExposedSvc { id?: string; name?: string; tunnel_id?: string; local_port?: number; public_url?: string }
export interface PairingTok { id?: string; token?: string; expires_at?: string; created_at?: string }


export function ConnectorTab({ token }: { token: string }) {
  const [view, setView] = useState<'tunnels' | 'services' | 'tokens' | 'blocked'>('tunnels')
  const [tunnels, setTunnels] = useState<TunnelRow[]>([])
  const [services, setServices] = useState<ExposedSvc[]>([])
  const [tokens, setTokens] = useState<PairingTok[]>([])
  const [blocked, setBlocked] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [t, s, k, b] = await Promise.all([
        adminFetch('/api/connector/tunnels', token).catch(() => null),
        adminFetch('/api/connector/services', token).catch(() => null),
        adminFetch('/api/connector/pairing-tokens', token).catch(() => null),
        adminFetch('/api/connector/blocked-ips', token).catch(() => null),
      ])
      const ta = (t as Record<string, unknown> | null)?.tunnels ?? t
      const sa = (s as Record<string, unknown> | null)?.services ?? s
      const ka = (k as Record<string, unknown> | null)?.tokens ?? k
      setTunnels(Array.isArray(ta) ? (ta as TunnelRow[]) : [])
      setServices(Array.isArray(sa) ? (sa as ExposedSvc[]) : [])
      setTokens(Array.isArray(ka) ? (ka as PairingTok[]) : [])
      setBlocked(b)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const removeTunnel = async (id: string) => {
    if (!(await confirmDialog({ title: 'Tunnel entfernen', message: 'Tunnel entfernen?', confirmLabel: 'Entfernen', danger: true }))) return
    try { await adminFetch(`/api/connector/tunnels/${id}`, token, { method: 'DELETE' }); toast.success('Entfernt'); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const newToken = async () => {
    try {
      const r = await adminFetch('/api/connector/pairing-tokens', token, { method: 'POST', body: JSON.stringify({}) })
      const t = (r as Record<string, unknown>)?.token
      toast.success(t ? `Token: ${String(t).slice(0, 16)}…` : 'Token erstellt')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }
  const revokeToken = async (id: string) => {
    if (!(await confirmDialog({ title: 'Token widerrufen', message: 'Token widerrufen?', confirmLabel: 'Widerrufen', danger: true }))) return
    try { await adminFetch(`/api/connector/pairing-tokens/${id}`, token, { method: 'DELETE' }); toast.success('Widerrufen'); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Cloud Connector" icon={ShareNetwork}>
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {(['tunnels', 'services', 'tokens', 'blocked'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${view === v ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>
              {v === 'tunnels' ? `Tunnel (${tunnels.length})` : v === 'services' ? `Dienste (${services.length})` : v === 'tokens' ? `Pairing-Tokens (${tokens.length})` : 'Blockierte IPs'}
            </button>
          ))}
          <button onClick={load} disabled={loading} className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40"><ArrowClockwise size={13} /></button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}

        {!loading && view === 'tunnels' && (
          tunnels.length === 0 ? <p className="text-xs text-foreground/50">Keine aktiven Tunnel.</p> : (
            <div className="space-y-2">
              {tunnels.map((t, i) => (
                <div key={t.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{t.name ?? t.id}</span>
                    {t.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{t.status}</span>}
                    <button onClick={() => t.id && removeTunnel(t.id)} className="ml-auto p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                  </div>
                  {t.endpoint && <div className="text-[10px] font-mono text-foreground/50 mt-1">{t.endpoint}</div>}
                </div>
              ))}
            </div>
          )
        )}
        {!loading && view === 'services' && (
          services.length === 0 ? <p className="text-xs text-foreground/50">Keine exponierten Dienste.</p> : (
            <div className="space-y-2">
              {services.map((s, i) => (
                <div key={s.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="text-sm font-semibold text-foreground">{s.name ?? s.id}</div>
                  <div className="text-[10px] text-foreground/40 mt-1 flex gap-2 flex-wrap">
                    {s.local_port && <span>Port: {s.local_port}</span>}
                    {s.public_url && <span className="font-mono">{s.public_url}</span>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
        {!loading && view === 'tokens' && (
          <>
            <button onClick={newToken} className="mb-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent/20 text-accent hover:bg-accent/30 flex items-center gap-1"><Plus size={12} /> Pairing-Token erstellen</button>
            {tokens.length === 0 ? <p className="text-xs text-foreground/50">Keine Tokens.</p> : (
              <div className="space-y-2">
                {tokens.map((k, i) => (
                  <div key={k.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3 flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground/70 truncate flex-1">{k.token ?? k.id}</span>
                    {k.expires_at && <span className="text-[10px] text-foreground/40">läuft ab: {new Date(k.expires_at).toLocaleString('de-DE')}</span>}
                    <button onClick={() => k.id && revokeToken(k.id)} className="p-1.5 rounded bg-red-500/15 text-red-300 hover:bg-red-500/25"><Trash size={11} /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!loading && view === 'blocked' && blocked !== null && <ServiceJsonBlock data={blocked} max="max-h-96" />}
      </AdminCard>
    </div>
  )
}

// ─── Domain Validator (iora-domain-validator) ───────────────────────────

export function DomainValidatorTab({ token }: { token: string }) {
  const [appId, setAppId] = useState('')
  const [policy, setPolicy] = useState<unknown>(null)
  const [logs, setLogs] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [validateUrl, setValidateUrl] = useState('https://')
  const [validateApp, setValidateApp] = useState('')
  const [validation, setValidation] = useState<unknown>(null)

  const loadFor = async () => {
    if (!appId.trim()) return
    setBusy(true); setError(null); setPolicy(null); setLogs(null)
    try {
      const [p, l] = await Promise.all([
        adminFetch(`/api/domain-validator/policy/${encodeURIComponent(appId)}`, token).catch(() => null),
        adminFetch(`/api/domain-validator/logs/${encodeURIComponent(appId)}`, token).catch(() => null),
      ])
      setPolicy(p); setLogs(l)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const validate = async () => {
    if (!validateUrl.trim() || !validateApp.trim()) return
    setBusy(true); setError(null); setValidation(null)
    try {
      const r = await adminFetch('/api/domain-validator/validate', token, {
        method: 'POST',
        body: JSON.stringify({ app_id: validateApp, url: validateUrl }),
      })
      setValidation(r)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Zugriff prüfen" icon={ShieldCheck}>
        <p className="text-xs text-foreground/60 mb-3">
          Manueller Test: Darf eine bestimmte App auf eine externe URL zugreifen? Liefert die gleiche Entscheidung wie der Live-Validator.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={validateApp} onChange={(e) => setValidateApp(e.target.value)} placeholder="App-ID"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <input value={validateUrl} onChange={(e) => setValidateUrl(e.target.value)} placeholder="https://example.com/path"
            className="text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
        </div>
        <button onClick={validate} disabled={busy || !validateUrl.trim() || !validateApp.trim()}
          className="ora-ghost-button-sm mt-2">{busy ? '…' : 'Validieren'}</button>
        {validation !== null && <div className="mt-3"><ServiceJsonBlock data={validation} /></div>}
      </AdminCard>

      <AdminCard title="Policy & Audit-Log pro App" icon={Eye}>
        <div className="flex items-center gap-2 mb-3">
          <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="App-ID eingeben…"
            className="flex-1 text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground" />
          <button onClick={loadFor} disabled={busy || !appId.trim()}
            className="ora-ghost-button-sm">{busy ? '…' : 'Laden'}</button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {policy !== null && (
          <div className="mb-3">
            <div className="text-xs font-semibold text-foreground mb-1">Policy</div>
            <ServiceJsonBlock data={policy} />
          </div>
        )}
        {logs !== null && (
          <div>
            <div className="text-xs font-semibold text-foreground mb-1">Audit-Log</div>
            <ServiceJsonBlock data={logs} max="max-h-96" />
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Resource Manager (iora-resource-manager) ───────────────────────────
export interface ContainerRow { id?: string; name?: string; status?: string; cpu?: number; memory?: number; memory_limit?: number }

export function ResourcesTab({ token }: { token: string }) {
  const [containers, setContainers] = useState<ContainerRow[]>([])
  const [system, setSystem] = useState<unknown>(null)
  const [history, setHistory] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [c, s, h] = await Promise.all([
        adminFetch('/api/resources/containers', token).catch(() => null),
        adminFetch('/api/resources/system', token).catch(() => null),
        adminFetch('/api/resources/history', token).catch(() => null),
      ])
      const arr = (c as Record<string, unknown> | null)?.containers ?? c
      setContainers(Array.isArray(arr) ? (arr as ContainerRow[]) : [])
      setSystem(s); setHistory(h)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])
  useEffect(() => { load(); const i = setInterval(load, 15000); return () => clearInterval(i) }, [load])

  const reallocate = async () => {
    if (!(await confirmDialog({ title: 'Reallokation', message: 'Reallokation jetzt auslösen?', confirmLabel: 'Auslösen', danger: true }))) return
    try { await adminFetch('/api/resources/reallocate', token, { method: 'POST', body: '{}' }); toast.success('Reallokation gestartet'); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
  }

  return (
    <div className="space-y-3">
      <AdminCard title="System-Ressourcen" icon={HardDrive}>
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {system !== null && <ServiceJsonBlock data={system} max="max-h-40" />}
        <div className="mt-3 flex justify-end">
          <button onClick={reallocate} className="ora-ghost-button-sm">Reallokation auslösen</button>
        </div>
      </AdminCard>

      <AdminCard title={`Container (${containers.length})`} icon={Cube}>
        {containers.length === 0 ? <p className="text-xs text-foreground/50">Keine Container.</p> : (
          <div className="space-y-2 max-h-96 overflow-auto">
            {containers.map((c, i) => {
              const memPct = c.memory && c.memory_limit ? Math.min(100, (c.memory / c.memory_limit) * 100) : 0
              return (
                <div key={c.id ?? i} className="rounded-xl bg-foreground/5 border border-foreground/10 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground truncate">{c.name ?? c.id}</span>
                    {c.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{c.status}</span>}
                    <span className="ml-auto text-[10px] text-foreground/50">CPU {c.cpu !== undefined ? `${c.cpu.toFixed(1)}%` : '–'}</span>
                  </div>
                  {c.memory_limit && (
                    <div className="mt-2">
                      <div className="text-[10px] text-foreground/40 mb-0.5">RAM {memPct.toFixed(0)}%</div>
                      <div className="h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                        <div className={`h-full ${memPct > 80 ? 'bg-red-400' : memPct > 60 ? 'bg-amber-400' : 'bg-accent'}`} style={{ width: `${memPct}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      <AdminCard title="Allokations-Verlauf" icon={Clock}>
        {history !== null && <ServiceJsonBlock data={history} max="max-h-72" />}
      </AdminCard>
    </div>
  )
}

// ─── API Bridge (iora-api: GraphQL / WebDAV / CalDAV / MQTT) ───────────

export function ApiBridgeTab({ token }: { token: string }) {
  const [metrics, setMetrics] = useState<unknown>(null)
  const [interfaces, setInterfaces] = useState<unknown>(null)
  const [topics, setTopics] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [m, i, t] = await Promise.all([
        adminFetch('/api/metrics', token).catch(() => null),
        adminFetch('/api/interfaces', token).catch(() => null),
        adminFetch('/api/mqtt/topics', token).catch(() => null),
      ])
      setMetrics(m); setInterfaces(i); setTopics(t)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [token])
  useEffect(() => { load() }, [load])

  const apiBase = backendBase() || window.location.origin
  const endpoints: { label: string; path: string; description: string }[] = [
    { label: 'GraphQL', path: '/graphql', description: 'GraphQL-Playground für Entities, Services, Areas' },
    { label: 'GraphQL WS', path: '/graphql/ws', description: 'Subscriptions über WebSocket' },
    { label: 'WebDAV', path: '/webdav', description: 'Datei-Mount via WebDAV-Client' },
    { label: 'CalDAV', path: '/caldav', description: 'Kalender-Sync (Apple/Thunderbird/DAVx⁵)' },
    { label: 'CalDAV Discovery', path: '/.well-known/caldav', description: 'Auto-Discovery für CalDAV-Clients' },
    { label: 'REST v2 Entities', path: '/entities', description: 'Stable v2 Entity-API' },
    { label: 'REST v2 Services', path: '/services', description: 'Stable v2 Service-Calls' },
    { label: 'Batch', path: '/batch', description: 'Batch-Anfragen für mehrere REST-Calls in einem Request' },
  ]

  return (
    <div className="space-y-3">
      <AdminCard title="Externe API-Schnittstellen" icon={Code}>
        <p className="text-xs text-foreground/60 mb-3">
          iora-api bündelt alle stabilen externen Protokolle. Kopiere eine URL, um sie in einem Client (DAVx⁵, Thunderbird, GraphiQL, …) zu konfigurieren.
        </p>
        <div className="space-y-1.5">
          {endpoints.map((e) => {
            const url = `${apiBase}${e.path}`
            return (
              <div key={e.path} className="rounded-lg bg-foreground/5 border border-foreground/10 p-2.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground w-28 shrink-0">{e.label}</span>
                <span className="text-[11px] font-mono text-foreground/70 truncate flex-1">{url}</span>
                <button onClick={() => { navigator.clipboard.writeText(url); toast.success('Kopiert') }} className="p-1.5 rounded bg-foreground/5 text-foreground/60 hover:bg-foreground/10"><Copy size={11} /></button>
              </div>
            )
          })}
        </div>
      </AdminCard>

      <AdminCard title="API-Metriken" icon={ChartLine}>
        {loading && <p className="text-xs text-foreground/50">Lade…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {metrics !== null && <ServiceJsonBlock data={metrics} max="max-h-72" />}
      </AdminCard>

      <AdminCard title="Verfügbare Interfaces" icon={Stack}>
        {interfaces !== null && <ServiceJsonBlock data={interfaces} />}
      </AdminCard>

      <AdminCard title="MQTT Bridge — Topics" icon={WifiHigh}>
        {topics !== null && <ServiceJsonBlock data={topics} />}
      </AdminCard>
    </div>
  )
}


// ─── IORA OS (only meaningful on actual IORA OS device) ─────────────────────────

