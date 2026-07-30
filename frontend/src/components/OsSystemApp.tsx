import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowClockwise,
  Cpu,
  File,
  Folder,
  HardDrive,
  Network,
  Plus,
  UploadSimple,
  WifiHigh,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { useOsPermissions } from '@/hooks/useOsPermissions'

interface FileEntry {
  id: string
  name?: string
  original_name?: string
  size?: number
  size_bytes?: number
  mime_type?: string | null
  is_folder?: boolean
  updated_at?: string
}

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
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [quota, setQuota] = useState<{ used?: number; limit?: number; file_count?: number } | null>(null)
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([])
  const [disks, setDisks] = useState<DiskEntry[]>([])
  const [processes, setProcesses] = useState<ProcessEntry[]>([])
  const [system, setSystem] = useState<SystemData | null>(null)
  const [folderName, setFolderName] = useState('')
  const [networkConfirmation, setNetworkConfirmation] = useState(false)
  const [working, setWorking] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const { can } = useOsPermissions()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (kind === 'files') {
        const [filesResponse, quotaResponse] = await Promise.all([
          authFetch('/api/files/'),
          authFetch('/api/files/quota'),
        ])
        if (!filesResponse.ok) throw new Error(`HTTP ${filesResponse.status}`)
        const filesData = await filesResponse.json()
        setFiles(Array.isArray(filesData) ? filesData : filesData.files || [])
        setQuota(quotaResponse.ok ? await quotaResponse.json() : null)
      } else if (kind === 'network') {
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
      setError(t('os.systemApps.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [kind, t])

  useEffect(() => {
    load()
  }, [load])

  const downloadFile = async (entry: FileEntry) => {
    if (entry.is_folder) return
    try {
      const response = await authFetch(`/api/files/${entry.id}/download`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = entry.original_name || entry.name || 'download'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(t('os.systemApps.downloadFailed'))
    }
  }

  const uploadFile = async (file?: globalThis.File) => {
    if (!file || !can('os.files.write')) return
    setWorking(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await authFetch('/api/files/upload', { method: 'POST', body })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await load()
    } catch {
      setError(t('os.systemApps.uploadFailed'))
    } finally {
      setWorking(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  const createFolder = async () => {
    if (!folderName.trim() || !can('os.files.write')) return
    setWorking(true)
    setError('')
    try {
      const response = await authFetch('/api/files/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName.trim() }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setFolderName('')
      await load()
    } catch {
      setError(t('os.systemApps.folderFailed'))
    } finally {
      setWorking(false)
    }
  }

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
    <section className="mx-auto min-h-[calc(100vh-11rem)] max-w-6xl pb-10">
      <AppHeader title={title} subtitle={subtitle} loading={loading} refresh={load} />
      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      {kind === 'files' && (
        <>
          {can('os.files.write') && (
            <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={t('os.systemApps.folderName')} className="min-h-11 rounded-xl border border-foreground/10 bg-foreground/5 px-3 text-sm outline-none" />
              <button type="button" onClick={createFolder} disabled={working || !folderName.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-foreground/8 px-4 py-2 text-sm disabled:opacity-40"><Plus size={16} />{t('os.systemApps.createFolder')}</button>
              <button type="button" onClick={() => uploadRef.current?.click()} disabled={working} className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"><UploadSimple size={16} />{t('os.systemApps.upload')}</button>
              <input ref={uploadRef} type="file" className="hidden" onChange={(event) => uploadFile(event.target.files?.[0])} />
            </div>
          )}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="glass-card rounded-2xl p-4"><HardDrive size={20} className="mb-2 text-accent" /><p className="text-lg font-semibold">{formatBytes(quota?.used)}</p><p className="text-xs text-foreground/40">{t('os.systemApps.usedStorage')}</p></div>
            <div className="glass-card rounded-2xl p-4"><File size={20} className="mb-2 text-accent" /><p className="text-lg font-semibold">{quota?.file_count ?? files.length}</p><p className="text-xs text-foreground/40">{t('os.systemApps.files')}</p></div>
            <div className="glass-card col-span-2 rounded-2xl p-4 sm:col-span-1"><HardDrive size={20} className="mb-2 text-accent" /><p className="text-lg font-semibold">{formatBytes(quota?.limit)}</p><p className="text-xs text-foreground/40">{t('os.systemApps.quota')}</p></div>
          </div>
          <div className="glass-card overflow-hidden rounded-3xl">
            {files.length === 0 && !loading ? <p className="p-8 text-center text-sm text-foreground/40">{t('os.systemApps.noFiles')}</p> : files.map((entry) => (
              <button key={entry.id} type="button" onClick={() => downloadFile(entry)} className="flex w-full items-center gap-3 border-b border-foreground/7 p-4 text-left last:border-0 hover:bg-foreground/5">
                {entry.is_folder ? <Folder size={22} weight="duotone" className="text-amber-400" /> : <File size={22} weight="duotone" className="text-accent" />}
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.original_name || entry.name}</p><p className="text-xs text-foreground/35">{entry.mime_type || t('os.systemApps.folder')}</p></div>
                <span className="text-xs text-foreground/40">{entry.is_folder ? '' : formatBytes(entry.size_bytes ?? entry.size)}</span>
              </button>
            ))}
          </div>
        </>
      )}

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
