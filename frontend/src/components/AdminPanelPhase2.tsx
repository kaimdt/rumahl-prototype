import { useState, useCallback, useEffect } from 'react'
import { Check, X, Clock, ShieldCheck, Warning, ArrowUp, ArrowDown, Package, Cpu, Cube, ArrowClockwise, Pause, TrashSimple } from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { confirmDialog } from '@/components/ui/confirmDialog'

// ── Phase 2: Registration Management ──────────────────────────────────────

interface RegistrationRequest {
  id: string
  provider_id: string
  provider_type: 'app' | 'plugin'
  name: string
  version: string
  developer: string
  description: string
  requested_permissions: string[]
  status: 'pending' | 'approved' | 'rejected' | 'suspended' | 'revoked'
  requested_at: string
  reviewed_at?: string
  reviewer?: string
  api_token?: string
}

export function RegistrationManagementTab({ token }: { token: string }) {
  const [registrations, setRegistrations] = useState<RegistrationRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [processing, setProcessing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/core/registrations', token) as { registrations: RegistrationRequest[] }
      setRegistrations(data.registrations || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const approveRegistration = async (id: string) => {
    setProcessing(id)
    try {
      await adminFetch(`/api/core/registrations/${id}/approve`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
    setProcessing(null)
  }

  const rejectRegistration = async (id: string) => {
    setProcessing(id)
    try {
      await adminFetch(`/api/core/registrations/${id}/reject`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
    setProcessing(null)
  }

  const suspendRegistration = async (id: string) => {
    setProcessing(id)
    try {
      await adminFetch(`/api/core/registrations/${id}/suspend`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
    setProcessing(null)
  }

  const revokeRegistration = async (id: string) => {
    if (!(await confirmDialog({ title: 'Registrierung widerrufen', message: 'Registrierung wirklich widerrufen?', confirmLabel: 'Widerrufen', danger: true }))) return
    setProcessing(id)
    try {
      await adminFetch(`/api/core/registrations/${id}/revoke`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
    setProcessing(null)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const pendingCount = registrations.filter(r => r.status === 'pending').length
  const approvedCount = registrations.filter(r => r.status === 'approved').length

  return (
    <div className="space-y-3">
      {/* Overview */}
      <AdminCard title="Übersicht" icon={ShieldCheck}>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-yellow-500/10 text-center">
            <div className="text-[10px] text-yellow-400/70 mb-1">Ausstehend</div>
            <div className="text-2xl font-bold text-yellow-400">{pendingCount}</div>
          </div>
          <div className="p-3 rounded-lg bg-green-500/10 text-center">
            <div className="text-[10px] text-green-400/70 mb-1">Genehmigt</div>
            <div className="text-2xl font-bold text-green-400">{approvedCount}</div>
          </div>
          <div className="p-3 rounded-lg bg-foreground/5 text-center">
            <div className="text-[10px] text-foreground/40 mb-1">Gesamt</div>
            <div className="text-2xl font-bold text-foreground">{registrations.length}</div>
          </div>
        </div>
      </AdminCard>

      {/* Registrations List */}
      <AdminCard title={`Registrierungen (${registrations.length})`} icon={Package}>
        {registrations.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Registrierungen.</p>
        ) : (
          <div className="space-y-2">
            {registrations.map((reg, i) => (
              <div key={i} className="p-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      {reg.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        reg.status === 'pending' ? 'bg-yellow-500/15 text-yellow-400' :
                        reg.status === 'approved' ? 'bg-green-500/15 text-green-400' :
                        reg.status === 'rejected' ? 'bg-red-500/15 text-red-400' :
                        reg.status === 'suspended' ? 'bg-orange-500/15 text-orange-400' :
                        'bg-foreground/10 text-foreground/40'
                      }`}>{reg.status}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-accent/15 text-accent">{reg.provider_type}</span>
                    </div>
                    <div className="text-[10px] text-foreground/40">{reg.description}</div>
                    <div className="text-[10px] text-foreground/40 mt-0.5">v{reg.version} • {reg.developer}</div>
                  </div>
                </div>

                {/* Requested Permissions */}
                {reg.requested_permissions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-foreground/5">
                    <div className="text-[10px] text-foreground/40 mb-1">Angeforderte Berechtigungen:</div>
                    <div className="flex flex-wrap gap-1">
                      {reg.requested_permissions.map((perm, j) => (
                        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60">{perm}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Metadata */}
                <div className="mt-2 text-[10px] text-foreground/40">
                  <div>Angefragt: {new Date(reg.requested_at).toLocaleString('de-DE')}</div>
                  {reg.reviewed_at && <div>Überprüft: {new Date(reg.reviewed_at).toLocaleString('de-DE')} {reg.reviewer && `von ${reg.reviewer}`}</div>}
                  {reg.api_token && <div className="font-mono mt-1 truncate">Token: {reg.api_token.substring(0, 16)}...</div>}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-2">
                  {reg.status === 'pending' && (
                    <>
                      <button onClick={() => approveRegistration(reg.id)} disabled={processing === reg.id}
                        className="flex items-center gap-1 px-2 py-1 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors disabled:opacity-40">
                        {processing === reg.id ? <InlineSpinner size={12} /> : <Check size={12} />} Genehmigen
                      </button>
                      <button onClick={() => rejectRegistration(reg.id)} disabled={processing === reg.id}
                        className="flex items-center gap-1 px-2 py-1 bg-red-500/15 text-red-400 rounded text-[10px] font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-40">
                        {processing === reg.id ? <InlineSpinner size={12} /> : <X size={12} />} Ablehnen
                      </button>
                    </>
                  )}
                  {reg.status === 'approved' && (
                    <button onClick={() => suspendRegistration(reg.id)} disabled={processing === reg.id}
                      className="flex items-center gap-1 px-2 py-1 bg-orange-500/15 text-orange-400 rounded text-[10px] font-semibold hover:bg-orange-500/25 transition-colors disabled:opacity-40">
                      {processing === reg.id ? <InlineSpinner size={12} /> : <Pause size={12} />} Aussetzen
                    </button>
                  )}
                  {(reg.status === 'approved' || reg.status === 'suspended') && (
                    <button onClick={() => revokeRegistration(reg.id)} disabled={processing === reg.id}
                      className="flex items-center gap-1 px-2 py-1 bg-red-500/15 text-red-400 rounded text-[10px] font-semibold hover:bg-red-500/25 transition-colors disabled:opacity-40">
                      {processing === reg.id ? <InlineSpinner size={12} /> : <TrashSimple size={12} />} Widerrufen
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Phase 2: Security Monitor Dashboard ──────────────────────────────────

interface SecurityEvent {
  id: string
  provider_id: string
  provider_type: 'app' | 'plugin'
  event_type: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  message: string
  metadata: Record<string, unknown>
  timestamp: string
}

interface ResourceUsage {
  provider_id: string
  provider_type: 'app' | 'plugin'
  cpu_percent: number
  memory_mb: number
  network_rx_bytes: number
  network_tx_bytes: number
  disk_read_bytes: number
  disk_write_bytes: number
  timestamp: string
}

interface SecurityAlert {
  id: number
  alert_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  message: string
  created_at: string
  acknowledged: boolean
  acknowledged_at?: string | null
}

export function SecurityMonitorTab({ token }: { token: string }) {
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [resourceUsage, setResourceUsage] = useState<ResourceUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [eventsData, alertsData, usageData] = await Promise.all([
        adminFetch('/api/core/security/events', token) as Promise<{ events: SecurityEvent[] }>,
        adminFetch('/api/core/security/alerts', token) as Promise<{ alerts: SecurityAlert[] }>,
        adminFetch('/api/core/security/resource-usage', token) as Promise<{ usage: ResourceUsage[] }>,
      ])
      setEvents(eventsData.events || [])
      setAlerts(alertsData.alerts || [])
      setResourceUsage(usageData.usage || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const acknowledgeAlert = async (alertId: number) => {
    try {
      await adminFetch(`/api/core/security/alerts/${alertId}/acknowledge`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const criticalAlerts = alerts.filter(a => !a.acknowledged && a.severity === 'critical').length
  const highAlerts = alerts.filter(a => !a.acknowledged && a.severity === 'high').length

  return (
    <div className="space-y-3">
      {/* Alerts Overview */}
      <AdminCard title="Sicherheitswarnungen" icon={Warning}>
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 rounded-lg bg-red-500/10 text-center">
            <div className="text-[10px] text-red-400/70">Kritisch</div>
            <div className="text-xl font-bold text-red-400">{criticalAlerts}</div>
          </div>
          <div className="p-2 rounded-lg bg-orange-500/10 text-center">
            <div className="text-[10px] text-orange-400/70">Hoch</div>
            <div className="text-xl font-bold text-orange-400">{highAlerts}</div>
          </div>
          <div className="p-2 rounded-lg bg-yellow-500/10 text-center">
            <div className="text-[10px] text-yellow-400/70">Mittel</div>
            <div className="text-xl font-bold text-yellow-400">{alerts.filter(a => !a.acknowledged && a.severity === 'medium').length}</div>
          </div>
          <div className="p-2 rounded-lg bg-blue-500/10 text-center">
            <div className="text-[10px] text-blue-400/70">Niedrig</div>
            <div className="text-xl font-bold text-blue-400">{alerts.filter(a => !a.acknowledged && a.severity === 'low').length}</div>
          </div>
        </div>
      </AdminCard>

      {/* Active Alerts */}
      {alerts.filter(a => !a.acknowledged).length > 0 && (
        <AdminCard title="Aktive Warnungen" icon={ShieldCheck}>
          <div className="space-y-1.5">
            {alerts.filter(a => !a.acknowledged).map((alert, i) => (
              <div key={i} className={`p-2.5 rounded-lg border ${
                alert.severity === 'critical' ? 'bg-red-500/10 border-red-500/30' :
                alert.severity === 'high' ? 'bg-orange-500/10 border-orange-500/30' :
                alert.severity === 'medium' ? 'bg-yellow-500/10 border-yellow-500/30' :
                'bg-blue-500/10 border-blue-500/30'
              }`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <Warning size={14} className={
                        alert.severity === 'critical' ? 'text-red-400' :
                        alert.severity === 'high' ? 'text-orange-400' :
                        alert.severity === 'medium' ? 'text-yellow-400' :
                        'text-blue-400'
                      } />
                      {alert.alert_type}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-foreground/10 text-foreground/60">{alert.title}</span>
                    </div>
                    <div className="text-[10px] text-foreground/60 mt-1">{alert.message}</div>
                    <div className="text-[10px] text-foreground/40 mt-0.5">{new Date(alert.created_at).toLocaleString('de-DE')}</div>
                  </div>
                  <button onClick={() => acknowledgeAlert(alert.id)}
                    className="ml-2 px-2 py-1 bg-foreground/10 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/20 transition-colors shrink-0">
                    Bestätigen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Resource Usage */}
      <AdminCard title="Ressourcennutzung" icon={Cpu}>
        {resourceUsage.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Ressourcendaten.</p>
        ) : (
          <div className="space-y-2">
            {resourceUsage.map((usage, i) => (
              <div key={i} className="p-3 rounded-lg bg-foreground/3">
                <div className="text-xs font-semibold text-foreground mb-2">{usage.provider_id}</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="p-1.5 rounded bg-foreground/5">
                    <span className="text-foreground/40">CPU:</span> <span className="font-semibold text-foreground/70">{usage.cpu_percent.toFixed(1)}%</span>
                  </div>
                  <div className="p-1.5 rounded bg-foreground/5">
                    <span className="text-foreground/40">RAM:</span> <span className="font-semibold text-foreground/70">{usage.memory_mb.toFixed(0)} MB</span>
                  </div>
                  <div className="p-1.5 rounded bg-foreground/5">
                    <span className="text-foreground/40">↓ Netzwerk:</span> <span className="font-semibold text-foreground/70">{(usage.network_rx_bytes / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <div className="p-1.5 rounded bg-foreground/5">
                    <span className="text-foreground/40">↑ Netzwerk:</span> <span className="font-semibold text-foreground/70">{(usage.network_tx_bytes / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Recent Events */}
      <AdminCard title={`Sicherheitsereignisse (${events.length})`} icon={Clock}>
        {events.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Ereignisse.</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {events.slice(0, 50).map((event, i) => (
              <div key={i} className="p-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        event.severity === 'critical' ? 'bg-red-500/15 text-red-400' :
                        event.severity === 'error' ? 'bg-orange-500/15 text-orange-400' :
                        event.severity === 'warning' ? 'bg-yellow-500/15 text-yellow-400' :
                        'bg-blue-500/15 text-blue-400'
                      }`}>{event.severity}</span>
                      {event.event_type}
                    </div>
                    <div className="text-[10px] text-foreground/60 mt-0.5">{event.message}</div>
                    <div className="text-[10px] text-foreground/40 mt-0.5">{event.provider_id} • {new Date(event.timestamp).toLocaleString('de-DE')}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Phase 2: Update Management ──────────────────────────────────────────

interface UpdateInfo {
  provider_id: string
  provider_type: 'app' | 'plugin'
  current_version: string
  latest_version: string
  channel: 'stable' | 'beta' | 'alpha' | 'dev'
  update_available: boolean
  is_critical: boolean
  release_notes?: string
  download_url?: string
  last_checked: string
}

interface UpdateHistory {
  id: string
  provider_id: string
  from_version: string
  to_version: string
  status: 'success' | 'failed' | 'rolled_back'
  installed_at: string
  error_message?: string
}

export function UpdateManagementTab({ token }: { token: string }) {
  const [updates, setUpdates] = useState<UpdateInfo[]>([])
  const [history, setHistory] = useState<UpdateHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [updatesData, historyData] = await Promise.all([
        adminFetch('/api/core/updates/check', token) as Promise<{ updates: UpdateInfo[] }>,
        adminFetch('/api/core/updates/history', token) as Promise<{ history: UpdateHistory[] }>,
      ])
      setUpdates(updatesData.updates || [])
      setHistory(historyData.history || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const installUpdate = async (providerId: string) => {
    setInstalling(providerId)
    try {
      await adminFetch(`/api/core/updates/${providerId}/install`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
    setInstalling(null)
  }

  const rollbackUpdate = async (updateId: string) => {
    if (!(await confirmDialog({ title: 'Update zurückrollen', message: 'Update wirklich zurückrollen?', confirmLabel: 'Zurückrollen', danger: true }))) return
    try {
      await adminFetch(`/api/core/updates/${updateId}/rollback`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
  }

  const checkForUpdates = async () => {
    setRefreshing(true)
    try {
      await adminFetch('/api/core/updates/check', token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
    setRefreshing(false)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const availableUpdates = updates.filter(u => u.update_available).length
  const criticalUpdates = updates.filter(u => u.update_available && u.is_critical).length

  return (
    <div className="space-y-3">
      {/* Overview */}
      <AdminCard title="Update-Übersicht" icon={Package}>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-accent/10 text-center">
            <div className="text-[10px] text-accent/70 mb-1">Verfügbar</div>
            <div className="text-2xl font-bold text-accent">{availableUpdates}</div>
          </div>
          <div className="p-3 rounded-lg bg-red-500/10 text-center">
            <div className="text-[10px] text-red-400/70 mb-1">Kritisch</div>
            <div className="text-2xl font-bold text-red-400">{criticalUpdates}</div>
          </div>
          <div className="p-3 rounded-lg bg-foreground/5 text-center">
            <div className="text-[10px] text-foreground/40 mb-1">Aktuell</div>
            <div className="text-2xl font-bold text-green-400">{updates.filter(u => !u.update_available).length}</div>
          </div>
        </div>
        <div className="mt-3">
          <button onClick={checkForUpdates} disabled={refreshing}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40">
            {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Nach Updates suchen
          </button>
        </div>
      </AdminCard>

      {/* Available Updates */}
      {availableUpdates > 0 && (
        <AdminCard title={`Verfügbare Updates (${availableUpdates})`} icon={ArrowUp}>
          <div className="space-y-2">
            {updates.filter(u => u.update_available).map((update, i) => (
              <div key={i} className={`p-3 rounded-lg border ${
                update.is_critical ? 'bg-red-500/10 border-red-500/30' : 'bg-foreground/3 border-foreground/10'
              }`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      {update.provider_id}
                      {update.is_critical && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-red-500/15 text-red-400">KRITISCH</span>}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-accent/15 text-accent">{update.channel}</span>
                    </div>
                    <div className="text-[10px] text-foreground/60 mt-1">
                      <span className="font-mono">{update.current_version}</span> → <span className="font-mono font-semibold text-accent">{update.latest_version}</span>
                    </div>
                    {update.release_notes && (
                      <div className="text-[10px] text-foreground/60 mt-2 p-2 rounded bg-foreground/5">
                        {update.release_notes}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => installUpdate(update.provider_id)} disabled={installing === update.provider_id}
                    className="flex items-center gap-1 px-2 py-1 bg-accent text-white rounded text-[10px] font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40">
                    {installing === update.provider_id ? <InlineSpinner size={12} /> : <ArrowUp size={12} />} Installieren
                  </button>
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Update History */}
      <AdminCard title={`Update-Verlauf (${history.length})`} icon={Clock}>
        {history.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Kein Update-Verlauf.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {history.map((item, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-foreground/3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      {item.provider_id}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        item.status === 'success' ? 'bg-green-500/15 text-green-400' :
                        item.status === 'failed' ? 'bg-red-500/15 text-red-400' :
                        'bg-yellow-500/15 text-yellow-400'
                      }`}>{item.status}</span>
                    </div>
                    <div className="text-[10px] text-foreground/60 mt-1">
                      <span className="font-mono">{item.from_version}</span> → <span className="font-mono">{item.to_version}</span>
                    </div>
                    <div className="text-[10px] text-foreground/40 mt-0.5">{new Date(item.installed_at).toLocaleString('de-DE')}</div>
                    {item.error_message && (
                      <div className="text-[10px] text-red-400 mt-1">{item.error_message}</div>
                    )}
                  </div>
                  {item.status === 'success' && (
                    <button onClick={() => rollbackUpdate(item.id)}
                      className="ml-2 px-2 py-1 bg-orange-500/15 text-orange-400 rounded text-[10px] font-semibold hover:bg-orange-500/25 transition-colors shrink-0">
                      <ArrowDown size={12} className="inline mr-1" /> Rollback
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  )
}

// ── Phase 2: Widget Management ──────────────────────────────────────────

interface ManagedWidget {
  id: string
  provider_id: string
  provider_type: 'app' | 'plugin'
  name: string
  description: string
  widget_type: string
  component_url: string
  is_available: boolean
  permissions: string[]
  registered_at: string
  instances_count: number
}

export function WidgetManagementTab({ token }: { token: string }) {
  const [widgets, setWidgets] = useState<ManagedWidget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/core/widgets', token) as { widgets: ManagedWidget[] }
      setWidgets(data.widgets || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const availableWidgets = widgets.filter(w => w.is_available).length

  return (
    <div className="space-y-3">
      {/* Overview */}
      <AdminCard title="Widget-Übersicht" icon={Package}>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-green-500/10 text-center">
            <div className="text-[10px] text-green-400/70 mb-1">Verfügbar</div>
            <div className="text-2xl font-bold text-green-400">{availableWidgets}</div>
          </div>
          <div className="p-3 rounded-lg bg-red-500/10 text-center">
            <div className="text-[10px] text-red-400/70 mb-1">Nicht verfügbar</div>
            <div className="text-2xl font-bold text-red-400">{widgets.length - availableWidgets}</div>
          </div>
          <div className="p-3 rounded-lg bg-foreground/5 text-center">
            <div className="text-[10px] text-foreground/40 mb-1">Gesamt</div>
            <div className="text-2xl font-bold text-foreground">{widgets.length}</div>
          </div>
        </div>
      </AdminCard>

      {/* Widgets List */}
      <AdminCard title={`Registrierte Widgets (${widgets.length})`} icon={Cube}>
        {widgets.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Widgets registriert.</p>
        ) : (
          <div className="space-y-2">
            {widgets.map((widget, i) => (
              <div key={i} className="p-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      {widget.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        widget.is_available ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                      }`}>{widget.is_available ? 'verfügbar' : 'nicht verfügbar'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-accent/15 text-accent">{widget.widget_type}</span>
                    </div>
                    <div className="text-[10px] text-foreground/40">{widget.description}</div>
                    <div className="text-[10px] text-foreground/40 mt-0.5">Provider: {widget.provider_id} ({widget.provider_type})</div>
                  </div>
                </div>

                {/* Metadata */}
                <div className="mt-2 pt-2 border-t border-foreground/5">
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="p-1.5 rounded bg-foreground/5">
                      <span className="text-foreground/40">Instanzen:</span> <span className="font-semibold text-foreground/70">{widget.instances_count}</span>
                    </div>
                    <div className="p-1.5 rounded bg-foreground/5">
                      <span className="text-foreground/40">Registriert:</span> <span className="font-semibold text-foreground/70">{new Date(widget.registered_at).toLocaleDateString('de-DE')}</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-foreground/40 font-mono mt-2 truncate">
                    URL: {widget.component_url}
                  </div>
                </div>

                {/* Permissions */}
                {widget.permissions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-foreground/5">
                    <div className="text-[10px] text-foreground/40 mb-1">Berechtigungen:</div>
                    <div className="flex flex-wrap gap-1">
                      {widget.permissions.map((perm, j) => (
                        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60">{perm}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 bg-foreground/5 text-foreground/60 rounded-lg text-xs font-semibold hover:bg-foreground/8 transition-colors border border-foreground/10 disabled:opacity-40">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}
