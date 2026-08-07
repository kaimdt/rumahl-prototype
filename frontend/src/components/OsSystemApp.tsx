import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  Cpu,
  HardDrive,
  Network,
  WifiHigh,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { OsFileExplorer } from '@/components/OsFileExplorer'

interface NetworkInterface {
  name: string
  mac_address?: string
  received_bytes?: number
  transmitted_bytes?: number
}

interface DiskEntry {
  name: string
  mount_point: string
  total_bytes: number
  used_bytes: number
  usage_percent: number
}

interface ProcessEntry {
  pid: number
  name: string
  cpu_percent: number
  memory_bytes: number
}

interface SystemData {
  hostname: string
  os_name: string
  os_version: string
  kernel_version: string
  cpu_usage_percent: number
  memory_total_bytes: number
  memory_used_bytes: number
  uptime_seconds: number
}

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

function AppHeader({ title, subtitle, loading, refresh }: { title: string; subtitle: string; loading: boolean; refresh: () => void }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/40">ORA OS</p>
        <h1 className="mt-1 text-3xl font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-foreground/45">{subtitle}</p>
      </div>
      <button type="button" onClick={refresh} disabled={loading} className="glass-card rounded-full p-3 text-foreground/60 hover:text-foreground disabled:opacity-40">
        <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
      </button>
    </header>
  )
}

export function OsSystemApp({ kind }: { kind: 'files' | 'network' | 'system' }) {
  if (kind === 'files') return <OsFileExplorer />
  return <OsSystemDataApp kind={kind} />
}

function OsSystemDataApp({ kind }: { kind: 'network' | 'system' }) {
  const { t } = useTranslation()
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t }, [t])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [disks, setDisks] = useState<DiskEntry[]>([])
  const [processes, setProcesses] = useState<ProcessEntry[]>([])
  const [system, setSystem] = useState<SystemData | null>(null)
  const [networkConfirmation, setNetworkConfirmation] = useState(false)
  const [working, setWorking] = useState(false)
  const { can } = useOsPermissions()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (kind === 'network') {
        const response = await authFetch('/api/os/control/os/network')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        setInterfaces(data.interfaces || data.sysinfo || [])
      } else {
        const [systemResponse, disksResponse, processesResponse] = await Promise.all([
          authFetch('/api/os/control/system'),
          authFetch('/api/os/control/os/disks'),
          authFetch('/api/os/control/os/processes'),
        ])
        if (!systemResponse.ok) throw new Error(`HTTP ${systemResponse.status}`)
        setSystem(await systemResponse.json())
        setDisks(disksResponse.ok ? (await disksResponse.json()).disks || [] : [])
        setProcesses(processesResponse.ok ? (await processesResponse.json()).processes || [] : [])
      }
    } catch {
      setError(tRef.current('os.systemApps.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    load()
  }, [load])

  const enableDhcp = async () => {
    setWorking(true)
    setError('')
    try {
      const response = await authFetch('/api/os/control/os/network/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'dhcp',
          ipv4_config: { method: 'dhcp', address: '', gateway: '', dns: [] },
          ipv6_config: { method: 'dhcp', address: '', gateway: '', dns: [] },
        }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setNetworkConfirmation(false)
      await load()
    } catch {
      setError(t('os.systemApps.networkChangeFailed'))
    } finally {
      setWorking(false)
    }
  }

  const title = t(`os.apps.${kind}.name`)
  const subtitle = t(`os.apps.${kind}.description`)

  return (
    <section className="ora-app-frame mx-auto max-w-6xl p-4 pb-10 sm:p-6">
      <AppHeader title={title} subtitle={subtitle} loading={loading} refresh={load} />
      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {kind === 'network' && (
        <>
        {can('os.network.write') && (
          <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/8 p-4">
            {networkConfirmation ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><p className="flex-1 text-sm text-amber-100">{t('os.systemApps.confirmDhcp')}</p><button type="button" onClick={() => setNetworkConfirmation(false)} className="rounded-xl bg-foreground/8 px-3 py-2 text-xs">{t('common.cancel')}</button><button type="button" disabled={working} onClick={enableDhcp} className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">{t('common.confirm')}</button></div>
            ) : (
              <div className="flex items-center justify-between gap-3"><p className="text-sm text-foreground/60">{t('os.systemApps.dhcpHint')}</p><button type="button" onClick={() => setNetworkConfirmation(true)} className="shrink-0 rounded-xl bg-foreground/8 px-3 py-2 text-xs">{t('os.systemApps.enableDhcp')}</button></div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {interfaces.map((entry) => (
            <article key={entry.name} className="glass-card rounded-3xl p-5">
              <div className="flex items-center justify-between"><WifiHigh size={24} weight="duotone" className="text-emerald-400" /><span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-300">{t('os.systemApps.active')}</span></div>
              <h2 className="mt-5 text-lg font-semibold">{entry.name}</h2>
              <p className="text-xs text-foreground/40">{entry.mac_address || t('os.systemApps.noAddress')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><span>{t('os.systemApps.received')}<strong className="mt-1 block">{formatBytes(entry.received_bytes)}</strong></span><span>{t('os.systemApps.sent')}<strong className="mt-1 block">{formatBytes(entry.transmitted_bytes)}</strong></span></div>
            </article>
          ))}
          {!loading && interfaces.length === 0 && <div className="glass-card col-span-full rounded-3xl p-8 text-center text-sm text-foreground/40">{t('os.systemApps.noInterfaces')}</div>}
        </div>
        </>
      )}

      {kind === 'system' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="glass-card rounded-2xl p-4"><Cpu size={20} className="mb-2 text-accent" /><p className="text-xl font-semibold">{Math.round(system?.cpu_usage_percent || 0)}%</p><p className="text-xs text-foreground/40">CPU</p></div>
            <div className="glass-card rounded-2xl p-4"><HardDrive size={20} className="mb-2 text-accent" /><p className="text-xl font-semibold">{formatBytes(system?.memory_used_bytes)}</p><p className="text-xs text-foreground/40">{t('os.shell.memory')}</p></div>
            <div className="glass-card rounded-2xl p-4"><Network size={20} className="mb-2 text-accent" /><p className="truncate text-xl font-semibold">{system?.hostname || '–'}</p><p className="text-xs text-foreground/40">{system ? `${system.os_name} ${system.os_version}` : '–'}</p></div>
          </div>
          <div className="glass-card rounded-3xl p-5"><h2 className="mb-3 text-sm font-semibold">{t('os.systemApps.storage')}</h2>{disks.map((disk) => <div key={disk.mount_point} className="mb-3 last:mb-0"><div className="mb-1 flex justify-between text-xs"><span>{disk.mount_point}</span><span>{Math.round(disk.usage_percent)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(disk.usage_percent, 100)}%` }} /></div></div>)}</div>
          <div className="glass-card rounded-3xl p-5"><h2 className="mb-3 text-sm font-semibold">{t('os.systemApps.processes')}</h2>{processes.slice(0, 10).map((process) => <div key={process.pid} className="flex items-center gap-3 border-b border-foreground/7 py-2 text-xs last:border-0"><span className="w-12 text-foreground/35">{process.pid}</span><span className="min-w-0 flex-1 truncate font-medium">{process.name}</span><span>{process.cpu_percent.toFixed(1)}%</span><span className="w-20 text-right text-foreground/45">{formatBytes(process.memory_bytes)}</span></div>)}</div>
        </div>
      )}
    </section>
  )
}
