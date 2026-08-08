import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowSquareOut, Check, PushPin, SquaresFour } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { DOCK_PINS_EVENT_NAME, isDockPinned, readDockPins, toggleDockPin } from '@/lib/dockPrefs'
import { getPreferredLaunchMode, setPreferredLaunchMode } from '@/lib/launchModes'

const RECENT_APPS_KEY = 'iora-os-recent-apps'
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
  const { windows, openWindow, openSplit, setImmersive, focusWindow } = useOsWindows()
  const { installedApps } = useInstalledApps()
  const { can } = useOsPermissions()
  const [pinnedIds, setPinnedIds] = useState<string[]>(readDockPins)
  const [recentIds, setRecentIds] = useState<string[]>(readRecentIds)
  const [menuId, setMenuId] = useState<string | null>(null)

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    const pageIds = new Set([...SYSTEM_OS_APPS, ...pageApps].map((app) => app.pageId))
    const extra = installedApps.filter((app) => !pageIds.has(app.pageId))
    return [...SYSTEM_OS_APPS, ...pageApps, ...extra]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || can(app.requiredPermission))
  }, [can, pages, user?.isAdmin, installedApps])

  const appById = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps])

  // Keep pins + recents fresh when quick actions or the shell update them.
  useEffect(() => {
    const refreshPins = () => setPinnedIds(readDockPins())
    const refreshRecents = () => setRecentIds(readRecentIds())
    window.addEventListener(DOCK_PINS_EVENT_NAME, refreshPins)
    window.addEventListener('iora:recents-changed', refreshRecents)
    window.addEventListener('focus', refreshRecents)
    return () => {
      window.removeEventListener(DOCK_PINS_EVENT_NAME, refreshPins)
      window.removeEventListener('iora:recents-changed', refreshRecents)
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

  const openApp = (pageId: string) => {
    setMenuId(null)
    setCurrentPageId(pageId)
  }

  const handleItemClick = (app: OsAppDefinition) => {
    setMenuId(null)
    if (app.openUrl) {
      setCurrentPageId(app.pageId)
      return
    }
    if (app.pageId === 'launcher') {
      setCurrentPageId('launcher')
      return
    }
    // Focus an already open window (desktop stays visible behind it).
    if (windows.some((w) => w.pageId === app.pageId)) {
      focusWindow(app.pageId)
      setCurrentPageId('launcher')
      return
    }
    // Fill an empty split pane when a split layout is active.
    const emptyPane = windows.find((w) => w.layout !== 'window' && !w.pageId)
    if (emptyPane) {
      openSplit(app.pageId, emptyPane.layout as 'split-left' | 'split-right')
      setCurrentPageId('launcher')
      return
    }
    // Launch in the user's preferred mode for this app.
    const mode = getPreferredLaunchMode(app.pageId)
    if (mode === 'window') {
      openWindow(app.pageId)
      setCurrentPageId('launcher')
    } else if (mode === 'split-left' || mode === 'split-right') {
      openSplit(app.pageId, mode)
      setCurrentPageId('launcher')
    } else if (mode === 'immersive') {
      setImmersive(app.pageId)
      setCurrentPageId(app.pageId)
    } else {
      setCurrentPageId(app.pageId)
    }
  }

  const getName = (app: OsAppDefinition) => (app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName)

  const renderItem = (app: OsAppDefinition, pinnedApp: boolean) => {
    const Icon = app.icon
    const active = app.pageId === currentPageId
    const name = getName(app)
    const menuOpen = menuId === app.id
    return (
      <div key={app.id} className="relative">
        <button
          type="button"
          onClick={() => handleItemClick(app)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenuId(menuOpen ? null : app.id)
          }}
          className="group relative flex touch-manipulation flex-col items-center rounded-2xl p-0.5 focus-ring"
          aria-label={name}
        >
          <span
            className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-[1.1rem] border border-white/15 text-white shadow-lg transition-transform duration-200 group-hover:-translate-y-1 group-hover:scale-110 sm:h-12 sm:w-12 ${active ? 'ring-2 ring-white/70' : ''}`}
            style={{ background: `linear-gradient(145deg, color-mix(in oklch, ${app.accent} 88%, white), color-mix(in oklch, ${app.accent} 70%, black))` }}
          >
            <Icon size={24} weight="duotone" />
          </span>
          <span className="pointer-events-none absolute -top-9 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-background/90 px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-xl backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100">
            {name}
          </span>
          <AnimatePresence>
            {active && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-1 h-1 w-1 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]"
              />
            )}
          </AnimatePresence>
          {windows.some((w) => w.pageId === app.pageId) && (
            <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" aria-label={t('os.window.open')} />
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
                className="absolute bottom-full left-1/2 z-50 mb-2 w-44 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/12 bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl"
              >
                <button type="button" onClick={() => openApp(app.pageId)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-foreground/8">
                  <ArrowSquareOut size={16} className="text-foreground/60" />
                  {t('os.dock.open')}
                </button>
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
      </div>
    )
  }

  return (
    <div className="fixed bottom-[max(0.9rem,env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 select-none">
      <div className="flex items-end gap-1.5 rounded-[1.75rem] border border-white/12 bg-background/60 px-3 py-2.5 shadow-2xl shadow-black/25 backdrop-blur-2xl">
        {renderItem(launcherApp, false)}
        {pinned.map((app) => renderItem(app, true))}
        {recents.length > 0 && (
          <>
            <span className="mx-1 h-9 w-px self-center bg-white/12" aria-hidden="true" />
            <div className="hidden gap-1.5 sm:flex">{recents.map((app) => renderItem(app, false))}</div>
          </>
        )}
      </div>
    </div>
  )
}
