import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DUR_PAGE, EASE_OS, MOTION_PANEL } from '@/lib/motion'
import {
  ArrowClockwise,
  ArrowsIn,
  BatteryCharging,
  Bell,
  CaretRight,
  ClipboardText,
  Cpu,
  Gear,
  LockKey,
  Moon,
  Power,
  SquaresFour,
  WifiHigh,
  WifiSlash,
  SignOut,
  Play,
  Pause,
  Plus,
  MusicNotes,
  DownloadSimple,
  X,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { useTheme } from '@/contexts/ThemeContext'
import { authFetch } from '@/lib/authHelpers'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useEntityStore } from '@/hooks/useEntityStore'
import { useClock } from '@/hooks/useClock'
import { JobCenterPanel, useActiveSystemJobCount } from '@/components/JobCenterPanel'
import { ClipboardManager, useClipboardCapture } from '@/components/ClipboardManager'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { RumahlMark } from '@/components/RumahlMark'
import { comboMatches, getCombo } from '@/lib/shortcutRegistry'
import { useShellMode } from '@/hooks/useShellMode'
import { DockClock } from '@/components/DockClock'
import { ShellModeSwitcher } from '@/components/ShellModeSwitcher'

interface SystemStats {
  cpu_usage_percent: number
  memory_total_bytes: number
  memory_used_bytes: number
  uptime_seconds: number
  hostname: string
  os_name: string
  os_version: string
}

const RECENT_APPS_KEY = 'rumahl-os-recent-apps'
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
  const { t, i18n } = useTranslation()
  const { theme, sleepMode, setSleepMode } = useTheme()
  const { resolvedMode } = useShellMode()
  const { currentPageId, pages, setCurrentPageId } = usePageNavigation()
  const [open, setOpen] = useState(false)
  const [showJobCenter, setShowJobCenter] = useState(false)
  const [showClipboard, setShowClipboard] = useState(false)
  const [showRecents, setShowRecents] = useState(false)
  const [switcherIndex, setSwitcherIndex] = useState(0)
  const [recentIds, setRecentIds] = useState<string[]>(readRecentApps)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [systemReachable, setSystemReachable] = useState<boolean | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [powerConfirmation, setPowerConfirmation] = useState<'reboot' | null>(null)
  const [powerPending, setPowerPending] = useState(false)
  const quickSettingsTriggerRef = useRef<HTMLButtonElement>(null)
  const quickSettingsPanelRef = useRef<HTMLElement>(null)
  const { can } = useOsPermissions()
  const { user, logout } = useAuth()
  const activeJobCount = useActiveSystemJobCount()
  const { windows, workspaces, activeWorkspaceId, createWorkspace, removeWorkspace, switchWorkspace, snapWindow, toggleMaximize, immersivePageId, setImmersive, closeWindow, minimizeWindow, focusWindow } = useOsWindows()

  // In immersive (fullscreen) the top bar auto-hides and slides in when the
  // pointer hits the top edge (macOS-style).
  const [barVisible, setBarVisible] = useState(true)
  const hideTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!immersivePageId) { setBarVisible(true); return }
    const scheduleHide = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => setBarVisible(false), 2500)
    }
    const onMouseMove = (event: MouseEvent) => {
      if (event.clientY < 64) { setBarVisible(true); scheduleHide() }
    }
    window.addEventListener('mousemove', onMouseMove)
    scheduleHide()
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [immersivePageId])
  const { entities } = useEntityStore()
  const [activeDownloads, setActiveDownloads] = useState<Array<{ id: string; name: string; progress: number }>>([])
  useClipboardCapture()

  const closeQuickSettings = useCallback(() => {
    setOpen(false)
    window.requestAnimationFrame(() => quickSettingsTriggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      quickSettingsPanelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

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
  const activeWindows = useMemo(
    () => windows.filter((item) => item.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, windows],
  )
  const switcherApps = useMemo(() => {
    const openApps = [...activeWindows]
      .filter((item) => item.pageId)
      .sort((a, b) => b.z - a.z)
      .map((item) => appByPageId.get(item.pageId as string))
      .filter((app): app is OsAppDefinition => Boolean(app))
    const seen = new Set(openApps.map((app) => app.pageId))
    return [...openApps, ...recentApps.filter((app) => !seen.has(app.pageId))].slice(0, MAX_RECENT_APPS)
  }, [activeWindows, appByPageId, recentApps])

  const selectWorkspace = useCallback((workspaceId: number) => {
    const target = windows
      .filter((item) => item.workspaceId === workspaceId && item.pageId && !item.minimized)
      .sort((a, b) => b.z - a.z)[0]
    switchWorkspace(workspaceId)
    setCurrentPageId(target?.pageId || 'launcher')
    setShowRecents(false)
  }, [setCurrentPageId, switchWorkspace, windows])

  const cycleWorkspace = useCallback((direction: -1 | 1) => {
    const currentIndex = workspaces.indexOf(activeWorkspaceId)
    const nextIndex = (currentIndex + direction + workspaces.length) % workspaces.length
    selectWorkspace(workspaces[nextIndex])
  }, [activeWorkspaceId, selectWorkspace, workspaces])

  useEffect(() => {
    if (currentPageId === 'launcher') return
    setRecentIds((current) => {
      const next = [currentPageId, ...current.filter((id) => id !== currentPageId)].slice(0, MAX_RECENT_APPS)
      localStorage.setItem(RECENT_APPS_KEY, JSON.stringify(next))
      window.dispatchEvent(new Event('rumahl:recents-changed'))
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
      // Spotlight (Ctrl/⌘+Space — registry-configured) → the command palette
      // listens for the toggle event (⌘K stays as a direct alias there).
      if (comboMatches(getCombo('spotlight'), event)) {
        event.preventDefault()
        window.dispatchEvent(new Event('rumahl:spotlight-toggle'))
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
        if (showRecents) {
          setSwitcherIndex((current) => switcherApps.length ? (current + 1) % switcherApps.length : 0)
        } else {
          setSwitcherIndex(0)
          setShowRecents(true)
        }
        setOpen(false)
        setShowJobCenter(false)
        setShowClipboard(false)
        return
      }
      if (comboMatches(getCombo('workspace-left'), event)) {
        event.preventDefault()
        cycleWorkspace(-1)
        return
      }
      if (comboMatches(getCombo('workspace-right'), event)) {
        event.preventDefault()
        cycleWorkspace(1)
        return
      }
      // Lock session
      if (comboMatches(getCombo('lock'), event)) {
        event.preventDefault()
        window.dispatchEvent(new Event('rumahl:lock-session'))
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
          .filter((w) => w.workspaceId === activeWorkspaceId && w.layout !== 'split-left' && w.layout !== 'split-right' && !w.minimized)
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
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!showRecents || (event.key !== 'Alt' && event.key !== 'Meta')) return
      const selected = switcherApps[switcherIndex]
      if (!selected) return
      setCurrentPageId(selected.pageId)
      focusWindow(selected.pageId)
      setShowRecents(false)
    }
    window.addEventListener('keydown', handleKeyboard)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyboard)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [windows, snapWindow, toggleMaximize, sleepMode, setSleepMode, showRecents, switcherApps, switcherIndex, setCurrentPageId, focusWindow, activeWorkspaceId, cycleWorkspace])

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
        body: JSON.stringify({ delay_seconds: 5, reason: 'Requested from rumahl OS system shell' }),
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
      <AnimatePresence>
        {barVisible && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            transition={{ duration: DUR_PAGE, ease: EASE_OS }}
            className="rumahl-system-bar pointer-events-none fixed inset-x-0 top-0 z-[74] flex items-center justify-between px-3"
            style={{ height: 'var(--topbar-height, 2rem)' }}
          >
        <div className="rumahl-topbar-mix pointer-events-auto flex min-w-0 items-center gap-1 text-[11px] font-medium">
          {immersivePageId ? (
            <>
              <button type="button" onClick={() => { setImmersive(null); setCurrentPageId('launcher') }} className="rumahl-topbar-action flex h-7 w-7 items-center justify-center" title={t('os.window.exitFullscreen')}><ArrowsIn size={15} weight="bold" /></button>
              <button type="button" onClick={() => { closeWindow(immersivePageId); setImmersive(null); setCurrentPageId('launcher') }} className="rumahl-topbar-action flex h-7 w-7 items-center justify-center hover:!bg-red-500/15 hover:!text-red-400" title={t('os.window.close')}><X size={15} weight="bold" /></button>
            </>
          ) : (
            <>
            <span className="hidden items-center gap-1.5 font-semibold tracking-[0.1em] sm:inline-flex">
              <RumahlMark className="h-3.5 text-foreground/85" />
              rumahl OS
            </span>
            </>
          )}
        </div>
        <div className="rumahl-topbar-actions rumahl-topbar-mix pointer-events-auto flex shrink-0 items-center gap-0.5">
          <button
            ref={quickSettingsTriggerRef}
            type="button"
            onClick={() => { setShowClipboard((value) => !value); setOpen(false); setShowJobCenter(false) }}
            className={`rumahl-topbar-action flex h-7 w-7 shrink-0 items-center justify-center focus-ring ${showClipboard ? 'is-active' : ''}`}
            aria-label={t('clipboard.title')}
            aria-expanded={showClipboard}
            title={t('clipboard.shortcutHint')}
          >
            <ClipboardText size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => { setShowJobCenter((value) => !value); setOpen(false); setShowClipboard(false) }}
            className={`rumahl-topbar-action relative flex h-7 w-7 shrink-0 items-center justify-center focus-ring ${showJobCenter ? 'is-active' : ''}`}
            aria-label={t('notifications.title')}
            aria-expanded={showJobCenter}
            title={t('notifications.title')}
          >
            <Bell size={15} weight="bold" />
            {activeJobCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-bold text-white shadow">
                {activeJobCount > 9 ? '9+' : activeJobCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setOpen((value) => !value); setShowJobCenter(false); setShowClipboard(false) }}
            className={`rumahl-topbar-action flex h-7 w-7 shrink-0 items-center justify-center focus-ring ${open ? 'is-active' : ''}`}
            aria-label={t('os.shell.openQuickSettings')}
            aria-expanded={open}
            title={t('os.shell.openQuickSettings')}
          >
            {online ? <WifiHigh size={15} weight="bold" /> : <WifiSlash size={15} weight="bold" />}
          </button>

          {/* Shell-mode switcher: desktop mode → joins the bottom bar next to
              the clock; launcher mode → sits top-right so you can switch to
              the desktop. */}
          {!immersivePageId && <ShellModeSwitcher />}
          {resolvedMode === 'desktop' && !immersivePageId && <DockClock />}
        </div>
          </motion.div>
        )}
      </AnimatePresence>

      {resolvedMode === 'desktop' && !immersivePageId && (
        <nav className="rumahl-workspace-strip" aria-label={t('os.workspaces.title')}>
          {workspaces.map((workspaceId, index) => {
            const count = windows.filter((item) => item.workspaceId === workspaceId).length
            const active = workspaceId === activeWorkspaceId
            return (
              <span key={workspaceId} className={`rumahl-workspace-item ${active ? 'is-active' : ''}`}>
                <button type="button" onClick={() => selectWorkspace(workspaceId)} aria-current={active ? 'page' : undefined} aria-label={t('os.workspaces.open', { number: index + 1 })}>
                  <strong>{index + 1}</strong>
                  {count > 0 && <i aria-hidden="true">{count}</i>}
                </button>
                {active && workspaces.length > 1 && (
                  <button type="button" className="rumahl-workspace-remove" onClick={() => removeWorkspace(workspaceId)} aria-label={t('os.workspaces.remove', { number: index + 1 })} title={t('os.workspaces.remove', { number: index + 1 })}>
                    <X size={10} />
                  </button>
                )}
              </span>
            )
          })}
          <button type="button" className="rumahl-workspace-add" onClick={createWorkspace} disabled={workspaces.length >= 4} aria-label={t('os.workspaces.add')} title={t('os.workspaces.add')}>
            <Plus size={12} weight="bold" />
          </button>
        </nav>
      )}

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
              onClick={closeQuickSettings}
            />
            <motion.aside
              ref={quickSettingsPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('os.shell.quickSettings')}
              tabIndex={-1}
              initial={{ opacity: 0, y: -14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={MOTION_PANEL}
              className="rumahl-quick-settings glass-card fixed right-3 top-[calc(max(0.5rem,env(safe-area-inset-top))+3rem)] z-[65] w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-3xl border border-white/15 p-4 shadow-2xl sm:right-6 sm:top-[3.5rem]"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeQuickSettings()
                  return
                }
                const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
                if (!controls.length) return
                const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement)
                if (event.key === 'Tab') {
                  const nextIndex = event.shiftKey
                    ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
                    : (currentIndex >= controls.length - 1 ? 0 : currentIndex + 1)
                  event.preventDefault()
                  controls[nextIndex].focus()
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
                  controls[(Math.max(0, currentIndex) + direction + controls.length) % controls.length].focus()
                } else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  controls[event.key === 'Home' ? 0 : controls.length - 1].focus()
                }
              }}
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

              <div className="grid grid-cols-2 gap-2.5">
                <button type="button" onClick={() => openApp('launcher')} className="rounded-[1.35rem] bg-foreground/6 p-4 text-left transition-colors hover:bg-foreground/10">
                  <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-accent/15 text-accent"><SquaresFour size={20} weight="fill" /></span>
                  <span className="block text-xs font-semibold">{t('os.shell.apps')}</span>
                </button>
                <button type="button" onClick={() => setSleepMode(!sleepMode)} className={`rounded-[1.35rem] p-4 text-left transition-colors ${sleepMode ? 'bg-accent text-white' : 'bg-foreground/6 hover:bg-foreground/10'}`}>
                  <span className={`mb-3 grid h-10 w-10 place-items-center rounded-full ${sleepMode ? 'bg-white/25 text-white' : 'bg-foreground/10 text-foreground/70'}`}><Moon size={20} weight="fill" /></span>
                  <span className="block text-xs font-semibold">{sleepMode ? t('os.shell.sleepOn') : t('os.shell.sleepOff')}</span>
                </button>
                <button type="button" onClick={() => openApp('settings')} className="rounded-[1.35rem] bg-foreground/6 p-4 text-left transition-colors hover:bg-foreground/10">
                  <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-foreground/10 text-foreground/70"><Gear size={20} weight="fill" /></span>
                  <span className="block text-xs font-semibold">{t('os.apps.settings.name')}</span>
                </button>
                <button type="button" onClick={() => { window.dispatchEvent(new Event('rumahl:lock-session')); setOpen(false) }} className="rounded-[1.35rem] bg-foreground/6 p-4 text-left transition-colors hover:bg-foreground/10">
                  <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-foreground/10 text-foreground/70"><LockKey size={20} weight="fill" /></span>
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
            className="rumahl-task-switcher-backdrop fixed inset-0 z-[70] flex items-end justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRecents(false)}
          >
            <motion.div
              initial={{ y: 24, scale: 0.96 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 16, scale: 0.98 }}
              transition={MOTION_PANEL}
              className="rumahl-task-switcher mb-14 w-full max-w-3xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="rumahl-task-switcher-header">
                <div>
                  <h2>{t('os.shell.recentApps')}</h2>
                  <p>{t('os.shell.taskSwitcherHint')}</p>
                </div>
                <button type="button" onClick={() => setShowRecents(false)} className="rumahl-task-switcher-close" aria-label={t('common.close')}>
                  <X size={14} />
                </button>
              </div>
              <div className="rumahl-task-switcher-apps">
                {(switcherApps.length ? switcherApps : apps.slice(0, 6)).map((app, index) => {
                  const Icon = app.icon
                  const name = app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName
                  const openWindow = windows.find((item) => item.workspaceId === activeWorkspaceId && item.pageId === app.pageId)
                  const isOpen = Boolean(openWindow)
                  const isFocused = index === switcherIndex
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onMouseEnter={() => setSwitcherIndex(index)}
                      onFocus={() => setSwitcherIndex(index)}
                      onClick={() => openApp(app.pageId)}
                      className={`rumahl-task-switcher-app ${isFocused ? 'is-focused' : ''}`}
                      aria-selected={isFocused}
                    >
                      <span className="rumahl-task-switcher-window">
                        <span className="rumahl-task-switcher-window-bar">
                          <span style={{ '--app-accent': app.accent } as React.CSSProperties} />
                          <i />
                        </span>
                        <span className="rumahl-task-switcher-window-content" style={{ '--app-accent': app.accent } as React.CSSProperties}>
                          <span className="rumahl-task-switcher-app-icon">
                            {app.iconUrl ? <img src={app.iconUrl} alt="" /> : <Icon size={22} weight="duotone" />}
                          </span>
                        </span>
                      </span>
                      <span className="rumahl-task-switcher-app-copy">
                        <strong>{name}</strong>
                        <small>{openWindow?.minimized ? t('os.window.minimized') : isOpen ? t('os.window.open') : t('os.shell.recentApps')}</small>
                      </span>
                      {isOpen && <span className="rumahl-task-switcher-running" aria-hidden="true" />}
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
