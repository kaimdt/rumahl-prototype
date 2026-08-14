import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bell,
  CheckCircle,
  CircleNotch,
  Clock,
  HourglassHigh,
  Pause,
  Play,
  Trash,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { authFetch } from '@/lib/authHelpers'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { useClock } from '@/hooks/useClock'

/**
 * JobCenterPanel – system-wide background jobs (downloads, file operations,
 * backups, updates, imports, installs). Jobs survive app switches; the
 * backend `/api/jobs` table is the source of truth.
 */

interface SystemJob {
  id: string
  name: string
  job_type: string
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | string
  progress: number
  message: string
  source: string
  metadata: Record<string, unknown>
  created_by: string
  created_at: string
  started_at?: string | null
  finished_at?: string | null
  updated_at: string
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

/** Polls the system-job count for the shell header badge. */
export function useActiveSystemJobCount(intervalMs = 10_000) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const res = await authFetch('/api/jobs')
        if (!res.ok) return
        const data = await res.json() as { jobs?: SystemJob[] }
        if (!alive) return
        setCount((data.jobs || []).filter((job) => !TERMINAL.has(job.status)).length)
      } catch {
        // backend unreachable — keep last count
      }
    }
    void refresh()
    const id = window.setInterval(refresh, intervalMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [intervalMs])
  return count
}

function jobIcon(job: Pick<SystemJob, 'status'>, size = 15) {
  switch (job.status) {
    case 'running': return <CircleNotch size={size} className="animate-spin text-sky-400" />
    case 'paused': return <Pause size={size} className="text-amber-400" />
    case 'queued': return <HourglassHigh size={size} className="text-amber-400" />
    case 'completed': return <CheckCircle size={size} className="text-emerald-400" />
    case 'failed': return <XCircle size={size} className="text-red-400" />
    case 'cancelled': return <X size={size} className="text-neutral-500" />
    default: return <CircleNotch size={size} className="animate-spin text-sky-400" />
  }
}

export function JobCenterPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { activeJobs } = useInstalledApps()
  const [jobs, setJobs] = useState<SystemJob[]>([])
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch('/api/jobs')
      if (!res.ok) {
        if (res.status === 401) setJobs([])
        return
      }
      const data = await res.json() as { jobs?: SystemJob[] }
      setJobs(data.jobs || [])
    } catch {
      // backend unreachable — keep last list
    }
  }, [])

  // Poll while open, stop when closed.
  useEffect(() => {
    if (!open) return
    void refresh()
    pollRef.current = window.setInterval(refresh, 3000)
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current)
    }
  }, [open, refresh])

  const act = useCallback(async (id: string, path: string) => {
    try {
      setLoading(true)
      const res = await authFetch(`/api/jobs/${id}${path}`, { method: 'POST' })
      if (!res.ok) return
      const updated = await res.json() as SystemJob
      setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)))
    } finally {
      setLoading(false)
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    try {
      await authFetch(`/api/jobs/${id}`, { method: 'DELETE' })
      setJobs((current) => current.filter((job) => job.id !== id))
    } catch {
      // keep the job if removal failed
    }
  }, [])

  const cleanup = useCallback(async () => {
    try {
      const res = await authFetch('/api/jobs', { method: 'DELETE' })
      if (!res.ok) return
      setJobs((current) => current.filter((job) => !TERMINAL.has(job.status)))
    } catch {
      // keep list
    }
  }, [])

  const activeCount = jobs.filter((job) => !TERMINAL.has(job.status)).length
  const storeJobs = activeJobs.filter((job) => job.status !== 'finished' && job.status !== 'succeeded')
  const now = useClock()

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label={t('common.close')}
            className="fixed inset-0 z-[56] bg-black/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            className="glass-card fixed right-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-[57] flex max-h-[min(32rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-3xl border border-white/15 shadow-2xl sm:right-6 sm:top-[4.5rem]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Bell size={16} className="text-foreground/60" />
                  {t('notifications.title')}
                </p>
                <p className="text-[11px] text-foreground/45">
                  {now.toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
                  {activeCount > 0 ? ` · ${t('jobs.activeCount', { count: activeCount })}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={cleanup}
                  className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  title={t('jobs.cleanup')}
                >
                  <Trash size={15} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-2 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                  title={t('common.close')}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Job list */}
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {jobs.length === 0 && storeJobs.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <CheckCircle size={28} className="text-emerald-400/70" />
                  <p className="text-xs text-foreground/55">{t('jobs.empty')}</p>
                </div>
              )}

              {jobs.map((job) => (
                <div key={job.id} className="rounded-2xl border border-white/8 bg-foreground/5 p-3">
                  <div className="flex items-center gap-2.5">
                    {jobIcon(job)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-foreground/90">{job.name}</p>
                      <p className="truncate text-[11px] text-foreground/50">
                        {job.status === 'failed' && job.message ? job.message : t(`jobs.${job.status}`, t('jobs.unknown'))}
                        {job.status === 'failed' && !job.message ? ` · ${job.source}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {job.status === 'running' || job.status === 'queued' ? (
                        <button
                          type="button"
                          onClick={() => void act(job.id, '/pause')}
                          disabled={loading}
                          className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
                          title={t('jobs.pause')}
                        >
                          <Pause size={13} />
                        </button>
                      ) : null}
                      {job.status === 'paused' ? (
                        <button
                          type="button"
                          onClick={() => void act(job.id, '/resume')}
                          disabled={loading}
                          className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
                          title={t('jobs.resume')}
                        >
                          <Play size={13} />
                        </button>
                      ) : null}
                      {!TERMINAL.has(job.status) ? (
                        <button
                          type="button"
                          onClick={() => void act(job.id, '/cancel')}
                          disabled={loading}
                          className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-red-500/20 hover:text-red-300 disabled:opacity-40"
                          title={t('jobs.cancel')}
                        >
                          <X size={13} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void remove(job.id)}
                          disabled={loading}
                          className="rounded-lg p-1.5 text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-40"
                          title={t('jobs.delete')}
                        >
                          <Trash size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                    <motion.div
                      className="h-full rounded-full bg-accent transition-[width] duration-500"
                      initial={false}
                      animate={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wide text-foreground/35">{job.job_type}</span>
                    <span className="text-[10px] tabular-nums text-foreground/45">{job.progress}%</span>
                  </div>
                </div>
              ))}

              {storeJobs.length > 0 && (
                <div className="pt-2">
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground/45">
                    {t('jobs.appStore')}
                  </p>
                  {storeJobs.map((job) => (
                    <div key={job.id} className="mb-2 rounded-2xl border border-white/8 bg-foreground/5 p-3">
                      <div className="flex items-center gap-2.5">
                        <CircleNotch size={15} className="shrink-0 animate-spin text-sky-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-foreground/90">{job.appName}</p>
                          <p className="truncate text-[11px] text-foreground/50">{job.message || t('jobs.installing')}</p>
                        </div>
                        <span className="shrink-0 text-[10px] tabular-nums text-foreground/45">{job.progress}%</span>
                      </div>
                      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                        <motion.div
                          className="h-full rounded-full bg-accent transition-[width] duration-500"
                          initial={false}
                          animate={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
