import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowClockwise,
  BatteryCharging,
  Bell,
  CaretRight,
  Cpu,
  Gear,
  LockKey,
  Moon,
  Power,
  SquaresFour,
  WifiHigh,
  WifiSlash,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { authFetch } from '@/lib/authHelpers'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { useOsPermissions } from '@/hooks/useOsPermissions'

interface SystemStats {
  cpu_usage_percent: number
  memory_total_bytes: number
  memory_used_bytes: number
  uptime_seconds: number
  hostname: string
  os_name: string
  os_version: string
}

const RECENT_APPS_KEY = 'iora-os-recent-apps'
const MAX_RECENT_APPS = 6

function readRecentApps(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_APPS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function formatUptime(seconds: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  return days > 0
    ? t('os.shell.uptimeDays', { days, hours })
    : t('os.shell.uptimeHours', { hours })
}

export function OsSystemShell() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { theme, sleepMode, setSleepMode } = useTheme()
  const { currentPageId, pages, setCurrentPageId } = usePageNavigation()
  const [open, setOpen] = useState(false)
  const [showRecents, setShowRecents] = useState(false)
  const [recentIds, setRecentIds] = useState<string[]>(readRecentApps)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [systemReachable, setSystemReachable] = useState<boolean | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [powerConfirmation, setPowerConfirmation] = useState<'reboot' | 'shutdown' | null>(null)
  const [powerPending, setPowerPending] = useState(false)
  const { can } = useOsPermissions()

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    return [...SYSTEM_OS_APPS, ...pageApps]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || can(app.requiredPermission))
  }, [can, pages, user?.isAdmin])

  const appByPageId = useMemo(
    () => new Map(apps.map((app) => [app.pageId, app])),
    [apps],
  )
  const recentApps = useMemo(
    () => recentIds.map((id) => appByPageId.get(id)).filter((app): app is OsAppDefinition => Boolean(app)),
    [appByPageId, recentIds],
  )

  useEffect(() => {
    if (currentPageId === 'launcher') return
    setRecentIds((current) => {
      const next = [currentPageId, ...current.filter((id) => id !== currentPageId)].slice(0, MAX_RECENT_APPS)
      localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(next))
      window.dispatchEvent(new Event('iora:recents-changed'))
      return next
    })
  }, [currentPageId])

  const refreshSystemStats = useCallback(async () => {
    try {
      if (!can('os.system.read')) {
        setStats(null)
        setSystemReachable(null)
        return
      }
      const response = await authFetch('/api/os/control/system', {
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setStats(await response.json())
      setSystemReachable(true)
    } catch {
      setSystemReachable(false)
    }
  }, [can])

  useEffect(() => {
    refreshSystemStats()
    const interval = window.setInterval(refreshSystemStats, 30_000)
    return () => window.clearInterval(interval)
  }, [refreshSystemStats])

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.altKey && event.key === 'Tab') {
        event.preventDefault()
        setShowRecents(true)
        setOpen(false)
      }
      if (event.key === 'Escape') {
        setShowRecents(false)
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [])

  const openApp = (pageId: string) => {
    setCurrentPageId(pageId)
    setShowRecents(false)
    setOpen(false)
  }

  const executePowerAction = async () => {
    if (!powerConfirmation) return
    setPowerPending(true)
    try {
      const response = await authFetch(`/api/os/control/os/${powerConfirmation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay_seconds: 5, reason: 'Requested from ORA OS system shell' }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setPowerConfirmation(null)
      setOpen(false)
    } finally {
      setPowerPending(false)
    }
  }

  const memoryPercent = stats?.memory_total_bytes
    ? Math.round((stats.memory_used_bytes / stats.memory_total_bytes) * 100)
    : 0

  return (
    <>
      <div className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[55] sm:right-6 sm:top-5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="glass-card flex min-h-11 items-center gap-2 rounded-full px-3 text-foreground/75 shadow-lg transition-colors hover:text-foreground focus-ring"
          aria-label={t('os.shell.openQuickSettings')}
          aria-expanded={open}
        >
          {online ? <WifiHigh size={17} weight="bold" /> : <WifiSlash size={17} weight="bold" />}
          <span className={`h-2 w-2 rounded-full ${systemReachable ? 'bg-emerald-400' : systemReachable === false ? 'bg-red-400' : 'bg-amber-400'}`} />
          <span className="hidden text-xs font-semibold sm:inline">{stats?.hostname || 'ORA OS'}</span>
        </button>
      </div>

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
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ opacity: 0, y: -14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              className="glass-card fixed right-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-[57] w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-white/15 p-4 shadow-2xl sm:right-6 sm:top-[4.5rem]"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('os.shell.quickSettings')}</p>
                  <p className="text-[11px] text-foreground/45">
                    {systemReachable ? t('os.shell.systemReady') : t('os.shell.systemLimited')}
                  </p>
                </div>
                <button type="button" onClick={refreshSystemStats} className="rounded-full p-2 text-foreground/50 hover:bg-foreground/10 hover:text-foreground">
                  <ArrowClockwise size={16} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => openApp('launcher')} className="rounded-2xl bg-foreground/7 p-3 text-left hover:bg-foreground/12">
                  <SquaresFour size={20} weight="duotone" className="mb-2 text-accent" />
                  <span className="block text-xs font-semibold">{t('os.shell.apps')}</span>
                </button>
                <button type="button" onClick={() => setSleepMode(!sleepMode)} className={`rounded-2xl p-3 text-left ${sleepMode ? 'bg-indigo-500/25 text-indigo-100' : 'bg-foreground/7 hover:bg-foreground/12'}`}>
                  <Moon size={20} weight="duotone" className="mb-2" />
                  <span className="block text-xs font-semibold">{sleepMode ? t('os.shell.sleepOn') : t('os.shell.sleepOff')}</span>
                </button>
                <button type="button" onClick={() => openApp('settings')} className="rounded-2xl bg-foreground/7 p-3 text-left hover:bg-foreground/12">
                  <Gear size={20} weight="duotone" className="mb-2 text-foreground/70" />
                  <span className="block text-xs font-semibold">{t('os.apps.settings.name')}</span>
                </button>
                <button type="button" onClick={() => { window.dispatchEvent(new Event('iora:lock-session')); setOpen(false) }} className="rounded-2xl bg-foreground/7 p-3 text-left hover:bg-foreground/12">
                  <LockKey size={20} weight="duotone" className="mb-2 text-foreground/70" />
                  <span className="block text-xs font-semibold">{t('os.shell.lock')}</span>
                </button>
              </div>

              <div className="my-4 grid grid-cols-3 gap-2 rounded-2xl bg-foreground/5 p-3 text-center">
                <div>
                  <Cpu size={15} className="mx-auto mb-1 text-foreground/45" />
                  <p className="text-xs font-semibold">{Math.round(stats?.cpu_usage_percent || 0)}%</p>
                  <p className="text-[9px] uppercase tracking-wide text-foreground/35">{t('os.shell.cpu')}</p>
                </div>
                <div>
                  <BatteryCharging size={15} className="mx-auto mb-1 text-foreground/45" />
                  <p className="text-xs font-semibold">{memoryPercent}%</p>
                  <p className="text-[9px] uppercase tracking-wide text-foreground/35">{t('os.shell.memory')}</p>
                </div>
                <div>
                  <Bell size={15} className="mx-auto mb-1 text-foreground/45" />
                  <p className="truncate text-xs font-semibold">{stats ? formatUptime(stats.uptime_seconds, t) : '–'}</p>
                  <p className="text-[9px] uppercase tracking-wide text-foreground/35">{t('os.shell.uptime')}</p>
                </div>
              </div>

              {powerConfirmation ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3">
                  <p className="text-xs font-semibold text-red-200">
                    {powerConfirmation === 'reboot' ? t('os.shell.confirmReboot') : t('os.shell.confirmShutdown')}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setPowerConfirmation(null)} className="flex-1 rounded-xl bg-foreground/8 px-3 py-2 text-xs">{t('common.cancel')}</button>
                    <button type="button" disabled={powerPending} onClick={executePowerAction} className="flex-1 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{t('common.confirm')}</button>
                  </div>
                </div>
              ) : can('os.power') ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPowerConfirmation('reboot')} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-foreground/7 px-3 py-2 text-xs hover:bg-foreground/12">
                    <ArrowClockwise size={14} /> {t('os.shell.reboot')}
                  </button>
                  <button type="button" onClick={() => setPowerConfirmation('shutdown')} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20">
                    <Power size={14} /> {t('os.shell.shutdown')}
                  </button>
                </div>
              ) : null}

              <p className="mt-3 text-center text-[10px] text-foreground/30">
                {stats ? `${stats.os_name} ${stats.os_version}` : t('os.shell.noSystemData')} · {theme}
              </p>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRecents && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRecents(false)}
          >
            <motion.div
              initial={{ y: 24, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 16, scale: 0.98 }}
              className="glass-card w-full max-w-3xl rounded-[2rem] border border-white/15 p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{t('os.shell.recentApps')}</h2>
                  <p className="text-xs text-foreground/40">{t('os.shell.taskSwitcherHint')}</p>
                </div>
                <button type="button" onClick={() => setShowRecents(false)} className="rounded-full p-2 text-foreground/50 hover:bg-foreground/10">
                  <CaretRight size={18} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {(recentApps.length ? recentApps : apps.slice(0, 6)).map((app) => {
                  const Icon = app.icon
                  const name = app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName
                  return (
                    <button key={app.id} type="button" onClick={() => openApp(app.pageId)} className="group rounded-2xl border border-white/10 bg-foreground/5 p-4 text-left hover:bg-foreground/10">
                      <span className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-lg" style={{ background: app.accent }}>
                        <Icon size={24} weight="duotone" />
                      </span>
                      <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                        <span className="truncate">{name}</span>
                        <CaretRight size={14} className="text-foreground/25 transition-transform group-hover:translate-x-1" />
                      </span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
