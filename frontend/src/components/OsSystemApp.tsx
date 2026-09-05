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
import { OsAppNavbar } from '@/components/OsAppNavbar'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

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

export function OsSystemApp({ kind }: { kind: 'files' | 'network' | 'system' }) {
  if (kind === 'files') return <OsFileExplorer />
  return <OsSystemDataApp kind={kind} pageId={`os-${kind}`} />
}

function OsSystemDataApp({ kind, pageId }: { kind: 'network' | 'system'; pageId: string }) {
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
  const [cpuHistory, setCpuHistory] = useState(() => [52, 58, 47, 62, 70, 64, 76, 59, 67, 73, 61, 68].map((value, index) => ({ label: `${index + 1}`, value })))
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
        const nextSystem = await systemResponse.json() as SystemData
        setSystem(nextSystem)
        setCpuHistory((current) => [...current.slice(-17), { label: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), value: nextSystem.cpu_usage_percent }])
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
    <section className="rumahl-system-monitor-app rumahl-app-frame overflow-hidden">
      <OsAppNavbar
        pageId={pageId}
        title={title}
        description={subtitle}
        icon={kind === 'network' ? <WifiHigh size={24} weight="duotone" /> : <Cpu size={24} weight="duotone" />}
        accent={kind === 'network' ? 'oklch(0.67 0.16 205)' : 'oklch(0.66 0.17 145)'}
        trailing={
          <button type="button" onClick={load} disabled={loading} className="rumahl-icon-button" title={t('common.refresh')}>
            <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      <div className="p-4">
      {error && <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

      {kind === 'network' && (
        <>
        {can('os.network.write') && (
          <div className="mb-4 rounded-2xl border border-amber-500/20 bg-warning/8 p-4">
            {networkConfirmation ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><p className="flex-1 text-sm text-amber-100">{t('os.systemApps.confirmDhcp')}</p><button type="button" onClick={() => setNetworkConfirmation(false)} className="rounded-xl bg-foreground/8 px-3 py-2 text-xs">{t('common.cancel')}</button><button type="button" disabled={working} onClick={enableDhcp} className="rounded-xl bg-warning px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">{t('common.confirm')}</button></div>
            ) : (
              <div className="flex items-center justify-between gap-3"><p className="text-sm text-foreground/60">{t('os.systemApps.dhcpHint')}</p><button type="button" onClick={() => setNetworkConfirmation(true)} className="shrink-0 rounded-xl bg-foreground/8 px-3 py-2 text-xs">{t('os.systemApps.enableDhcp')}</button></div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {interfaces.map((entry) => (
            <article key={entry.name} className="rumahl-card p-5">
              <div className="flex items-center justify-between"><WifiHigh size={24} weight="duotone" className="text-success" /><span className="rounded-full bg-success/10 px-2 py-1 text-[10px] font-semibold text-success">{t('os.systemApps.active')}</span></div>
              <h2 className="mt-5 text-lg font-semibold">{entry.name}</h2>
              <p className="text-xs text-foreground/40">{entry.mac_address || t('os.systemApps.noAddress')}</p>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs"><span>{t('os.systemApps.received')}<strong className="mt-1 block">{formatBytes(entry.received_bytes)}</strong></span><span>{t('os.systemApps.sent')}<strong className="mt-1 block">{formatBytes(entry.transmitted_bytes)}</strong></span></div>
            </article>
          ))}
          {!loading && interfaces.length === 0 && <div className="rumahl-card col-span-full p-8 text-center text-sm text-foreground/40">{t('os.systemApps.noInterfaces')}</div>}
        </div>
        </>
      )}

      {kind === 'system' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rumahl-card p-4"><Cpu size={20} className="mb-2 text-accent" /><p className="text-xl font-semibold">{Math.round(system?.cpu_usage_percent || 0)}%</p><p className="text-xs text-foreground/40">CPU</p></div>
            <div className="rumahl-card p-4"><HardDrive size={20} className="mb-2 text-accent" /><p className="text-xl font-semibold">{formatBytes(system?.memory_used_bytes)}</p><p className="text-xs text-foreground/40">{t('os.shell.memory')}</p></div>
            <div className="rumahl-card p-4"><Network size={20} className="mb-2 text-accent" /><p className="truncate text-xl font-semibold">{system?.hostname || '–'}</p><p className="text-xs text-foreground/40">{system ? `${system.os_name} ${system.os_version}` : '–'}</p></div>
          </div>
          <div className="rumahl-system-performance rumahl-card p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold">{t('adminCenter.desktop.performance')}</h2><p className="text-[10px] text-foreground/35">{t('adminCenter.desktop.cpuUsage')}</p></div>
              <span className="rounded-md bg-foreground/5 px-2 py-1 text-[9px] text-foreground/45">1H</span>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cpuHistory} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <defs><linearGradient id="rumahlSystemCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7467ff" stopOpacity={0.25} /><stop offset="100%" stopColor="#7467ff" stopOpacity={0.01} /></linearGradient></defs>
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,.32)', fontSize: 9 }} unit="%" />
                  <XAxis dataKey="label" interval="preserveStartEnd" axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,.28)', fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: '#17171f', border: '1px solid rgba(255,255,255,.1)', borderRadius: 7, fontSize: 10 }} />
                  <Area type="linear" dataKey="value" stroke="#7668ff" strokeWidth={2} fill="url(#rumahlSystemCpu)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rumahl-card p-5"><h2 className="mb-3 text-sm font-semibold">{t('os.systemApps.storage')}</h2>{disks.map((disk) => <div key={disk.mount_point} className="mb-3 last:mb-0"><div className="mb-1 flex justify-between text-xs"><span>{disk.mount_point}</span><span>{Math.round(disk.usage_percent)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(disk.usage_percent, 100)}%` }} /></div></div>)}</div>
          <div className="rumahl-card p-5"><h2 className="mb-3 text-sm font-semibold">{t('os.systemApps.processes')}</h2>{processes.slice(0, 10).map((process) => <div key={process.pid} className="flex items-center gap-3 border-b border-foreground/7 py-2 text-xs last:border-0"><span className="w-12 text-foreground/35">{process.pid}</span><span className="min-w-0 flex-1 truncate font-medium">{process.name}</span><span>{process.cpu_percent.toFixed(1)}%</span><span className="w-20 text-right text-foreground/45">{formatBytes(process.memory_bytes)}</span></div>)}</div>
        </div>
      )}
      </div>
    </section>
  )
}
