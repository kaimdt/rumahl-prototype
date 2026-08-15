import { useCallback, useEffect, useState } from 'react'
import { ArrowClockwise, Broadcast, Cpu, Desktop, Globe, MagnifyingGlass, Monitor, PencilSimple, Pulse, Terminal, Trash, UserMinus, Users, WifiHigh } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ui/confirmDialog'
import { Tip } from '@/components/ui/tip'
import { OsPermissionEditor } from '@/components/OsPermissionEditor'
import { AdminCard, ErrorMessage, InlineSpinner, LoadingSpinner, StatItem, adminFetch, cachedFetch, ccBadge, ccBtnSecondary, formatAge, notifyError, type AdminUser } from '../AdminPanel'
import { PresencePayload, PresenceUser } from './core'
import { AdminDevicesPayload } from './ai'
export function UsersTab({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ display_name: '', new_password: '', role: '' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/admin/users', token)
      setUsers(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const toggleAdmin = async (userId: string, isAdmin: boolean) => {
    setActionLoading(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}/admin`, token, {
        method: 'PUT',
        body: JSON.stringify({ is_admin: !isAdmin }),
      })
      await load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleDelete = async (userId: string) => {
    setActionLoading(userId)
    try {
      await adminFetch(`/api/admin/users/${userId}`, token, { method: 'DELETE' })
      setConfirmDelete(null)
      await load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  const handleEdit = async (userId: string) => {
    setActionLoading(userId)
    try {
      const body: Record<string, string> = {}
      if (editForm.display_name) body.display_name = editForm.display_name
      if (editForm.new_password) body.new_password = editForm.new_password
      if (editForm.role) body.role = editForm.role
      await adminFetch(`/api/admin/users/${userId}`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      setEditingUser(null)
      setEditForm({ display_name: '', new_password: '', role: '' })
      await load()
    } catch (e) { notifyError(e) }
    finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const filtered = search
    ? users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) ||
        (u.display_name || '').toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <AdminCard>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users size={16} className="text-accent" />
            {users.length} Benutzer
          </div>
          <div className="flex items-center gap-2 bg-foreground/5 rounded-lg px-3 py-1.5 flex-1 max-w-xs">
            <MagnifyingGlass size={14} className="text-foreground/75" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Suchen..."
              className="bg-transparent text-xs outline-none flex-1 text-foreground placeholder:text-foreground/85"
            />
          </div>
        </div>
      </AdminCard>

      {/* User list */}
      {filtered.map(u => (
        <AdminCard key={u.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-full bg-accent/15 flex items-center justify-center text-accent font-bold text-sm flex-shrink-0">
                {(u.display_name || u.username).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{u.display_name || u.username}</div>
                <div className="text-xs text-foreground/80">@{u.username} · Erstellt: {new Date(u.created_at).toLocaleDateString('de-DE')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex gap-1 text-[10px]">
                {u.has_password && <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-semibold border border-green-500/30">PW</span>}
                {u.has_pin && <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/30">PIN</span>}
              </div>
              <Tip content={u.is_admin ? 'Admin entfernen' : 'Zum Admin machen'}>
                <button
                  onClick={() => toggleAdmin(u.id, u.is_admin)}
                  disabled={actionLoading === u.id}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                    u.is_admin
                      ? 'bg-accent text-white shadow-sm shadow-accent/25'
                      : 'bg-foreground/10 text-foreground border border-foreground/15 hover:bg-foreground/20'
                  }`}
                >
                  {actionLoading === u.id ? <InlineSpinner size={12} /> : ({ admin: 'Admin', editor: 'Editor', viewer: 'Betrachter', maintenance: 'Wartung', user: 'User' }[u.role] || (u.is_admin ? 'Admin' : 'User'))}
                </button>
              </Tip>
              <Tip content="Bearbeiten">
                <button
                  onClick={() => { setEditingUser(editingUser === u.id ? null : u.id); setEditForm({ display_name: u.display_name || '', new_password: '', role: u.role || 'user' }) }}
                  className="p-1.5 rounded-lg text-foreground/75 hover:text-accent hover:bg-accent/10 transition-all"
                >
                  <PencilSimple size={14} />
                </button>
              </Tip>
              <Tip content="Löschen">
                <button
                  onClick={() => setConfirmDelete(confirmDelete === u.id ? null : u.id)}
                  className="p-1.5 rounded-lg text-foreground/75 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <UserMinus size={14} />
                </button>
              </Tip>
            </div>
          </div>

          {/* Edit form */}
          {editingUser === u.id && (
            <div className="mt-3 pt-3 border-t border-foreground/10 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Anzeigename</label>
                  <input
                    type="text"
                    value={editForm.display_name}
                    onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                    className="ora-field-sm w-full text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Neues Passwort</label>
                  <input
                    type="password"
                    value={editForm.new_password}
                    onChange={e => setEditForm({ ...editForm, new_password: e.target.value })}
                    placeholder="Leer = nicht ändern"
                    className="ora-field-sm w-full text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-foreground/80 mb-1 block">Rolle</label>
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    className="ora-field-sm w-full text-xs"
                  >
                    <option value="viewer">Betrachter</option>
                    <option value="user">Benutzer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Administrator</option>
                    <option value="maintenance">Wartung</option>
                  </select>
                </div>
              </div>
              <OsPermissionEditor userId={u.id} isAdmin={u.is_admin} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditingUser(null)} className="ora-secondary-button-sm">Abbrechen</button>
                <button onClick={() => handleEdit(u.id)} disabled={actionLoading === u.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent/85 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading === u.id && <InlineSpinner size={12} />} Speichern
                </button>
              </div>
            </div>
          )}

          {/* Confirm delete */}
          {confirmDelete === u.id && (
            <div className="mt-3 pt-3 border-t border-red-500/20 flex items-center justify-between">
              <span className="text-xs text-red-400">Benutzer wirklich löschen?</span>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(null)} className="ora-secondary-button-sm">Nein</button>
                <button onClick={() => handleDelete(u.id)} disabled={actionLoading === u.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white shadow-sm shadow-red-500/25 hover:bg-red-600 transition-all disabled:opacity-50 flex items-center gap-1.5">
                  {actionLoading === u.id && <InlineSpinner size={12} />} Ja, löschen
                </button>
              </div>
            </div>
          )}
        </AdminCard>
      ))}
    </div>
  )
}

// ── API Keys Tab ──────────────────────────────────────────────


export function NetworkTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/network', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const networkAvailable = data?.network_available as boolean
  const info = data?.info as Record<string, unknown> | undefined
  const connectivity = data?.connectivity as Record<string, unknown> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title="Netzwerkstatus" icon={Globe}>
        {networkAvailable && info ? (
          <>
            {Object.entries(info).filter(([k]) => typeof info[k] !== 'object').slice(0, 10).map(([k, v]) => (
              <StatItem key={k} label={k} value={String(v)} />
            ))}
          </>
        ) : (
          <>
            <div className="text-xs text-foreground/80 mb-2">{data?.note as string}</div>
            {connectivity && (
              <>
                <StatItem label="HA REST API" value={connectivity.ha_rest_api ? '✓ Verbunden' : '✗ Getrennt'} />
                <StatItem label="HA WebSocket" value={connectivity.ha_websocket ? '✓ Verbunden' : '✗ Getrennt'} />
              </>
            )}
          </>
        )}
      </AdminCard>

      {networkAvailable && info && Array.isArray(info.interfaces) && (
        <AdminCard title="Netzwerk-Interfaces" icon={WifiHigh}>
          <div className="space-y-2">
            {(info.interfaces as Array<Record<string, unknown>>).map((iface, i) => (
              <div key={i} className="p-2 rounded-lg bg-foreground/5">
                <div className="text-xs font-medium text-foreground">{String(iface.interface ?? `Interface ${i}`)}</div>
                {iface.ip_address != null && <div className="text-[10px] text-foreground/80 mt-0.5">IP: {String(iface.ip_address)}</div>}
                {iface.type != null && <div className="text-[10px] text-foreground/80">Typ: {String(iface.type)}</div>}
                {typeof iface.enabled === 'boolean' && (
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    iface.enabled ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                  }`}>
                    {iface.enabled ? 'Aktiv' : 'Inaktiv'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Logs Tab ──────────────────────────────────────────────────

export interface IoraLogEntry {
  id: number
  timestamp: string
  level: string
  target: string
  message: string
  fields?: Record<string, unknown>
}


export function DevicesTab({ token }: { token: string }) {
  const [data, setData] = useState<AdminDevicesPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await adminFetch('/api/admin/devices', token)
      setData(r as AdminDevicesPayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
    const id = setInterval(load, 15000)
    return () => clearInterval(id)
  }, [load])

  const remove = async (id: string) => {
    if (!(await confirmDialog({ title: 'Gerät entfernen', message: 'Gerät wirklich aus der Registrierung entfernen?', confirmLabel: 'Entfernen', danger: true }))) return
    try {
      await adminFetch(`/api/admin/devices/${encodeURIComponent(id)}`, token, { method: 'DELETE' })
      toast.success('Gerät entfernt')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const filtered = (data?.devices ?? []).filter((d) => {
    if (filter === 'online') return d.online
    if (filter === 'offline') return !d.online
    return true
  })

  const formatAgo = (s: number): string => {
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}d`
  }

  const deviceIcon = (t?: string | null) => {
    const tt = (t ?? '').toLowerCase()
    if (tt.includes('desktop')) return Desktop
    if (tt.includes('mobile') || tt.includes('phone')) return Broadcast
    if (tt.includes('kiosk') || tt.includes('terminal')) return Monitor
    return Cpu
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Verbundene Geräte" icon={Desktop}>
        {loading && !data ? (
          <p className="text-xs text-foreground/50">Lade Geräte…</p>
        ) : error ? (
          <p className="text-xs text-red-300">{error}</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-xl bg-foreground/[0.04] border border-foreground/10 p-3">
                <div className="text-[10px] uppercase tracking-wide text-foreground/40">Registriert</div>
                <div className="text-base font-semibold text-foreground mt-1">{data.total}</div>
              </div>
              <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3">
                <div className="text-[10px] uppercase tracking-wide text-green-300/70">Online</div>
                <div className="text-base font-semibold text-green-300 mt-1">{data.online}</div>
                <div className="text-[10px] text-green-300/50 mt-0.5">≤ {data.online_threshold_seconds}s</div>
              </div>
              <div className="rounded-xl bg-accent/10 border border-accent/20 p-3">
                <div className="text-[10px] uppercase tracking-wide text-accent/70">WebSocket-Sitzungen</div>
                <div className="text-base font-semibold text-accent mt-1">{data.connected_ws_clients}</div>
                <div className="text-[10px] text-accent/50 mt-0.5">live</div>
              </div>
            </div>

            <div className="flex items-center gap-1 mb-3">
              {(['all', 'online', 'offline'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    filter === f ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
                  }`}>
                  {f === 'all' ? `Alle (${data.devices.length})` : f === 'online' ? `Online (${data.online})` : `Offline (${data.total - data.online})`}
                </button>
              ))}
              <button onClick={load} disabled={loading}
                className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
                <ArrowClockwise size={13} />
              </button>
            </div>

            {filtered.length === 0 ? (
              <p className="text-xs text-foreground/50">Keine Geräte in dieser Auswahl.</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((d) => {
                  const Icon = deviceIcon(d.device_type)
                  return (
                    <div key={d.id} className={`rounded-xl border p-3 ${d.online ? 'border-green-500/30 bg-green-500/5' : 'border-foreground/10 bg-foreground/[0.03]'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`rounded-lg p-2 ${d.online ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
                          <Icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground truncate">{d.device_name}</span>
                            {d.device_type && <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono">{d.device_type}</span>}
                            {d.is_terminal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono">terminal</span>}
                            {d.online ? (
                              <span className="ml-auto flex items-center gap-1 text-[10px] text-green-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" /> online
                              </span>
                            ) : (
                              <span className="ml-auto text-[10px] text-foreground/40">offline · vor {formatAgo(d.seconds_since_seen)}</span>
                            )}
                          </div>
                          {d.terminal_name && <div className="text-[11px] text-foreground/50 mt-0.5">Terminal: {d.terminal_name}</div>}
                          {d.user_agent && <div className="text-[10px] text-foreground/40 mt-1 font-mono truncate">{d.user_agent}</div>}
                          <div className="text-[10px] text-foreground/30 mt-1 flex gap-2 flex-wrap">
                            <span className="font-mono">{d.id.slice(0, 8)}</span>
                            <span>· zuletzt: {new Date(d.last_seen).toLocaleString('de-DE')}</span>
                            <span>· seit: {new Date(d.created_at).toLocaleDateString('de-DE')}</span>
                          </div>
                        </div>
                        <button onClick={() => remove(d.id)} title="Gerät entfernen"
                          className="p-1.5 rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25">
                          <Trash size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : null}
      </AdminCard>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// IORA BACKEND-SERVICE TABS
// ════════════════════════════════════════════════════════════════════════
//
// Each of the iora-* microservices exposes its own HTTP API. These tabs
// expose the most important admin-facing surface of every service the
// control center previously had no UI for. All requests go through
// nginx (`/api/<service>/*`) so the same JWT works everywhere.

// Small helper for JSON dumps that fit nicely in a card.

export function PresenceTab({ token }: { token: string }) {
  const [data, setData] = useState<PresencePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await adminFetch('/api/admin/presence', token)
      setData(res as PresencePayload)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [token])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!data) return null

  const userById = new Map(data.users.map(u => [u.id, u]))
  const onlineUsers = data.users.filter(u => u.online)
  const offlineUsers = data.users.filter(u => !u.online)
  const onlineDevices = data.devices.filter(d => d.online)
  const offlineDevices = data.devices.filter(d => !d.online)

  return (
    <div className="space-y-3">
      {/* Stats header */}
      <AdminCard>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wider text-foreground/55">Nutzer online</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {data.totals.online_users}
                <span className="text-sm text-foreground/40 font-normal"> / {data.totals.users}</span>
              </p>
            </div>
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wider text-foreground/55">Geräte online</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {data.totals.online_devices}
                <span className="text-sm text-foreground/40 font-normal"> / {data.totals.devices}</span>
              </p>
            </div>
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wider text-foreground/55">Aktive WebSockets</p>
              <p className="text-2xl font-semibold text-foreground mt-1">{data.totals.connected_ws_clients}</p>
            </div>
            <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wider text-foreground/55">Online-Schwelle</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {data.online_threshold_seconds}s
              </p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className={ccBtnSecondary()}
          >
            {refreshing ? <InlineSpinner /> : <Pulse size={14} weight="bold" />}
            <span>Aktualisieren</span>
          </button>
        </div>
      </AdminCard>

      {/* Users grouped by online state */}
      <AdminCard>
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} className="text-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground">Angemeldete Nutzer</h3>
          <span className={ccBadge('bg-emerald-500/15 text-emerald-500')}>
            {onlineUsers.length} online
          </span>
        </div>

        {data.users.length === 0 ? (
          <p className="text-sm text-foreground/55">Keine Benutzer registriert.</p>
        ) : (
          <div className="space-y-2">
            {[...onlineUsers, ...offlineUsers].map(u => (
              <div
                key={u.id}
                className={`rounded-xl border p-3 transition-colors ${
                  u.online
                    ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                    : 'border-foreground/10 bg-foreground/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        u.online ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-foreground/20'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {u.display_name || u.username}
                      </p>
                      <p className="text-xs text-foreground/55 truncate">
                        @{u.username} · <span className="font-mono">{u.role}</span>
                        {u.is_admin && <span className="ml-1 text-amber-500">★ Admin</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={ccBadge('bg-foreground/10 text-foreground/70')}>
                      {u.device_count} Gerät{u.device_count === 1 ? '' : 'e'}
                    </span>
                  </div>
                </div>

                {u.devices.length > 0 && (
                  <div className="mt-3 pl-5 space-y-1.5 border-l-2 border-foreground/10">
                    {u.devices.map(d => (
                      <div
                        key={d.device_id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-block w-1.5 h-1.5 rounded-full ${
                              d.online ? 'bg-emerald-500' : 'bg-foreground/25'
                            }`}
                            aria-hidden
                          />
                          {d.is_desktop_client ? (
                            <Desktop size={12} className="text-foreground/55 shrink-0" />
                          ) : (
                            <Monitor size={12} className="text-foreground/55 shrink-0" />
                          )}
                          <span className="text-foreground/85 truncate">{d.device_name}</span>
                          {d.is_primary && (
                            <span className="text-[9px] text-amber-500 font-semibold">PRIMÄR</span>
                          )}
                          {d.is_desktop_client && (
                            <span className="text-[9px] text-accent font-semibold">DESKTOP</span>
                          )}
                          {d.device_type && (
                            <span className="text-[10px] text-foreground/45 font-mono">{d.device_type}</span>
                          )}
                        </div>
                        <span className="text-foreground/50 text-[10px] font-mono shrink-0">
                          {d.last_seen
                            ? `vor ${formatAge(Math.floor((Date.now() - new Date(d.last_seen).getTime()) / 1000))}`
                            : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Devices view */}
      <AdminCard>
        <div className="flex items-center gap-2 mb-3">
          <Desktop size={16} className="text-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground">Verbundene Geräte</h3>
          <span className={ccBadge('bg-emerald-500/15 text-emerald-500')}>
            {onlineDevices.length} online
          </span>
        </div>

        {data.devices.length === 0 ? (
          <p className="text-sm text-foreground/55">Keine Geräte registriert.</p>
        ) : (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-foreground/55 border-b border-foreground/10">
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Gerät</th>
                  <th className="py-2 pr-3 font-medium">Typ</th>
                  <th className="py-2 pr-3 font-medium">Angemeldete Nutzer</th>
                  <th className="py-2 pr-3 font-medium text-right">Zuletzt gesehen</th>
                </tr>
              </thead>
              <tbody>
                {[...onlineDevices, ...offlineDevices].map(d => {
                  const users = d.user_ids
                    .map(id => userById.get(id))
                    .filter((u): u is PresenceUser => !!u)
                  return (
                    <tr key={d.id} className="border-b border-foreground/[0.06] last:border-0">
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            d.online ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : 'bg-foreground/20'
                          }`}
                          aria-hidden
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-foreground truncate max-w-[220px]">
                          {d.device_name}
                          {d.is_terminal && (
                            <span className="ml-1 text-[9px] text-accent font-semibold">KIOSK</span>
                          )}
                        </p>
                        {d.terminal_name && (
                          <p className="text-[10px] text-foreground/45">{d.terminal_name}</p>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-foreground/70 font-mono text-[10px]">
                        {d.device_type || '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {users.length === 0 ? (
                          <span className="text-foreground/40">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {users.map(u => (
                              <span
                                key={u.id}
                                className={ccBadge(
                                  u.online
                                    ? 'bg-emerald-500/15 text-emerald-500'
                                    : 'bg-foreground/10 text-foreground/70'
                                )}
                              >
                                {u.display_name || u.username}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right text-foreground/55 font-mono text-[10px]">
                        vor {formatAge(d.seconds_since_seen)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <p className="text-[10px] text-foreground/40 text-center">
        Auto-Refresh alle 15s · Daten generiert {new Date(data.generated_at).toLocaleTimeString()}
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// SystemLogsTab — IORA Control Center central event log.
//
// All errors / warnings / infos from anywhere in the stack (backend
// tracing layer, background tasks, frontend window errors, SDK clients)
// land in two Postgres tables and are surfaced here:
//
//   • "Gruppiert" view — one row per unique (severity, source, message)
//     fingerprint, with an occurrence counter so repeated failures don't
//     drown out the signal. Each row can be drilled into to see all of
//     its individual occurrences with full metadata.
//
//   • "Verlauf" view — raw chronological stream of every single
//     occurrence (no dedup), exactly as it happened.
//
// Powered by `system_events::SystemEventLog` + migration
// `031_system_events.sql`.
// ═══════════════════════════════════════════════════════════════════════

export type Severity = 'error' | 'warning' | 'info'
export type Origin = 'backend' | 'tracing' | 'frontend'

export interface EventGroup {
  fingerprint: string
  severity: Severity
  source: string
  message: string
  count: number
  first_seen: string
  last_seen: string
  resolved: boolean
  resolved_at?: string | null
  resolved_by?: string | null
  last_details?: unknown
}

export interface EventOccurrence {
  id: number
  fingerprint: string
  severity: Severity
  source: string
  message: string
  origin: Origin
  occurred_at: string
  user_id?: string | null
  request_path?: string | null
  request_method?: string | null
  status_code?: number | null
  file?: string | null
  line?: number | null
  target?: string | null
  error_chain?: string | null
  details?: unknown
}

export interface EventStats {
  total_groups: number
  unresolved_groups: number
  unresolved_errors: number
  unresolved_warnings: number
  total_occurrences: number
  occurrences_last_hour: number
  occurrences_last_day: number
  ingest_drops: number
}
