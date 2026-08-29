import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { DUR_SLOW, EASE_SOFT, SPRING_SOFT } from '@/lib/motion'
import { ArrowSquareOut, Check, PushPin, SquaresFour } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { isAppAllowed } from '@/lib/userRestrictions'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { DOCK_PINS_EVENT_NAME, isDockPinned, readDockPins, toggleDockPin } from '@/lib/dockPrefs'
import { getPreferredLaunchMode, setPreferredLaunchMode } from '@/lib/launchModes'
import { closeAllContextMenus, useCloseOnOtherMenu } from '@/lib/contextMenus'
import { useShellMode } from '@/hooks/useShellMode'
import { DesktopLauncherOverlay } from '@/components/DesktopLauncherOverlay'
import { RumahlMark } from '@/components/RumahlMark'

const RECENT_APPS_KEY = 'rumahl-os-recent-apps'
const MAX_RECENT_IN_DOCK = 3

function readRecentIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_APPS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

export function OsDock() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { currentPageId, pages, setCurrentPageId } = usePageNavigation()
  const { windows, openWindow, openSplit, setImmersive, focusWindow, immersivePageId } = useOsWindows()
  const { installedApps } = useInstalledApps()
  const { can } = useOsPermissions()
  const { resolvedMode } = useShellMode()
  const [pinnedIds, setPinnedIds] = useState<string[]>(readDockPins)
  const [recentIds, setRecentIds] = useState<string[]>(readRecentIds)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const reducedMotion = useReducedMotion()
  const [launcherOpen, setLauncherOpen] = useState(false)
  useCloseOnOtherMenu(() => setMenuId(null))
  // Close the launcher overlay on Escape.
  useEffect(() => {
    if (!launcherOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLauncherOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [launcherOpen])

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    const pageIds = new Set([...SYSTEM_OS_APPS, ...pageApps].map((app) => app.pageId))
    const extra = installedApps.filter((app) => !pageIds.has(app.pageId))
    return [...SYSTEM_OS_APPS, ...pageApps, ...extra]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || can(app.requiredPermission))
      .filter((app) => isAppAllowed(user, app.id))
  }, [can, pages, user?.isAdmin, installedApps, user])

  const appById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps])
  const appByPageId = useMemo(() => {
    const m = new Map<string, OsAppDefinition>()
    for (const app of apps) m.set(app.pageId, app)
    return m
  }, [apps])

  // Keep pins + recents fresh when quick actions or the shell update them.
  useEffect(() => {
    const refreshPins = () => setPinnedIds(readDockPins())
    const refreshRecents = () => setRecentIds(readRecentIds())
    window.addEventListener(DOCK_PINS_EVENT_NAME, refreshPins)
    window.addEventListener('rumahl:recents-changed', refreshRecents)
    window.addEventListener('focus', refreshRecents)
    return () => {
      window.removeEventListener(DOCK_PINS_EVENT_NAME, refreshPins)
      window.removeEventListener('rumahl:recents-changed', refreshRecents)
      window.removeEventListener('focus', refreshRecents)
    }
  }, [])

  const launcherApp: OsAppDefinition = {
    id: 'launcher',
    pageId: 'launcher',
    fallbackName: t('os.shell.apps'),
    icon: SquaresFour,
    kind: 'system',
    accent: 'oklch(0.65 0.2 285)',
    order: -1,
  }

  const pinned = pinnedIds.map((id) => appById.get(id)).filter((app): app is OsAppDefinition => Boolean(app))
  const recents = recentIds
    .map((id) => appById.get(id))
    .filter((app): app is OsAppDefinition => Boolean(app))
    .filter((app) => !pinned.some((item) => item.id === app.id))
    .slice(0, MAX_RECENT_IN_DOCK)

  // All open OS windows (floating + split panes), so the taskbar always shows
  // every running app — not just pinned/recent ones.
  const openApps = useMemo(() => {
    const seen = new Set<string>()
    const result: OsAppDefinition[] = []
    for (const w of windows) {
      if (!w.pageId || seen.has(w.pageId)) continue
      const app = appByPageId.get(w.pageId)
      if (app) { seen.add(w.pageId); result.push(app) }
    }
    return result
  }, [windows, appByPageId])

  // Taskbar order: launcher, then pinned, then the open apps — pinned and open
  // are never duplicated (open apps that are already pinned stay pinned).
  const taskbarApps = useMemo(() => {
    const known = new Set(pinned.map((app) => app.id))
    const rest: OsAppDefinition[] = []
    for (const app of openApps) {
      if (known.has(app.id)) continue
      known.add(app.id)
      rest.push(app)
    }
    return [...pinned, ...rest]
  }, [pinned, openApps])

  // Flat dock order for the macOS-style neighbor magnification: the
  // hovered icon grows, its direct neighbors grow slightly less, the rest
  // stay at rest. Index 0 = launcher, then pinned, then open/recent.
  const dockIds = useMemo(
    () => ['launcher', ...taskbarApps.map((app) => app.id), ...recents.filter((app) => !taskbarApps.some((x) => x.id === app.id)).map((app) => app.id)],
    [taskbarApps, recents]
  )
  const hoverIdx = hoverId ? dockIds.indexOf(hoverId) : -1
  // Magnification is a launcher (macOS dock) affordance only. In desktop mode
  // the dock behaves like a Windows taskbar: no scaling, always a flat row.
  const magnification = (index: number) => {
    if (resolvedMode !== 'launcher' || reducedMotion || hoverIdx < 0) return 1
    if (index === hoverIdx) return 1.22
    if (Math.abs(index - hoverIdx) === 1) return 1.08
    return 1
  }

  const openApp = (pageId: string) => {
    setMenuId(null)
    setCurrentPageId(pageId)
  }

  const handleItemClick = (app: OsAppDefinition) => {
    setMenuId(null)
    // Launcher mode (iOS/Android): always fullscreen, no windows.
    if (resolvedMode === 'launcher') {
      if (app.pageId === 'launcher') { setLauncherOpen(true); return }
      setCurrentPageId(app.pageId)
      return
    }
    // Desktop mode (Windows-style taskbar): the URL is the source of truth for
    // the focused app. Setting the URL drives the window manager (App syncs
    // openWindow/focusWindow), so a click opens / focuses / un-minimizes the
    // app and keeps the address bar in sync.
    if (app.pageId === 'launcher') {
      setLauncherOpen(true)
      return
    }
    if (app.pageId === currentPageId) {
      // Already the focused app — ensure its window is raised/restored.
      if (immersivePageId === app.pageId) return
      focusWindow(app.pageId)
      return
    }
    setCurrentPageId(app.pageId)
  }

  const getName = (app: OsAppDefinition) => (app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName)

  const renderItem = (app: OsAppDefinition, pinnedApp: boolean, index = 0) => {
    const Icon = app.icon
    const active = app.pageId === currentPageId
    const name = getName(app)
    const menuOpen = menuId === app.id
    const isHovered = hoverId === app.id
    const scale = magnification(index)
    const openWin = windows.find((w) => w.pageId === app.pageId)
    const isMinimized = Boolean(openWin?.minimized)
    return (
      <motion.div
        key={app.id}
        className="relative"
        onMouseEnter={() => setHoverId(app.id)}
        onMouseLeave={() => setHoverId(null)}
        initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.88 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.3 + index * 0.05, ...SPRING_SOFT }}
      >
        <button
          type="button"
          onClick={() => handleItemClick(app)}
          onContextMenu={(event) => {
            event.preventDefault()
            closeAllContextMenus()
            setMenuId(menuOpen ? null : app.id)
            setMenuPos({ x: event.clientX, y: event.clientY })
          }}
          className="rumahl-dock-item group relative flex touch-manipulation flex-col items-center rounded-2xl p-0.5 focus-ring"
          aria-label={name}
        >
          <span
            className={`rumahl-app-icon flex h-11 w-11 items-center justify-center overflow-hidden text-white transition-transform duration-200 will-change-transform sm:h-12 sm:w-12 ${app.id === 'launcher' ? 'border-0 bg-transparent shadow-none' : app.iconUrl ? 'border-0 bg-transparent shadow-none' : ''}`}
            style={app.iconUrl
              ? { transform: `translateY(${resolvedMode === 'launcher' && isHovered ? -4 : 0}px) scale(${scale})` }
              : app.id === 'launcher'
                ? { transform: `translateY(${resolvedMode === 'launcher' && isHovered ? -4 : 0}px) scale(${scale})` }
                : {
                    '--app-accent': app.accent,
                    transform: `translateY(${resolvedMode === 'launcher' && isHovered ? -4 : 0}px) scale(${scale})`,
                  } as React.CSSProperties}
          >
            {app.iconUrl ? (
              <img src={app.iconUrl} alt={app.fallbackName} className="h-full w-full object-contain p-0.5" />
            ) : app.id === 'launcher' ? (
              <RumahlMark className="h-6 w-6 text-foreground" />
            ) : (
              <Icon size={24} weight="duotone" />
            )}
          </span>
          <span className="pointer-events-none absolute -top-9 left-1/2 z-50 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg border border-foreground/10 bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-xl backdrop-blur-md transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
            {name}
          </span>
          <AnimatePresence>
            {active && (
              <motion.span
                initial={{ opacity: 0, width: 4 }}
                animate={{ opacity: 1, width: isHovered ? 16 : 4 }}
                exit={{ opacity: 0 }}
                className="mt-1 h-1 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]"
              />
            )}
          </AnimatePresence>
          {openWin && (
            <span
              className={`absolute right-0.5 top-0.5 h-2 w-2 rounded-full ${isMinimized ? 'bg-foreground/40' : 'bg-accent shadow-[0_0_8px_var(--accent)]'}`}
              aria-label={isMinimized ? t('os.window.minimized') : t('os.window.open')}
            />
          )}
        </button>

        <AnimatePresence>
          {menuOpen && (
            <>
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMenuId(null)}
                className="fixed inset-0 z-40 cursor-default"
                aria-label={t('common.close')}
              />
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                className="fixed z-[88] w-44 overflow-hidden rounded-2xl border border-foreground/12 bg-background/95 p-1.5 text-foreground shadow-2xl backdrop-blur-xl"
                style={{ left: Math.min(menuPos.x, window.innerWidth - 200), top: Math.min(menuPos.y + 8, window.innerHeight - 300) }}
                onClick={(event) => event.stopPropagation()}
              >
                <button type="button" onClick={() => openApp(app.pageId)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                  <ArrowSquareOut size={16} className="text-foreground/60" />
                  {t('os.dock.open')}
                </button>
                {app.openUrl && (
                  <button type="button" onClick={() => { window.open(app.openUrl, '_blank', 'noopener,noreferrer'); setMenuId(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                    <ArrowSquareOut size={16} className="text-foreground/60" />
                    {t('apps.appStore.openPort')}
                  </button>
                )}
                {app.id !== 'launcher' && (
                  <>
                    <button type="button" onClick={() => { openWindow(app.pageId); setPreferredLaunchMode(app.pageId, 'window'); setCurrentPageId('launcher'); setMenuId(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                      <SquaresFour size={16} className="text-foreground/60" />
                      <span className="flex-1">{t('os.window.asWindow')}</span>
                      {getPreferredLaunchMode(app.pageId) === 'window' && <Check size={14} className="text-accent" />}
                    </button>
                    <button type="button" onClick={() => { openSplit(app.pageId, 'split-left'); setPreferredLaunchMode(app.pageId, 'split-left'); setCurrentPageId('launcher'); setMenuId(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                      <SquaresFour size={16} className="text-foreground/60" />
                      <span className="flex-1">{t('os.window.splitLeft')}</span>
                      {getPreferredLaunchMode(app.pageId) === 'split-left' && <Check size={14} className="text-accent" />}
                    </button>
                    <button type="button" onClick={() => { openSplit(app.pageId, 'split-right'); setPreferredLaunchMode(app.pageId, 'split-right'); setCurrentPageId('launcher'); setMenuId(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                      <SquaresFour size={16} className="text-foreground/60" />
                      <span className="flex-1">{t('os.window.splitRight')}</span>
                      {getPreferredLaunchMode(app.pageId) === 'split-right' && <Check size={14} className="text-accent" />}
                    </button>
                    <button type="button" onClick={() => { setImmersive(app.pageId); setPreferredLaunchMode(app.pageId, 'immersive'); setCurrentPageId(app.pageId); setMenuId(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                      <SquaresFour size={16} className="text-foreground/60" />
                      <span className="flex-1">{t('os.window.immersive')}</span>
                      {getPreferredLaunchMode(app.pageId) === 'immersive' && <Check size={14} className="text-accent" />}
                    </button>
                  </>
                )}
                <div className="my-1 h-px bg-foreground/8" />
                {app.id !== 'launcher' && (
                  <button
                    type="button"
                    onClick={() => {
                      toggleDockPin(app.id)
                      setMenuId(null)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8"
                  >
                    <PushPin size={16} className="text-foreground/60" />
                    {pinnedApp ? t('os.dock.unpin') : t('os.dock.pin')}
                  </button>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </motion.div>
    )
  }

  return (
    <div className="rumahl-dock-shell fixed bottom-[max(0.9rem,env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 select-none">
      <motion.div
        initial={reducedMotion ? false : { y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: DUR_SLOW, ease: EASE_SOFT, delay: 0.2 }}
        className="flex items-end gap-1.5 rounded-[1.35rem] border border-foreground/10 bg-background/55 px-2.5 py-2 shadow-xl shadow-black/20 backdrop-blur-2xl"
      >
        {renderItem(launcherApp, false, 0)}
        {taskbarApps.map((app, index) => renderItem(app, pinned.some((p) => p.id === app.id), index + 1))}
        {recents.filter((app) => !taskbarApps.some((x) => x.id === app.id)).length > 0 && (
          <>
            <span className="mx-1 h-9 w-px self-center bg-foreground/12" aria-hidden="true" />
            <div className="hidden gap-1.5 sm:flex">{recents.filter((app) => !taskbarApps.some((x) => x.id === app.id)).map((app, index) => renderItem(app, false, index + 1 + taskbarApps.length))}</div>
          </>
        )}
      </motion.div>

      <DesktopLauncherOverlay
        open={launcherOpen}
        apps={apps}
        recent={recentIds}
        onOpenApp={(app) => { setLauncherOpen(false); handleItemClick(app) }}
        onOpenSettings={() => { setLauncherOpen(false); setCurrentPageId('settings') }}
        onClose={() => setLauncherOpen(false)}
      />
    </div>
  )
}
