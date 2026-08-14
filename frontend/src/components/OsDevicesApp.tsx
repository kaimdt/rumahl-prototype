import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowClockwise,
  Cpu,
  Desktop,
  DeviceMobile,
  HardDrives,
  Lightning,
  Monitor,
  PencilSimple,
  Plus,
  Printer,
  Pulse,
  Television,
  Trash,
  WifiHigh,
  WifiSlash,
  X,
} from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { OsAppNavbar } from '@/components/OsAppNavbar'
import { toast } from 'sonner'

interface NetworkDevice {
  id: string
  ip_address: string
  mac_address?: string | null
  hostname?: string | null
  vendor?: string | null
  device_type?: string | null
  first_seen: string
  last_seen: string
  is_active: boolean
}

interface RegistryDevice {
  id: string
  name: string
  device_type: string
  mac_address?: string | null
  ip_address?: string | null
  wake_enabled: boolean
  notes: string
  created_by: string
  created_at: string
  agent_type?: string | null
  agent_config?: Record<string, unknown>
}

interface ProbeResult {
  reachable: boolean
  latency_ms?: number
  detail?: string
}

const DEVICE_TYPES = ['computer', 'nas', 'tv', 'printer', 'phone', 'tablet', 'other'] as const

function deviceIcon(type: string, size = 22) {
  switch (type) {
    case 'nas': return <HardDrives size={size} weight="duotone" />
    case 'tv': return <Television size={size} weight="duotone" />
    case 'printer': return <Printer size={size} weight="duotone" />
    case 'phone': return <DeviceMobile size={size} weight="duotone" />
    case 'tablet': return <DeviceMobile size={size} weight="duotone" />
    case 'computer': return <Desktop size={size} weight="duotone" />
    default: return <Monitor size={size} weight="duotone" />
  }
}

export function OsDevicesApp() {
  const { t } = useTranslation()
  const [network, setNetwork] = useState<NetworkDevice[]>([])
  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [waking, setWaking] = useState<string | null>(null)
  const [editing, setEditing] = useState<RegistryDevice | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', device_type: 'computer', mac_address: '', ip_address: '', wake_enabled: true, notes: '', agent_type: '', agent_host: '', agent_port: '22', agent_url: '' })
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})
  const [probing, setProbing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [networkResponse, registryResponse] = await Promise.all([
        authFetch('/api/network/devices'),
        authFetch('/api/devices'),
      ])
      if (!networkResponse.ok || !registryResponse.ok) {
        throw new Error(`HTTP ${networkResponse.status}/${registryResponse.status}`)
      }
      const networkData = await networkResponse.json() as NetworkDevice[]
      const registryData = await registryResponse.json() as { devices?: RegistryDevice[] }
      setNetwork(Array.isArray(networkData) ? networkData : [])
      setRegistry(registryData.devices || [])
    } catch {
      setError(t('devicesApp.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  const wakeDevice = async (device: RegistryDevice) => {
    setWaking(device.id)
    try {
      const response = await authFetch(`/api/devices/${device.id}/wake`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${response.status}`)
      }
      toast.success(t('devicesApp.wakeSent', { name: device.name }))
    } catch (wakeError) {
      toast.error(wakeError instanceof Error ? wakeError.message : t('devicesApp.wakeFailed'))
    } finally {
      setWaking(null)
    }
  }

  const saveDevice = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return
    const body = {
      name: form.name.trim(),
      device_type: form.device_type,
      mac_address: form.mac_address.trim() || null,
      ip_address: form.ip_address.trim() || null,
      wake_enabled: form.wake_enabled,
      notes: form.notes.trim(),
      agent_type: form.agent_type || null,
      agent_config: form.agent_type === 'tcp'
        ? { host: form.agent_host.trim(), port: Number(form.agent_port) || 22 }
        : form.agent_type === 'http'
          ? { url: form.agent_url.trim() }
          : {},
    }
    try {
      const response = editing
        ? await authFetch(`/api/devices/${editing.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await authFetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${response.status}`)
      }
      toast.success(t('devicesApp.saved'))
      setShowForm(false)
      setEditing(null)
      setForm({ name: '', device_type: 'computer', mac_address: '', ip_address: '', wake_enabled: true, notes: '', agent_type: '', agent_host: '', agent_port: '22', agent_url: '' })
      await load()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : t('devicesApp.saveFailed'))
    }
  }

  const removeDevice = async (device: RegistryDevice) => {
    try {
      const response = await authFetch(`/api/devices/${device.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      toast.success(t('devicesApp.removed'))
      await load()
    } catch {
      toast.error(t('devicesApp.removeFailed'))
    }
  }

  const openEdit = (device: RegistryDevice) => {
    setEditing(device)
    const config = device.agent_config || {}
    setForm({
      name: device.name,
      device_type: device.device_type,
      mac_address: device.mac_address || '',
      ip_address: device.ip_address || '',
      wake_enabled: device.wake_enabled,
      notes: device.notes,
      agent_type: device.agent_type || '',
      agent_host: typeof config.host === 'string' ? config.host : '',
      agent_port: config.port != null ? String(config.port) : '22',
      agent_url: typeof config.url === 'string' ? config.url : '',
    })
    setShowForm(true)
  }

  const probeDevice = async (device: RegistryDevice) => {
    setProbing(device.id)
    try {
      const response = await authFetch(`/api/devices/${device.id}/probe`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${response.status}`)
      }
      const result = await response.json() as ProbeResult
      setProbes((current) => ({ ...current, [device.id]: result }))
    } catch (probeError) {
      toast.error(probeError instanceof Error ? probeError.message : t('devicesApp.probeFailed'))
    } finally {
      setProbing(null)
    }
  }

  const activeCount = network.filter((device) => device.is_active).length
  const wakeableCount = registry.filter((device) => device.wake_enabled && device.mac_address).length

  const sortedRegistry = useMemo(
    () => [...registry].sort((a, b) => a.name.localeCompare(b.name)),
    [registry],
  )

  return (
    <section className="ora-app-frame mx-auto max-w-7xl overflow-hidden">
      <OsAppNavbar
        pageId="os-devices"
        title={t('os.apps.devices.name')}
        description={t('os.apps.devices.description')}
        icon={<Desktop size={24} weight="duotone" />}
        accent="oklch(0.66 0.17 250)"
        trailing={
          <>
            <button type="button" onClick={() => void load()} disabled={loading} className="ora-icon-button" title={t('devicesApp.refresh')}>
              <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => { setEditing(null); setForm({ name: '', device_type: 'computer', mac_address: '', ip_address: '', wake_enabled: true, notes: '', agent_type: '', agent_host: '', agent_port: '22', agent_url: '' }); setShowForm((value) => !value) }} className="ora-primary-button">
              <Plus size={16} />{t('devicesApp.addDevice')}
            </button>
          </>
        }
      />

      <div className="p-4 pb-10 sm:p-6">
      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Summary icon={WifiHigh} label={t('devicesApp.onlineDevices')} value={String(activeCount)} />
        <Summary icon={Monitor} label={t('devicesApp.knownDevices')} value={String(network.length)} />
        <Summary icon={Lightning} label={t('devicesApp.wakeable')} value={String(wakeableCount)} />
      </div>

      {/* Curated device registry */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold">{t('devicesApp.myDevices')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {sortedRegistry.map((device) => (
            <article key={device.id} className="ora-card rounded-3xl p-5">
              <div className="flex items-start gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
                  {deviceIcon(device.device_type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{device.name}</h3>
                    <span className="shrink-0 rounded-full bg-foreground/7 px-2 py-1 text-[10px] uppercase tracking-wide text-foreground/45">
                      {t(`devicesApp.types.${device.device_type}`)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-foreground/40">
                    {device.mac_address ? device.mac_address : '–'}
                    {device.ip_address ? ` · ${device.ip_address}` : ''}
                  </p>
                  {device.notes && <p className="mt-1 text-xs text-foreground/45">{device.notes}</p>}
                </div>
              </div>
              {device.agent_type && (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-foreground/5 px-3 py-2 text-xs">
                  <span className="text-foreground/45">{t(`devicesApp.agents.${device.agent_type}`)}</span>
                  <span className="flex items-center gap-2">
                    {probes[device.id] && (
                      <span className={probes[device.id].reachable ? 'text-emerald-400' : 'text-red-400'} title={probes[device.id].detail}>
                        {probes[device.id].reachable ? t('devicesApp.online') : t('devicesApp.offline')}
                        {probes[device.id].latency_ms != null && ` · ${probes[device.id].latency_ms}ms`}
                      </span>
                    )}
                    <button type="button" disabled={probing === device.id} onClick={() => void probeDevice(device)} className="rounded-lg bg-foreground/7 px-2 py-1 text-[11px] font-semibold text-foreground/70 transition-colors hover:bg-foreground/12 disabled:opacity-40">
                      <Pulse size={12} className="mr-1 inline" />{probing === device.id ? t('devicesApp.checking') : t('devicesApp.check')}
                    </button>
                  </span>
                </div>
              )}
              <div className="mt-4 flex items-center justify-end gap-2">
                {device.wake_enabled && device.mac_address ? (
                  <button type="button" disabled={waking === device.id} onClick={() => void wakeDevice(device)} className="ora-primary-button !py-2">
                    <Lightning size={15} />{waking === device.id ? t('devicesApp.waking') : t('devicesApp.wake')}
                  </button>
                ) : (
                  <span className="text-[11px] text-foreground/35">{t('devicesApp.notWakeable')}</span>
                )}
                <button type="button" onClick={() => openEdit(device)} className="ora-secondary-button !py-2"><PencilSimple size={15} />{t('devicesApp.edit')}</button>
                <button type="button" onClick={() => void removeDevice(device)} className="rounded-xl p-2 text-foreground/45 hover:bg-red-500/15 hover:text-red-300" title={t('devicesApp.remove')}><Trash size={16} /></button>
              </div>
            </article>
          ))}
          {!loading && sortedRegistry.length === 0 && (
            <div className="ora-card rounded-3xl p-8 text-center text-sm text-foreground/40">{t('devicesApp.noDevices')}</div>
          )}
        </div>
      </div>

      {/* Add / edit form */}
      {showForm && (
        <form onSubmit={saveDevice} className="ora-card mb-6 rounded-3xl p-5">
          <h2 className="flex items-center justify-between font-semibold">
            <span>{editing ? t('devicesApp.editDevice') : t('devicesApp.addDevice')}</span>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl p-2 text-foreground/45 hover:bg-foreground/7"><X size={16} /></button>
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('devicesApp.name')}>
              <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="ora-field" placeholder={t('devicesApp.namePlaceholder')} />
            </Field>
            <Field label={t('devicesApp.type')}>
              <select value={form.device_type} onChange={(event) => setForm((current) => ({ ...current, device_type: event.target.value }))} className="ora-field">
                {DEVICE_TYPES.map((type) => <option key={type} value={type}>{t(`devicesApp.types.${type}`)}</option>)}
              </select>
            </Field>
            <Field label={t('devicesApp.macAddress')}>
              <input value={form.mac_address} onChange={(event) => setForm((current) => ({ ...current, mac_address: event.target.value }))} className="ora-field" placeholder="AA:BB:CC:DD:EE:FF" />
            </Field>
            <Field label={t('devicesApp.ipAddress')}>
              <input value={form.ip_address} onChange={(event) => setForm((current) => ({ ...current, ip_address: event.target.value }))} className="ora-field" placeholder="192.168.1.10" />
            </Field>
            <Field label={t('devicesApp.notes')}>
              <input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className="ora-field" />
            </Field>
            <Field label={t('devicesApp.agent')}>
              <select value={form.agent_type} onChange={(event) => setForm((current) => ({ ...current, agent_type: event.target.value }))} className="ora-field">
                <option value="">{t('devicesApp.agentNone')}</option>
                <option value="tcp">TCP</option>
                <option value="http">HTTP</option>
              </select>
            </Field>
            {form.agent_type === 'tcp' && (
              <>
                <Field label={t('devicesApp.agentHost')}>
                  <input value={form.agent_host} onChange={(event) => setForm((current) => ({ ...current, agent_host: event.target.value }))} className="ora-field" placeholder="192.168.1.10" />
                </Field>
                <Field label={t('devicesApp.agentPort')}>
                  <input value={form.agent_port} onChange={(event) => setForm((current) => ({ ...current, agent_port: event.target.value }))} className="ora-field" placeholder="22" />
                </Field>
              </>
            )}
            {form.agent_type === 'http' && (
              <Field label={t('devicesApp.agentUrl')}>
                <input value={form.agent_url} onChange={(event) => setForm((current) => ({ ...current, agent_url: event.target.value }))} className="ora-field" placeholder="http://192.168.1.20:8080" />
              </Field>
            )}
            <label className="flex items-end gap-2 pb-2 text-sm text-foreground/60">
              <input type="checkbox" checked={form.wake_enabled} onChange={(event) => setForm((current) => ({ ...current, wake_enabled: event.target.checked }))} />
              {t('devicesApp.wakeEnabled')}
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="ora-secondary-button">{t('common.cancel')}</button>
            <button type="submit" className="ora-primary-button">{t('common.save')}</button>
          </div>
        </form>
      )}

      {/* Auto-discovered network devices */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">{t('devicesApp.networkDevices')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {network.map((device) => (
            <article key={device.id} className="ora-card rounded-3xl p-5">
              <div className="flex items-start gap-4">
                <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${device.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-foreground/6 text-foreground/40'}`}>
                  {device.is_active ? <WifiHigh size={22} weight="duotone" /> : <WifiSlash size={22} weight="duotone" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{device.hostname || device.ip_address || '–'}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] ${device.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-foreground/7 text-foreground/45'}`}>
                      {device.is_active ? t('devicesApp.online') : t('devicesApp.offline')}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-foreground/40">
                    {device.ip_address}
                    {device.mac_address ? ` · ${device.mac_address}` : ''}
                  </p>
                  {device.vendor && <p className="mt-1 text-xs text-foreground/45">{device.vendor}</p>}
                </div>
              </div>
            </article>
          ))}
          {!loading && network.length === 0 && (
            <div className="ora-card rounded-3xl p-8 text-center text-sm text-foreground/40">{t('devicesApp.noNetworkDevices')}</div>
          )}
        </div>
      </div>
      </div>
    </section>
  )
}

function Summary({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return <div className="ora-card rounded-2xl p-4"><Icon size={20} className="text-accent" /><p className="mt-3 text-xl font-semibold">{value}</p><p className="text-xs text-foreground/40">{label}</p></div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs text-foreground/55"><span className="mb-1 block">{label}</span>{children}</label>
}
