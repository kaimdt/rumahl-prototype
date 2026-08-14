import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowClockwise,
  BatteryCharging,
  Bell,
  CaretRight,
  ClipboardText,
  Cpu,
  Gear,
  ListBullets,
  LockKey,
  Moon,
  Power,
  SquaresFour,
  WifiHigh,
  WifiSlash,
  SignOut,
  Play,
  Pause,
  MusicNotes,
  DownloadSimple,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { authFetch } from '@/lib/authHelpers'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useEntityStore } from '@/hooks/useEntityStore'
import { JobCenterPanel, useActiveSystemJobCount } from '@/components/JobCenterPanel'
import { ClipboardManager, useClipboardCapture } from '@/components/ClipboardManager'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { comboMatches, getCombo } from '@/lib/shortcutRegistry'

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
  const { theme, sleepMode, setSleepMode } = useTheme()
  const { currentPageId, pages, setCurrentPageId } = usePageNavigation()
  const [open, setOpen] = useState(false)
  const [showJobCenter, setShowJobCenter] = useState(false)
  const [showClipboard, setShowClipboard] = useState(false)
  const [showRecents, setShowRecents] = useState(false)
  const [recentIds, setRecentIds] = useState<string[]>(readRecentApps)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [systemReachable, setSystemReachable] = useState<boolean | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [now, setNow] = useState(() => new Date())
  const [powerConfirmation, setPowerConfirmation] = useState<'reboot' | null>(null)
  const [powerPending, setPowerPending] = useState(false)
  const { can } = useOsPermissions()
  const { user, logout } = useAuth()
  const activeJobCount = useActiveSystemJobCount()
  const { windows, snapWindow, toggleMaximize } = useOsWindows()
  const { entities } = useEntityStore()
  const [activeDownloads, setActiveDownloads] = useState<Array<{ id: string; name: string; progress: number }>>([])
  useClipboardCapture()

  // Active download jobs for the Control Center (Package 8).
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await authFetch('/api/jobs')
        if (!res.ok) return
        const data = await res.json() as { jobs?: Array<{ id: string; name: string; status: string; progress: number }> }
        setActiveDownloads((data.jobs || [])
          .filter((job) => job.status === 'running' || job.status === 'queued')
          .slice(0, 2))
      } catch {
        // offline
      }
    }
    void refresh()
    const id = window.setInterval(refresh, 10_000)
    return () => window.clearInterval(id)
  }, [])

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
    const clock = window.setInterval(() => setNow(new Date()), 30_000)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.clearInterval(clock)
    }
  }, [])

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      // Spotlight (Ctrl/⌘+Space — registry-configured) → the command palette
      // listens for the toggle event (⌘K stays as a direct alias there).
      if (comboMatches(getCombo('spotlight'), event)) {
        event.preventDefault()
        window.dispatchEvent(new Event('iora:spotlight-toggle'))
        return
      }
      // Clipboard panel
      if (comboMatches(getCombo('clipboard'), event)) {
        event.preventDefault()
        setShowClipboard((value) => !value)
        setOpen(false)
        setShowJobCenter(false)
        return
      }
      // Task switcher (Alt+Tab)
      if (comboMatches(getCombo('task-switcher'), event)) {
        event.preventDefault()
        setShowRecents(true)
        setOpen(false)
        setShowJobCenter(false)
        setShowClipboard(false)
        return
      }
      // Lock session
      if (comboMatches(getCombo('lock'), event)) {
        event.preventDefault()
        window.dispatchEvent(new Event('iora:lock-session'))
        return
      }
      // Sleep mode
      if (comboMatches(getCombo('sleep'), event)) {
        event.preventDefault()
        setSleepMode(!sleepMode)
        return
      }
      // Snap shortcuts (Alt+Arrow) act on the top-most floating window on
      // the desktop — desktop-style window management from anywhere.
      const snapAction = [
        ['snap-left', 'left'],
        ['snap-right', 'right'],
        ['snap-maximize', 'maximize'],
        ['snap-restore', 'window'],
      ] as const
      const snap = snapAction.find(([id]) => comboMatches(getCombo(id), event))
      if (snap) {
        event.preventDefault()
        const [_, layout] = snap
        const top = windows
          .filter((w) => w.layout !== 'split-left' && w.layout !== 'split-right' && !w.minimized)
          .sort((a, b) => b.z - a.z)[0]
        if (!top) return
        if (layout === 'maximize') toggleMaximize(top.pageId)
        else snapWindow(top.pageId, layout)
        return
      }
      if (event.key === 'Escape') {
        setShowRecents(false)
        setOpen(false)
        setShowJobCenter(false)
        setShowClipboard(false)
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [windows, snapWindow, toggleMaximize, sleepMode, setSleepMode])

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

  const mediaPlayers = (entities || [])
    .filter((entity) => entity.entity_id.startsWith('media_player.'))
    .filter((entity) => entity.state === 'playing' || entity.state === 'paused' || entity.state === 'idle')
    .slice(0, 2)

  const toggleMediaPlayer = async (entityId: string) => {
    try {
      await authFetch('/api/services/media_player/media_play_pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Action-Intent': 'control-center' },
        body: JSON.stringify({ entity_id: entityId }),
      })
    } catch {
      // ignore
    }
  }

  const memoryPercent = stats?.memory_total_bytes
    ? Math.round((stats.memory_used_bytes / stats.memory_total_bytes) * 100)
    : 0

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[74] flex justify-center px-3 pt-2">
        <div className="pointer-events-auto flex w-full max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-full border border-white/10 bg-background/70 px-1.5 py-1 shadow-xl shadow-black/15 backdrop-blur-2xl">
          <span className="flex shrink-0 items-center gap-2 pl-2 pr-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-[10px] font-bold text-accent">I</span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/60 sm:inline">ORA OS</span>
          </span>
          <span className="h-4 w-px bg-foreground/10" aria-hidden="true" />
          <span className="px-2 text-[11px] font-medium tabular-nums text-foreground/60">
            {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="min-w-0 flex-1" aria-hidden="true" />

          <button
            type="button"
            onClick={() => {
              setShowClipboard((value) => !value)
              setOpen(false)
              setShowJobCenter(false)
            }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-ring ${showClipboard ? 'bg-foreground/12 text-foreground' : ''}`}
            aria-label={t('clipboard.title')}
            aria-expanded={showClipboard}
            title={t('clipboard.shortcutHint')}
          >
            <ClipboardText size={17} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowJobCenter((value) => !value)
              setOpen(false)
              setShowClipboard(false)
            }}
            className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-ring ${showJobCenter ? 'bg-foreground/12 text-foreground' : ''}`}
            aria-label={t('jobs.title')}
            aria-expanded={showJobCenter}
            title={t('jobs.title')}
          >
            <ListBullets size={17} weight="bold" />
            {activeJobCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white shadow">
                {activeJobCount > 9 ? '9+' : activeJobCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen((value) => !value)
              setShowJobCenter(false)
              setShowClipboard(false)
            }}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-ring ${open ? 'bg-foreground/12 text-foreground' : ''}`}
            aria-label={t('os.shell.openQuickSettings')}
            aria-expanded={open}
            title={t('os.shell.openQuickSettings')}
          >
            {online ? <WifiHigh size={17} weight="bold" /> : <WifiSlash size={17} weight="bold" />}
          </button>
        </div>
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
              className="glass-card fixed right-3 top-[calc(max(0.5rem,env(safe-area-inset-top))+3rem)] z-[57] w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-white/15 p-4 shadow-2xl sm:right-6 sm:top-[3.5rem]"
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

              {/* Now playing (Home Assistant media players) */}
              {mediaPlayers.length > 0 && (
                <div className="mb-3 rounded-2xl bg-foreground/5 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                    <MusicNotes size={12} />{t('os.shell.nowPlaying')}
                  </p>
                  {mediaPlayers.map((player) => {
                    const name = (player.attributes.friendly_name as string) || player.entity_id
                    const title = (player.attributes.media_title as string) || (player.attributes.media_artist as string) || ''
                    return (
                      <button
                        key={player.entity_id}
                        type="button"
                        onClick={() => void toggleMediaPlayer(player.entity_id)}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-foreground/8"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                          <Play size={13} weight="fill" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground/85">{name}</span>
                          {title && <span className="block truncate text-[10px] text-foreground/45">{title}</span>}
                        </span>
                        {player.state === 'playing' ? <Pause size={13} className="shrink-0 text-foreground/50" /> : <Play size={13} className="shrink-0 text-foreground/50" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Active downloads */}
              {activeDownloads.length > 0 && (
                <div className="mb-3 rounded-2xl bg-foreground/5 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
                    <DownloadSimple size={12} />{t('os.shell.downloads')}
                  </p>
                  {activeDownloads.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => { setOpen(false); setShowJobCenter(true) }}
                      className="w-full rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-foreground/8"
                    >
                      <span className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-foreground/85">{job.name}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-foreground/45">{job.progress}%</span>
                      </span>
                      <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-foreground/10">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }} />
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {powerConfirmation ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3">
                  <p className="text-xs font-semibold text-red-200">{t('os.shell.confirmReboot')}</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setPowerConfirmation(null)} className="flex-1 rounded-xl bg-foreground/8 px-3 py-2 text-xs">{t('common.cancel')}</button>
                    <button type="button" disabled={powerPending} onClick={executePowerAction} className="flex-1 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{t('common.confirm')}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {/* User row with logout */}
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-foreground/5 px-3 py-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-bold text-accent">
                      {(user?.displayName || user?.username || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/75">
                      {user?.displayName || user?.username || t('os.shell.guest')}
                    </span>
                    <button
                      type="button"
                      onClick={() => { logout(); setOpen(false) }}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-foreground/50 transition-colors hover:bg-foreground/10 hover:text-foreground"
                      title={t('os.shell.logout')}
                    >
                      <SignOut size={13} weight="bold" />
                      <span className="hidden sm:inline">{t('os.shell.logout')}</span>
                    </button>
                  </div>
                  {/* Reboot tucked behind a subtle icon button (shutdown lives in Settings) */}
                  {can('os.power') && (
                    <button
                      type="button"
                      onClick={() => setPowerConfirmation('reboot')}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/5 text-foreground/45 transition-colors hover:bg-foreground/10 hover:text-foreground"
                      title={t('os.shell.reboot')}
                    >
                      <ArrowClockwise size={15} />
                    </button>
                  )}
                </div>
              )}

              <p className="mt-3 text-center text-[10px] text-foreground/30">
                {stats ? `${stats.os_name} ${stats.os_version}` : t('os.shell.noSystemData')} · {theme}
              </p>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <JobCenterPanel open={showJobCenter} onClose={() => setShowJobCenter(false)} />
      <ClipboardManager open={showClipboard} onClose={() => setShowClipboard(false)} />

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
