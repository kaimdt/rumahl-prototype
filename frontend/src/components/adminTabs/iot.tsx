import { useCallback, useEffect, useState } from 'react'
import { AppleLogo, ArrowClockwise, Bluetooth, CloudArrowUp, Gear, Globe, HardDrive, LinkSimple, ListBullets, Play, Plus, Power, Trash, Tree, WifiHigh } from '@phosphor-icons/react'
import { AdminCard, ConfigModal, ErrorMessage, InlineSpinner, LoadingSpinner, StatItem, adminFetch, cachedFetch, ccInput } from '../AdminPanel'
export function MqttTab({ token }: { token: string }) {
  const [haData, setHaData] = useState<Record<string, unknown> | null>(null)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [subTopic, setSubTopic] = useState('')
  const [pubTopic, setPubTopic] = useState('')
  const [pubPayload, setPubPayload] = useState('')
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([])
  const [configured, setConfigured] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Form fields
  const [host, setHost] = useState('')
  const [port, setPort] = useState('1883')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/mqtt/status', token) as Record<string, unknown>
      setStatus(s)
    } catch {}
  }, [token])

  const refreshMessages = useCallback(async () => {
    try {
      const m = await adminFetch('/api/admin/mqtt/messages', token) as Record<string, unknown>
      setMessages((m.recent_messages ?? []) as Array<Record<string, unknown>>)
    } catch {}
  }, [token])

  useEffect(() => {
    cachedFetch('/api/admin/ha/mqtt', token)
      .then(d => setHaData(d as Record<string, unknown>))
      .catch(() => {})
    adminFetch('/api/admin/mqtt/status', token)
      .then(d => setStatus(d as Record<string, unknown>))
      .catch(() => {})
    adminFetch('/api/admin/mqtt/config', token)
      .then(d => {
        const c = d as Record<string, unknown>
        if (c.host) { setHost(c.host as string); setConfigured(true) }
        if (c.port) setPort(String(c.port))
        if (c.username) setUsername(c.username as string)
        if (c.use_tls) setUseTls(c.use_tls as boolean)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    const iv = setInterval(() => { refreshStatus(); refreshMessages() }, 5000)
    return () => clearInterval(iv)
  }, [refreshStatus, refreshMessages])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await adminFetch('/api/admin/mqtt/connect', token, {
        method: 'POST',
        body: JSON.stringify({ host, port: parseInt(port), username: username || undefined, password: password || undefined, use_tls: useTls }),
      }) as Record<string, unknown>
      if (res.success) {
        setConfigured(true)
        setShowConfig(false)
      } else {
        setError(res.error as string || 'Verbindung fehlgeschlagen')
      }
      setTimeout(refreshStatus, 1500)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    setActionLoading('disconnect')
    try {
      await adminFetch('/api/admin/mqtt/disconnect', token, { method: 'POST' })
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handleSubscribe = async () => {
    if (!subTopic.trim()) return
    setActionLoading('subscribe')
    try {
      await adminFetch('/api/admin/mqtt/subscribe', token, {
        method: 'POST',
        body: JSON.stringify({ topic: subTopic }),
      })
      setSubTopic('')
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handleUnsubscribe = async (topic: string) => {
    setActionLoading(`unsub-${topic}`)
    try {
      await adminFetch('/api/admin/mqtt/unsubscribe', token, {
        method: 'POST',
        body: JSON.stringify({ topic }),
      })
      refreshStatus()
    } finally { setActionLoading(null) }
  }

  const handlePublish = async () => {
    if (!pubTopic.trim()) return
    setActionLoading('publish')
    try {
      await adminFetch('/api/admin/mqtt/publish', token, {
        method: 'POST',
        body: JSON.stringify({ topic: pubTopic, payload: pubPayload }),
      })
      setPubPayload('')
    } finally { setActionLoading(null) }
  }

  if (loading) return <LoadingSpinner />
  if (error && !status) return <ErrorMessage>{error}</ErrorMessage>

  const isConnected = (status as Record<string, unknown>)?.connected === true
  const statusError = status && typeof (status as Record<string, unknown>).error !== 'undefined'
    ? (String((status as Record<string, unknown>).error) || null)
    : null

  // Show inline setup if not configured
  if (!configured && !isConnected) {
    return (
      <div className="space-y-3">
        <AdminCard title="MQTT einrichten" icon={WifiHigh}>
          <p className="text-xs text-foreground/60 mb-3">Verbinde dich mit einem bestehenden MQTT-Broker um Nachrichten zu senden und empfangen.</p>
          <MqttConfigForm host={host} setHost={setHost} port={port} setPort={setPort} username={username} setUsername={setUsername} password={password} setPassword={setPassword} useTls={useTls} setUseTls={setUseTls} onConnect={handleConnect} connecting={connecting} error={error} />
        </AdminCard>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Connection Status */}
      <AdminCard title="MQTT Verbindung" icon={WifiHigh}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs font-medium text-foreground/85">{isConnected ? 'Verbunden' : 'Nicht verbunden'}</span>
            {statusError && <span className="text-[10px] text-red-400 truncate ml-2">{statusError}</span>}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            {isConnected ? (
              <button onClick={handleDisconnect} disabled={actionLoading === 'disconnect'}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition disabled:opacity-40">
                {actionLoading === 'disconnect' ? <InlineSpinner size={12} /> : <Power size={12} />} Trennen
              </button>
            ) : (
              <button onClick={handleConnect} disabled={connecting || !host} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
                <Play size={12} weight="fill" /> {connecting ? 'Verbinde...' : 'Verbinden'}
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Broker" value={host ? `${host}:${port}` : '–'} />
          <StatItem label="TLS" value={useTls ? 'Ja' : 'Nein'} />
          <StatItem label="Nachrichten" value={String(status?.message_count ?? 0)} />
          <StatItem label="Subscriptions" value={String((status?.subscribed_topics as string[] ?? []).length)} />
        </div>
      </AdminCard>

      {/* Subscribe & Topics */}
      {isConnected && (
        <AdminCard title="Topics & Subscriptions" icon={ListBullets}>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={subTopic} onChange={e => setSubTopic(e.target.value)} placeholder="Topic (z.B. home/#)" className={`flex-1 ${ccInput('text-xs px-3 py-2')}`} onKeyDown={e => e.key === 'Enter' && handleSubscribe()} />
              <button onClick={handleSubscribe} disabled={actionLoading === 'subscribe'}
                className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
                {actionLoading === 'subscribe' ? <InlineSpinner size={12} /> : <Plus size={12} />}
              </button>
            </div>
            {((status as Record<string, unknown>)?.subscribed_topics as string[] ?? []).length > 0 && (
              <div className="space-y-1">
                {((status as Record<string, unknown>)?.subscribed_topics as string[]).map(t => (
                  <div key={t} className="flex justify-between items-center text-xs py-1 px-2 rounded bg-foreground/5">
                    <span className="font-mono text-foreground/85">{t}</span>
                    <button onClick={() => handleUnsubscribe(t)} disabled={actionLoading === `unsub-${t}`}
                      className="text-red-400 hover:text-red-300 disabled:opacity-40">
                      {actionLoading === `unsub-${t}` ? <InlineSpinner size={12} /> : <Trash size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </AdminCard>
      )}

      {/* Publish */}
      {isConnected && (
        <AdminCard title="Nachricht senden" icon={CloudArrowUp}>
          <div className="space-y-2">
            <input value={pubTopic} onChange={e => setPubTopic(e.target.value)} placeholder="Topic" className={`w-full ${ccInput('text-xs px-3 py-2')}`} />
            <input value={pubPayload} onChange={e => setPubPayload(e.target.value)} placeholder="Payload (JSON oder Text)" className={`w-full ${ccInput('text-xs px-3 py-2')}`} onKeyDown={e => e.key === 'Enter' && handlePublish()} />
            <button onClick={handlePublish} disabled={!pubTopic.trim() || actionLoading === 'publish'}
              className="px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40 flex items-center gap-1.5">
              {actionLoading === 'publish' && <InlineSpinner size={12} />}
              Senden
            </button>
          </div>
        </AdminCard>
      )}

      {/* Recent Messages */}
      {isConnected && messages.length > 0 && (
        <AdminCard title={`Letzte Nachrichten (${messages.length})`} icon={ListBullets}>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {[...messages].reverse().slice(0, 30).map((m, i) => (
              <div key={i} className="text-[10px] py-1 px-2 rounded bg-foreground/5 border-b border-foreground/5 last:border-0">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-accent/90 truncate">{m.topic as string}</span>
                  <span className="text-foreground/40 ml-2 whitespace-nowrap">{(m.received_at as string)?.split('T')[1]?.slice(0,8)}</span>
                </div>
                <div className="text-foreground/70 font-mono truncate mt-0.5">{m.payload as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* HA MQTT Entities */}
      <AdminCard title={`HA MQTT Entities (${haData?.mqtt_entity_count ?? 0})`} icon={WifiHigh}>
        {(haData?.mqtt_entities as Array<Record<string, unknown>> ?? []).length === 0 ? (
          <div className="text-xs text-foreground/50 text-center py-4">Keine MQTT-Entities in Home Assistant.</div>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {(haData?.mqtt_entities as Array<Record<string, unknown>>).map((e, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85 truncate mr-2">{(e.friendly_name as string) ?? e.entity_id}</span>
                <span className="text-foreground/80 font-mono text-[10px]">{e.state as string}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="MQTT Konfiguration" icon={WifiHigh}>
        <p className="text-xs text-foreground/60 mb-3">Verbindungsdaten zum MQTT-Broker. Werden automatisch gespeichert und beim Neustart wiederhergestellt.</p>
        <MqttConfigForm host={host} setHost={setHost} port={port} setPort={setPort} username={username} setUsername={setUsername} password={password} setPassword={setPassword} useTls={useTls} setUseTls={setUseTls} onConnect={handleConnect} connecting={connecting} error={error} />
      </ConfigModal>
    </div>
  )
}


export function MqttConfigForm({ host, setHost, port, setPort, username, setUsername, password, setPassword, useTls, setUseTls, onConnect, connecting, error }: {
  host: string; setHost: (v: string) => void
  port: string; setPort: (v: string) => void
  username: string; setUsername: (v: string) => void
  password: string; setPassword: (v: string) => void
  useTls: boolean; setUseTls: (v: boolean) => void
  onConnect: () => void; connecting: boolean; error: string
}) {
  return (
    <div className="space-y-2">
      {error && <div className="text-[10px] text-red-400 bg-red-500/10 rounded px-2 py-1">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <input value={host} onChange={e => setHost(e.target.value)} placeholder="Host (z.B. 192.168.1.10)" className={`col-span-2 ${ccInput('text-xs px-3 py-2')}`} />
        <input value={port} onChange={e => setPort(e.target.value)} placeholder="Port" type="number" className={`${ccInput('text-xs px-3 py-2')}`} />
        <label className="flex items-center gap-2 text-xs text-foreground/85 px-2">
          <input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} className="rounded accent-[var(--accent)]" />
          TLS
        </label>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Benutzername (optional)" className={ccInput('text-xs px-3 py-2')} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Passwort (optional)" type="password" className={ccInput('text-xs px-3 py-2')} />
      </div>
      <button onClick={onConnect} disabled={connecting || !host} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition disabled:opacity-40">
        <Play size={12} weight="fill" /> {connecting ? 'Verbinde...' : 'Verbinden & Speichern'}
      </button>
    </div>
  )
}

// ── Matter Tab ────────────────────────────────────────────────


export function MatterTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ enabled: false, commission_port: 5540, discriminator: 3840, passcode: 20202021 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/matter/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({
          enabled: c.enabled as boolean ?? false,
          commission_port: c.commission_port as number ?? 5540,
          discriminator: c.discriminator as number ?? 3840,
          passcode: c.passcode as number ?? 20202021,
        })
      }
    } catch { /* endpoint optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSaveConfig = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/matter/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const fabrics = (status?.fabrics ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      {/* Status Overview */}
      <AdminCard title="Matter Status" icon={HardDrive}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/matter/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_matter_entities ?? 0)} />
          <StatItem label="Commission Port" value={String(config.commission_port)} />
          <StatItem label="Fabrics" value={String(fabrics.length)} />
        </div>
      </AdminCard>

      {/* Matter Devices */}
      {devices.length > 0 && (
        <AdminCard title={`Matter Geräte (${devices.length})`} icon={HardDrive}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.name as string}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.reachable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {d.reachable ? 'Erreichbar' : 'Offline'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  {typeof d.vendor === 'string' && <span>Hersteller: <span className="text-foreground/80">{d.vendor}</span></span>}
                  {typeof d.model === 'string' && <span>Modell: <span className="text-foreground/80">{d.model}</span></span>}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Fabrics */}
      {fabrics.length > 0 && (
        <AdminCard title={`Matter Fabrics (${fabrics.length})`} icon={Globe}>
          <div className="space-y-1.5">
            {fabrics.map((f, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85">{f.label as string}</span>
                <span className="text-foreground/60 text-[10px]">{String(f.node_count)} Nodes</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Matter Konfiguration" icon={HardDrive}>
        <p className="text-xs text-foreground/60 mb-3">Matter Bridge Einstellungen. Verbindet sich mit der bestehenden Matter-Integration in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Matter Bridge aktiviert
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Commission Port</label>
              <input value={config.commission_port} onChange={e => setConfig(c => ({ ...c, commission_port: parseInt(e.target.value) || 5540 }))} type="number" className="rumahl-field-sm w-full text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Discriminator</label>
              <input value={config.discriminator} onChange={e => setConfig(c => ({ ...c, discriminator: parseInt(e.target.value) || 3840 }))} type="number" className="rumahl-field-sm w-full text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Passcode</label>
              <input value={config.passcode} onChange={e => setConfig(c => ({ ...c, passcode: parseInt(e.target.value) || 20202021 }))} type="number" className="rumahl-field-sm w-full text-xs" />
            </div>
          </div>
          <button onClick={handleSaveConfig} disabled={saving} className="rumahl-ghost-button-sm w-full">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── HA Connection Tab ──────────────────────────────────────────


export function ZigbeeTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ mode: 'auto', enabled: true, z2m_topic: 'zigbee2mqtt' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/zigbee/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({
          mode: (c.mode as string) ?? 'auto',
          enabled: (c.enabled as boolean) ?? true,
          z2m_topic: (c.z2m_topic as string) ?? 'zigbee2mqtt',
        })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/zigbee/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const network = status?.network as Record<string, unknown> | null

  return (
    <div className="space-y-3">
      {/* Status */}
      <AdminCard title="Zigbee Status" icon={Tree}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{status?.mode as string ?? 'Auto'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/zigbee/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="Modus" value={status?.detected_mode as string ?? '–'} />
          {network && <>
            <StatItem label="Kanal" value={String(network.channel ?? '–')} />
            <StatItem label="Beitritt" value={(network.permit_join as boolean) ? 'Ja' : 'Nein'} />
          </>}
        </div>
      </AdminCard>

      {/* Devices */}
      {devices.length > 0 && (
        <AdminCard title={`Zigbee Geräte (${devices.length})`} icon={Tree}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.friendly_name as string}</span>
                  {typeof d.lqi === 'number' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.lqi > 100 ? 'bg-green-500/20 text-green-400' : d.lqi > 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      LQI: {d.lqi}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  <span>Strom: <span className="text-foreground/80">{d.power_source as string}</span></span>
                  {typeof d.battery === 'number' && <span>Batterie: <span className="text-foreground/80">{d.battery}%</span></span>}
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{d.ieee_address as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Zigbee Konfiguration" icon={Tree}>
        <p className="text-xs text-foreground/60 mb-3">Verbindet sich mit der bestehenden Zigbee-Integration (Zigbee2MQTT oder ZHA) in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Zigbee aktiviert
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Modus</label>
              <select value={config.mode} onChange={e => setConfig(c => ({ ...c, mode: e.target.value }))} className="rumahl-field-sm w-full text-xs">
                <option value="auto">Auto-Erkennung</option>
                <option value="zigbee2mqtt">Zigbee2MQTT</option>
                <option value="zha">ZHA</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Z2M Topic</label>
              <input value={config.z2m_topic} onChange={e => setConfig(c => ({ ...c, z2m_topic: e.target.value }))} className="rumahl-field-sm w-full text-xs" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="rumahl-ghost-button-sm w-full">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Z-Wave Tab ────────────────────────────────────────────────


export function ZwaveTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ enabled: true, zwave_js_url: '' })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/zwave/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({ enabled: (c.enabled as boolean) ?? true, zwave_js_url: (c.zwave_js_url as string) ?? '' })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/zwave/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const nodes = (status?.nodes ?? []) as Array<Record<string, unknown>>
  const network = status?.network as Record<string, unknown> | null

  return (
    <div className="space-y-3">
      <AdminCard title="Z-Wave Status" icon={LinkSimple}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{nodes.length > 0 ? 'Aktiv' : 'Keine Nodes'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/zwave/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Nodes" value={String(status?.node_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_zwave_entities ?? 0)} />
          {network && <>
            <StatItem label="Home ID" value={network.home_id as string ?? '–'} />
            <StatItem label="Controller" value={network.controller as string ?? '–'} />
          </>}
        </div>
      </AdminCard>

      {nodes.length > 0 && (
        <AdminCard title={`Z-Wave Nodes (${nodes.length})`} icon={LinkSimple}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {nodes.map((n, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{n.name as string}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${n.status === 'alive' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {n.status as string}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-2 text-[10px] text-foreground/60">
                  <span>Node: <span className="text-foreground/80">{String(n.node_id)}</span></span>
                  <span>Typ: <span className="text-foreground/80">{String(n.device_type)}</span></span>
                  {typeof n.product === 'string' && <span>Produkt: <span className="text-foreground/80">{n.product}</span></span>}
                </div>
                <div className="flex gap-2 mt-0.5">
                  {n.is_secure === true && <span className="text-[9px] px-1 rounded bg-blue-500/10 text-blue-400">Sicher</span>}
                  {n.is_routing === true && <span className="text-[9px] px-1 rounded bg-purple-500/10 text-purple-400">Routing</span>}
                  {n.is_beaming === true && <span className="text-[9px] px-1 rounded bg-cyan-500/10 text-cyan-400">Beaming</span>}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Z-Wave Konfiguration" icon={LinkSimple}>
        <p className="text-xs text-foreground/60 mb-3">Verbindet sich mit der bestehenden Z-Wave JS Integration in Home Assistant.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Z-Wave aktiviert
          </label>
          <div>
            <label className="text-[10px] text-foreground/50 block mb-0.5">Z-Wave JS WebSocket URL (optional)</label>
            <input value={config.zwave_js_url} onChange={e => setConfig(c => ({ ...c, zwave_js_url: e.target.value }))} placeholder="ws://rumahl.local:3000" className="rumahl-field-sm w-full text-xs" />
          </div>
          <button onClick={handleSave} disabled={saving} className="rumahl-ghost-button-sm w-full">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Bluetooth Tab ─────────────────────────────────────────────


export function BleTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [config, setConfig] = useState({ enabled: true })
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/ble/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        setConfig({ enabled: (c.enabled as boolean) ?? true })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/ble/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const devices = (status?.devices ?? []) as Array<Record<string, unknown>>
  const adapters = (status?.adapters ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="Bluetooth Status" icon={Bluetooth}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/ble/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Geräte" value={String(status?.device_count ?? 0)} />
          <StatItem label="Adapter" value={String(adapters.length)} />
          <StatItem label="HA Entities" value={String(status?.ha_ble_entities ?? 0)} />
        </div>
      </AdminCard>

      {adapters.length > 0 && (
        <AdminCard title="Bluetooth Adapter" icon={Bluetooth}>
          <div className="space-y-1.5">
            {adapters.map((a, i) => (
              <div key={i} className="flex justify-between items-center text-xs py-1 border-b border-foreground/5 last:border-0">
                <span className="text-foreground/85">{a.name as string}</span>
                <span className="text-foreground/50 text-[10px]">{a.address as string}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {devices.length > 0 && (
        <AdminCard title={`BLE Geräte (${devices.length})`} icon={Bluetooth}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {devices.map((d, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{d.name as string}</span>
                  {typeof d.rssi === 'number' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.rssi > -60 ? 'bg-green-500/20 text-green-400' : d.rssi > -80 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                      {d.rssi} dBm
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-foreground/60">
                  <span>Typ: <span className="text-foreground/80">{d.device_type as string}</span></span>
                  {typeof d.battery === 'number' && <span>Batterie: <span className="text-foreground/80">{d.battery}%</span></span>}
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{d.address as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="Bluetooth Konfiguration" icon={Bluetooth}>
        <p className="text-xs text-foreground/60 mb-3">Nutzt die bestehende Bluetooth-Integration in Home Assistant zur Geräte-Erkennung.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            Bluetooth aktiviert
          </label>
          <button onClick={handleSave} disabled={saving} className="rumahl-ghost-button-sm w-full">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── HomeKit Tab ───────────────────────────────────────────────


export function HomekitTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [config, setConfig] = useState({ enabled: false, bridge_name: 'rumahl Dashboard Bridge', bridge_port: 21063 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showConfig, setShowConfig] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/homekit/status', token) as Record<string, unknown>
      setStatus(s)
      if (s.config) {
        const c = s.config as Record<string, unknown>
        const bridge_port = typeof c.bridge_port === 'number'
          ? c.bridge_port
          : typeof c.port === 'number'
            ? c.port
            : 21063
        setConfig({
          enabled: typeof c.enabled === 'boolean' ? c.enabled : false,
          bridge_name: typeof c.bridge_name === 'string' ? c.bridge_name : 'rumahl Dashboard Bridge',
          bridge_port,
        })
      }
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch('/api/admin/homekit/config', token, { method: 'POST', body: JSON.stringify(config) })
      setShowConfig(false)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const accessories = (status?.accessories ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="HomeKit Status" icon={AppleLogo}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-green-400' : 'bg-foreground/30'}`} />
            <span className="text-xs font-medium text-foreground/85">{config.enabled ? 'Aktiviert' : 'Deaktiviert'}</span>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowConfig(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <Gear size={12} /> Konfigurieren
            </button>
            <button onClick={async () => { await adminFetch('/api/admin/homekit/refresh', token, { method: 'POST' }); refresh() }} className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
              <ArrowClockwise size={12} /> Aktualisieren
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          <StatItem label="Bridge" value={status?.bridge_available ? 'Erreichbar' : 'Nicht erreichbar'} />
          <StatItem label="Zubehör" value={String(status?.accessory_count ?? 0)} />
          <StatItem label="HA Entities" value={String(status?.ha_homekit_entities ?? 0)} />
          <StatItem label="Port" value={String(config.bridge_port)} />
        </div>
      </AdminCard>

      {accessories.length > 0 && (
        <AdminCard title={`HomeKit Zubehör (${accessories.length})`} icon={AppleLogo}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {accessories.map((a, i) => (
              <div key={i} className="rounded-lg bg-foreground/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground/90">{a.name as string}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground/70">{a.accessory_type as string}</span>
                </div>
                <div className="text-[10px] text-foreground/60">
                  <span>Status: <span className="text-foreground/80">{a.state as string}</span></span>
                </div>
                <div className="text-[9px] text-foreground/40 font-mono truncate">{a.entity_id as string}</div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Config Modal */}
      <ConfigModal open={showConfig} onClose={() => setShowConfig(false)} title="HomeKit Konfiguration" icon={AppleLogo}>
        <p className="text-xs text-foreground/60 mb-3">Nutzt die bestehende HomeKit-Integration in Home Assistant. Bridge-Einstellungen für die Zubehör-Zuordnung.</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-foreground/85">
            <input type="checkbox" checked={config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} className="rounded accent-[var(--accent)]" />
            HomeKit Bridge aktiviert
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Bridge Name</label>
              <input value={config.bridge_name} onChange={e => setConfig(c => ({ ...c, bridge_name: e.target.value }))} className="rumahl-field-sm w-full text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-foreground/50 block mb-0.5">Port</label>
              <input value={config.bridge_port} onChange={e => setConfig(c => ({ ...c, bridge_port: parseInt(e.target.value) || 21063 }))} type="number" className="rumahl-field-sm w-full text-xs" />
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className="rumahl-ghost-button-sm w-full">
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </ConfigModal>
    </div>
  )
}

// ── Automations Tab ────────────────────────────────────────────
