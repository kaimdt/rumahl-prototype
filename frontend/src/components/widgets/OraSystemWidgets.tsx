import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle,
  CircleNotch,
  Cpu,
  File,
  FolderOpen,
  HardDrive,
  HourglassHigh,
  ListBullets,
  Memory,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'

/**
 * ORA OS system widgets (Home Dashboard v2, Package 3).
 *
 * These widgets surface ORA-native data (storage quota, server health, jobs,
 * recent files) as dashboard sections. Home Assistant remains the source for
 * smart-home widgets — this is additive, not a replacement.
 */

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let amount = value
  let index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++ }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((seconds % 3_600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// ── Storage quota ───────────────────────────────────────────────────────────

export function OraStorageWidget({ config }: { config?: Record<string, unknown> }) {
  const { t } = useTranslation()
  const [quota, setQuota] = useState<{ quota_bytes: number; used_bytes: number; available_bytes: number; usage_percent: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/files/quota')
      if (res.ok) setQuota(await res.json())
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const percent = quota?.usage_percent ?? 0
  const showUsed = (config?.showUsed ?? true) as boolean
  const showAvailable = (config?.showAvailable ?? true) as boolean

  return (
    <div className="h-full w-full rounded-3xl border border-white/8 bg-foreground/4 p-4">
      <div className="flex items-center gap-2">
        <HardDrive size={16} className="text-cyan-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{t('widgets.oraStorage.title')}</span>
      </div>
      {quota ? (
        <>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-foreground/10">
            <div className={`h-full rounded-full ${percent > 85 ? 'bg-red-400' : 'bg-cyan-400'}`} style={{ width: `${Math.min(percent, 100)}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            {showUsed && <span className="font-semibold">{formatBytes(quota.used_bytes)} <span className="text-foreground/40">{t('widgets.oraStorage.used')}</span></span>}
            <span className="text-foreground/45">{percent.toFixed(0)}%</span>
            {showAvailable && <span className="text-foreground/45">{formatBytes(quota.available_bytes)} {t('widgets.oraStorage.free')}</span>}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-foreground/40">{t('widgets.oraStorage.unavailable')}</p>
      )}
    </div>
  )
}

// ── Server health (CPU / RAM / uptime) ─────────────────────────────────────

export function OraSystemWidget() {
  const { t } = useTranslation()
  const [stats, setStats] = useState<{ cpu_usage_percent: number; memory_total_bytes: number; memory_used_bytes: number; uptime_seconds: number; hostname: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/os/control/system')
      if (res.ok) setStats(await res.json())
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const memoryPercent = stats?.memory_total_bytes
    ? Math.round((stats.memory_used_bytes / stats.memory_total_bytes) * 100)
    : 0

  return (
    <div className="h-full w-full rounded-3xl border border-white/8 bg-foreground/4 p-4">
      <div className="flex items-center gap-2">
        <Cpu size={16} className="text-cyan-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{t('widgets.oraSystem.title')}</span>
        {stats && <span className="ml-auto truncate text-[11px] text-foreground/40">{stats.hostname}</span>}
      </div>
      {stats ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <Cpu size={15} className="mx-auto mb-1 text-foreground/45" />
            <p className="text-sm font-semibold">{Math.round(stats.cpu_usage_percent)}%</p>
            <p className="text-[9px] uppercase tracking-wide text-foreground/35">{t('widgets.oraSystem.cpu')}</p>
          </div>
          <div>
            <Memory size={15} className="mx-auto mb-1 text-foreground/45" />
            <p className="text-sm font-semibold">{memoryPercent}%</p>
            <p className="text-[9px] uppercase tracking-wide text-foreground/35">{t('widgets.oraSystem.memory')}</p>
          </div>
          <div>
            <HourglassHigh size={15} className="mx-auto mb-1 text-foreground/45" />
            <p className="text-sm font-semibold">{formatUptime(stats.uptime_seconds)}</p>
            <p className="text-[9px] uppercase tracking-wide text-foreground/35">{t('widgets.oraSystem.uptime')}</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-foreground/40">{t('widgets.oraSystem.unavailable')}</p>
      )}
    </div>
  )
}

// ── Active jobs ─────────────────────────────────────────────────────────────

interface OraJob { id: string; name: string; job_type: string; status: string; progress: number; message: string }

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export function OraJobsWidget() {
  const { t } = useTranslation()
  const [jobs, setJobs] = useState<OraJob[]>([])

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/jobs')
      if (res.ok) {
        const data = await res.json() as { jobs?: OraJob[] }
        setJobs(data.jobs || [])
      }
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 5_000)
    return () => window.clearInterval(timer)
  }, [load])

  const visible = jobs.slice(0, 4)
  const activeCount = jobs.filter((job) => !TERMINAL.has(job.status)).length

  return (
    <div className="h-full w-full rounded-3xl border border-white/8 bg-foreground/4 p-4">
      <div className="flex items-center gap-2">
        <ListBullets size={16} className="text-cyan-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{t('widgets.oraJobs.title')}</span>
        {activeCount > 0 && <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">{activeCount}</span>}
      </div>
      <div className="mt-2 space-y-2">
        {visible.map((job) => (
          <div key={job.id} className="flex items-center gap-2">
            {job.status === 'running' ? <CircleNotch size={13} className="shrink-0 animate-spin text-sky-400" />
              : job.status === 'completed' ? <CheckCircle size={13} className="shrink-0 text-emerald-400" />
                : job.status === 'failed' ? <XCircle size={13} className="shrink-0 text-red-400" />
                  : <X size={13} className="shrink-0 text-neutral-500" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-foreground/80">{job.name}</p>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }} />
              </div>
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-foreground/40">{job.progress}%</span>
          </div>
        ))}
        {visible.length === 0 && <p className="py-3 text-center text-xs text-foreground/40">{t('widgets.oraJobs.empty')}</p>}
      </div>
    </div>
  )
}

// ── Recent files ────────────────────────────────────────────────────────────

interface OraFile { id: string; original_name: string; is_folder: boolean; size_bytes: number; updated_at: string }

export function OraRecentFilesWidget() {
  const { t } = useTranslation()
  const [files, setFiles] = useState<OraFile[]>([])

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/files/?limit=100')
      if (res.ok) {
        const data = await res.json() as { files?: OraFile[] }
        const recent = (data.files || [])
          .filter((file) => !file.is_folder)
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, 5)
        setFiles(recent)
      }
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(load, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <div className="h-full w-full rounded-3xl border border-white/8 bg-foreground/4 p-4">
      <div className="flex items-center gap-2">
        <FolderOpen size={16} className="text-cyan-300" />
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{t('widgets.oraFiles.title')}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {files.map((file) => (
          <div key={file.id} className="flex items-center gap-2">
            <File size={13} className="shrink-0 text-foreground/45" />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{file.original_name}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-foreground/40">{formatBytes(file.size_bytes)}</span>
          </div>
        ))}
        {files.length === 0 && <p className="py-3 text-center text-xs text-foreground/40">{t('widgets.oraFiles.empty')}</p>}
      </div>
    </div>
  )
}
