import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { closeAllContextMenus, useCloseOnOtherMenu } from '@/lib/contextMenus'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, ArrowSquareOut, CaretRight, Check, Folder, PencilSimple, Play, PushPin, SquaresFour, Stop, Storefront, Trash, TrashSimple, Wrench, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { OsAppDefinition } from '@/lib/osAppRegistry'
import { isDockPinned, toggleDockPin } from '@/lib/dockPrefs'
import type { OsLaunchMode } from '@/contexts/OsWindowContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { authFetch } from '@/lib/authHelpers'
import { requestAppDetail, requestAppInStore } from '@/lib/appStoreHandoff'
import { startAppAndWatch } from '@/lib/appLifecycle'
import { confirmDialog } from '@/components/ui/confirmDialog'
import { AppInstallProgress } from '@/components/app/AppInstallProgress'
import type { InstallJobInfo } from '@/hooks/useInstalledApps'

export interface LauncherFolder {
  id: string
  name: string
  appIds: string[]
}

export type LauncherItem =
  | { type: 'app'; app: OsAppDefinition }
  | { type: 'folder'; folder: LauncherFolder }

export function buildLauncherItems(apps: OsAppDefinition[], folders: LauncherFolder[]): LauncherItem[] {
  const availableIds = new Set(apps.map((app) => app.id))
  const safeFolders = Array.isArray(folders) ? folders : []
  const normalizedFolders = safeFolders
    .map((folder) => ({ ...folder, appIds: (folder.appIds || []).filter((id) => availableIds.has(id)) }))
    .filter((folder) => folder.appIds.length > 0)
  const folderAppIds = new Set(normalizedFolders.flatMap((folder) => folder.appIds))
  return [
    ...normalizedFolders.map((folder): LauncherItem => ({ type: 'folder', folder })),
    ...apps.filter((app) => !folderAppIds.has(app.id)).map((app): LauncherItem => ({ type: 'app', app })),
  ]
}

function AppIcon({ app, compact = false }: { app: OsAppDefinition; compact?: boolean }) {
  const Icon = app.icon
  const size = compact ? 16 : 38
  return (
    <span
      className={`rumahl-app-icon relative flex shrink-0 items-center justify-center overflow-hidden text-white ${compact ? 'h-8 w-8 rounded-[0.65rem]' : 'h-20 w-20 rounded-[1.7rem]'} ${
        app.iconUrl ? 'border-0 bg-transparent shadow-none' : 'border border-white/15 shadow-lg'
      }`}
      style={app.iconUrl
        ? { boxShadow: 'none' }
        : { background: `linear-gradient(145deg, color-mix(in oklch, ${app.accent} 88%, white), color-mix(in oklch, ${app.accent} 72%, black))` }}
    >
      {!app.iconUrl && <span className="rumahl-app-icon-highlight absolute inset-0" />}
      {app.iconUrl ? (
        <img src={app.iconUrl} alt={app.fallbackName} className="h-full w-full object-contain p-1" />
      ) : Icon ? (
        <Icon size={size} weight="duotone" className="relative" />
      ) : null}
    </span>
  )
}

/** Small inline spinner for in-flight context-menu actions. */
function MenuSpinner() {
  return <span className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
}

export function LauncherAppGrid({
  items,
  apps,
  folders,
  editMode,
  onEditModeChange,
  onFoldersChange,
  onReorder,
  onOpenApp,
  getAppName,
  onLaunch,
  installJobs = [],
}: {
  items: LauncherItem[]
  apps: OsAppDefinition[]
  folders: LauncherFolder[]
  editMode: boolean
  onEditModeChange: (enabled: boolean) => void
  onFoldersChange: (folders: LauncherFolder[]) => void
  /** Mobile-OS style reorder: move the item with id `fromId` to `toId`'s position. */
  onReorder: (fromId: string, toId: string) => void
  onOpenApp: (app: OsAppDefinition) => void
  getAppName: (app: OsAppDefinition) => string
  /** Launches an app in a specific OS layout (fullscreen / window / split / immersive). */
  onLaunch: (app: OsAppDefinition, mode: OsLaunchMode) => void
  installJobs?: InstallJobInfo[]
}) {
  const { t } = useTranslation()
  const safeFolders = Array.isArray(folders) ? folders : []
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null)
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null)
  const dragJustHappenedRef = useRef(false)
  const [quickMenu, setQuickMenu] = useState<{ app: OsAppDefinition; x: number; y: number; pinned: boolean } | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState<{ x: number; y: number } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  useCloseOnOtherMenu(() => { setQuickMenu(null); setMoreOpen(false) })
  const { setCurrentPageId } = usePageNavigation()
  // Close the quick menu on any outside click / right-click (no backdrop, so
  // right-clicking another app opens its own menu instead). Clicks inside the
  // menu or its "More" flyout keep it open.
  useEffect(() => {
    if (!quickMenu) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || flyoutRef.current?.contains(target)) return
      setQuickMenu(null)
      setMoreOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setQuickMenu(null); setMoreOpen(false) } }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('contextmenu', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('contextmenu', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [quickMenu])
  const openFolder = safeFolders.find((folder) => folder.id === openFolderId)
  const folderApps = openFolder?.appIds.map((id) => apps.find((app) => app.id === id)).filter((app): app is OsAppDefinition => Boolean(app)) || []

  const updateFolder = (folderId: string, update: (folder: LauncherFolder) => LauncherFolder) => {
    onFoldersChange(safeFolders.map((folder) => folder.id === folderId ? update(folder) : folder))
  }

  const itemIdOf = (item: LauncherItem) => (item.type === 'app' ? item.app.id : item.folder.id)

  /** Unified drop: apps/folders swap positions; dragging an app onto a folder moves it in. */
  const handleDrop = (target: LauncherItem, event: React.DragEvent) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    const targetId = itemIdOf(target)
    dragJustHappenedRef.current = true
    window.setTimeout(() => { dragJustHappenedRef.current = false }, 120)
    if (draggedFolderId && draggedFolderId !== targetId) {
      if (target.type === 'app') {
        onReorder(draggedFolderId, targetId)
      } else {
        // Folder over folder → reorder folders
        const current = [...safeFolders]
        const from = current.findIndex((f) => f.id === draggedFolderId)
        const to = current.findIndex((f) => f.id === targetId)
        if (from !== -1 && to !== -1) {
          const next = [...current]
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          onFoldersChange(next)
        }
      }
      setDraggedFolderId(null)
      return
    }
    if (draggedAppId) {
      if (target.type === 'folder') {
        dropApp(target)
      } else if (draggedAppId !== targetId) {
        onReorder(draggedAppId, targetId)
      }
      setDraggedAppId(null)
      return
    }
  }

  const dropApp = (target: LauncherItem) => {
    if (!draggedAppId || (target.type === 'app' && target.app.id === draggedAppId)) return
    const withoutDragged = folders
      .map((folder) => ({ ...folder, appIds: folder.appIds.filter((id) => id !== draggedAppId) }))
      .filter((folder) => folder.appIds.length > 0)
    if (target.type === 'folder') {
      onFoldersChange(withoutDragged.map((folder) => folder.id === target.folder.id
        ? { ...folder, appIds: [...folder.appIds, draggedAppId] }
        : folder))
    } else {
      const id = `folder-${Date.now()}`
      onFoldersChange([{ id, name: t('os.launcher.newFolder'), appIds: [target.app.id, draggedAppId] }, ...withoutDragged])
      setOpenFolderId(id)
    }
    setDraggedAppId(null)
  }

  const openQuickMenu = (app: OsAppDefinition, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    closeAllContextMenus()
    setMoreOpen(false)
    setMorePos(null)
    setQuickMenu({ app, x: event.clientX, y: event.clientY, pinned: isDockPinned(app.id) })
  }

  /** Supervisor-managed installed apps (Docker/user apps). Dashboard pages
   * can also carry kind 'installed', so the runtime status is the reliable
   * discriminator: only real installed apps report one. */
  const isManagedApp = (app: OsAppDefinition) => typeof app.runtimeStatus === 'string'
  const isAppRunning = (app: OsAppDefinition) => app.runtimeStatus === 'running' || app.runtimeStatus === 'starting'

  const toast = (message: string) => window.dispatchEvent(new CustomEvent('rumahl:toast', { detail: { message } }))

  /** Start / stop / restart an installed app via the supervisor. */
  const runAppAction = async (action: 'start' | 'stop' | 'restart', app: OsAppDefinition) => {
    setBusyAction(action)
    try {
      if (action === 'start') {
        // Watch the runtime state: a successful POST is not a successful
        // start — a container that crashes on boot must surface a toast.
        const result = await startAppAndWatch(app.pageId)
        if (result.ok) toast(t('os.quickActions.started', { name: getAppName(app) }))
      } else {
        const res = await authFetch(`/api/supervisor/apps/${app.pageId}/${action}`, { method: 'POST' })
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
          throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
        }
        const key = action === 'stop' ? 'os.quickActions.stopped' : 'os.quickActions.restarted'
        toast(t(key, { name: getAppName(app) }))
      }
      window.dispatchEvent(new Event('rumahl:installed-apps-refresh'))
    } catch (e) {
      toast(t('os.quickActions.actionFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusyAction(null)
      setQuickMenu(null)
      setMoreOpen(false)
    }
  }

  /** Uninstall a managed app (stops the container and removes app data). */
  const confirmUninstall = async (app: OsAppDefinition) => {
    if (!(await confirmDialog({
      title: t('os.quickActions.uninstall'),
      message: t('os.quickActions.uninstallConfirm', { name: getAppName(app) }),
      confirmLabel: t('os.quickActions.uninstall'),
      danger: true,
    }))) return
    setBusyAction('uninstall')
    try {
      const res = await authFetch(`/api/appstore/apps/${app.pageId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string; message?: string } | null
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`)
      }
      toast(t('os.quickActions.uninstalled', { name: getAppName(app) }))
      window.dispatchEvent(new Event('rumahl:installed-apps-refresh'))
    } catch (e) {
      toast(t('os.quickActions.actionFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusyAction(null)
      setQuickMenu(null)
      setMoreOpen(false)
    }
  }

  /** "Fehlerbehebung": open the app detail dialog (runtime / logs / terminal). */
  const troubleshootApp = (app: OsAppDefinition) => {
    setQuickMenu(null)
    setMoreOpen(false)
    requestAppDetail(app.pageId)
    setCurrentPageId('app-store')
  }

  /** "Im App Store anzeigen": open the store and select this app. */
  const showAppInStore = (app: OsAppDefinition) => {
    setQuickMenu(null)
    setMoreOpen(false)
    requestAppInStore(app.pageId)
    setCurrentPageId('app-store')
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button type="button" onClick={() => onEditModeChange(!editMode)} className={`flex min-h-10 items-center gap-2 rounded-full border px-4 text-xs font-semibold transition-colors ${editMode ? 'border-accent/40 bg-accent/15 text-accent' : 'border-foreground/10 bg-background/80 text-foreground/65 hover:bg-background'}`}>
          {editMode ? <Check size={16} weight="bold" /> : <PencilSimple size={16} />}
          {editMode ? t('os.launcher.finishEditing') : t('os.launcher.edit')}
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
          {/* Install progress tiles (CasaOS/Umbrel style): apps currently
              being installed show a progress ring instead of a startable
              tile, so the launcher never offers a half-installed app. */}
          {installJobs.map((job) => (
            <div key={`install-${job.id}`} className="flex min-w-0 flex-col items-center p-2 text-center">
              <AppInstallProgress
                appId={job.appId}
                label={job.appName || job.appId}
                progress={job.progress}
                size="compact"
              />
              <span className="rumahl-adaptive-text-soft mt-2.5 w-full truncate text-xs font-medium sm:text-sm">{job.appName || job.appId}</span>
              <span className="mt-0.5 text-[10px] text-foreground/40">
                {Math.round(job.progress)}% · {t('os.launcher.installing')}
              </span>
            </div>
          ))}
          {items.map((item, index) => item.type === 'app' ? (
            <motion.button
              key={item.app.id}
              type="button"
              draggable
              onDragStartCapture={(event: React.DragEvent) => { setDraggedAppId(item.app.id); event.dataTransfer.setData('text/plain', item.app.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { setDraggedAppId(null); dragJustHappenedRef.current = true; window.setTimeout(() => { dragJustHappenedRef.current = false }, 120) }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(item, event)}
              onClick={() => { if (!dragJustHappenedRef.current) onOpenApp(item.app) }}
              onContextMenu={(event) => openQuickMenu(item.app, event)}
              className={`group flex min-w-0 touch-manipulation flex-col items-center rounded-3xl p-2 text-center focus-ring cursor-grab active:cursor-grabbing`}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.2), duration: 0.24 }} whileTap={editMode ? undefined : { scale: 0.96 }}
            >
              <AppIcon app={item.app} />
              <span className="rumahl-adaptive-text mt-2.5 w-full truncate text-xs font-medium sm:text-sm">{getAppName(item.app)}</span>
            </motion.button>
          ) : (
            <button
              key={item.folder.id}
              type="button"
              draggable
              onDragStartCapture={(event: React.DragEvent) => { setDraggedFolderId(item.folder.id); event.dataTransfer.setData('text/plain', item.folder.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { setDraggedFolderId(null); dragJustHappenedRef.current = true; window.setTimeout(() => { dragJustHappenedRef.current = false }, 120) }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(item, event)}
              onClick={() => { if (!dragJustHappenedRef.current) setOpenFolderId(item.folder.id) }}
              className={`group flex min-w-0 touch-manipulation flex-col items-center rounded-3xl p-2 text-center focus-ring ${editMode ? 'cursor-grab ring-1 ring-accent/25 active:cursor-grabbing' : ''} ${draggedFolderId === item.folder.id ? 'opacity-40' : ''}`}
            >
              <span className="rumahl-folder-tile grid h-20 w-20 grid-cols-2 gap-1 overflow-hidden rounded-[1.7rem] p-2">
                {item.folder.appIds.slice(0, 4).map((id) => {
                  const app = apps.find((candidate) => candidate.id === id)
                  return app ? <AppIcon key={id} app={app} compact /> : null
                })}
              </span>
              <span className="rumahl-adaptive-text mt-2.5 w-full truncate text-xs font-medium sm:text-sm">{item.folder.name}</span>
            </button>
          ))}
        </motion.div>
      </AnimatePresence>

      {createPortal(
      <AnimatePresence>{openFolder && <>
        <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpenFolderId(null)} className="fixed inset-0 z-[84] bg-black/55 backdrop-blur-md" aria-label={t('common.close')} />
        <motion.section initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }} role="dialog" aria-modal="true" aria-label={openFolder.name} className="glass-card fixed left-1/2 top-1/2 z-[85] max-h-[80dvh] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-4xl p-5 shadow-2xl sm:p-7">
          <div className="flex items-center gap-3">
            <Folder size={24} weight="duotone" className="shrink-0 text-accent" />
            <input value={openFolder.name} onChange={(event) => updateFolder(openFolder.id, (folder) => ({ ...folder, name: event.target.value }))} aria-label={t('os.launcher.folderName')} className="min-w-0 flex-1 rounded-xl bg-foreground/5 px-3 py-2 text-xl font-semibold text-foreground outline-none focus:ring-2 focus:ring-accent/40" />
            <button type="button" onClick={() => setOpenFolderId(null)} className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/70 hover:bg-foreground/10" aria-label={t('common.close')}><X size={19} /></button>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-5 sm:grid-cols-4">
            {folderApps.map((app) => <div key={app.id} className="relative flex min-w-0 flex-col items-center text-center">
              <button type="button" onClick={() => { if (!editMode) { setOpenFolderId(null); onOpenApp(app) } }} onContextMenu={(event) => openQuickMenu(app, event)} className="rounded-2xl focus-ring"><AppIcon app={app} /></button>
              <span className="mt-2 w-full truncate text-xs text-foreground/90">{getAppName(app)}</span>
              {editMode && <button type="button" onClick={() => updateFolder(openFolder.id, (folder) => ({ ...folder, appIds: folder.appIds.filter((id) => id !== app.id) }))} className="absolute -right-1 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background text-foreground shadow-lg" aria-label={t('os.launcher.removeFromFolder', { app: getAppName(app) })}><X size={14} /></button>}
            </div>)}
          </div>
          {editMode && <button type="button" onClick={() => { onFoldersChange(safeFolders.filter((folder) => folder.id !== openFolder.id)); setOpenFolderId(null) }} className="mt-7 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 text-sm font-semibold text-red-300 hover:bg-red-500/15"><Trash size={17} />{t('os.launcher.deleteFolder')}</button>}
        </motion.section>
      </>}</AnimatePresence>,
      document.body
      )}

      {createPortal(
      <AnimatePresence>{quickMenu && <>
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          className="fixed z-[87] w-48 overflow-hidden rounded-2xl border border-foreground/12 bg-background/95 p-1.5 text-foreground shadow-2xl backdrop-blur-xl"
          style={{ left: Math.min(quickMenu.x, window.innerWidth - 200), top: Math.min(quickMenu.y + 8, window.innerHeight - (isManagedApp(quickMenu.app) ? 340 : 260)) }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {isManagedApp(quickMenu.app) && <>
            {/* Start / Stop — depending on the current runtime status */}
            <button type="button" onClick={() => void runAppAction(isAppRunning(quickMenu.app) ? 'stop' : 'start', quickMenu.app)} disabled={busyAction !== null} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8 disabled:pointer-events-none disabled:opacity-50">
              {busyAction === 'start' || busyAction === 'stop' ? <MenuSpinner /> : isAppRunning(quickMenu.app)
                ? <Stop size={16} className="text-foreground/60" />
                : <Play size={16} className="text-foreground/60" />}
              {isAppRunning(quickMenu.app) ? t('os.quickActions.stop') : t('os.quickActions.start')}
            </button>
            <button type="button" onClick={() => void runAppAction('restart', quickMenu.app)} disabled={busyAction !== null} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8 disabled:pointer-events-none disabled:opacity-50">
              {busyAction === 'restart' ? <MenuSpinner /> : <ArrowClockwise size={16} className="text-foreground/60" />}
              {t('os.quickActions.restart')}
            </button>
            <button type="button" onClick={() => troubleshootApp(quickMenu.app)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <Wrench size={16} className="text-foreground/60" />
              {t('os.quickActions.troubleshoot')}
            </button>
            <button type="button" onClick={() => showAppInStore(quickMenu.app)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <Storefront size={16} className="text-foreground/60" />
              {t('os.quickActions.showInStore')}
            </button>
            <button type="button" onClick={() => void confirmUninstall(quickMenu.app)} disabled={busyAction !== null} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-red-300/90 hover:bg-red-500/15 disabled:pointer-events-none disabled:opacity-50">
              {busyAction === 'uninstall' ? <MenuSpinner /> : <TrashSimple size={16} className="text-red-400/80" />}
              {t('os.quickActions.uninstall')}
            </button>
            <div className="my-1 h-px bg-foreground/8" />
            {/* Remaining actions live in the "More" submenu */}
            <button
              type="button"
              ref={moreButtonRef}
              onClick={() => {
                const rect = moreButtonRef.current?.getBoundingClientRect()
                if (!moreOpen) setMorePos(rect ? { x: rect.right, y: rect.top } : null)
                setMoreOpen(!moreOpen)
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8"
            >
              <SquaresFour size={16} className="text-foreground/60" />
              <span className="flex-1">{t('os.quickActions.more')}</span>
              <CaretRight size={14} className="text-foreground/40" />
            </button>
          </>}
          {!isManagedApp(quickMenu.app) && <>
            <button type="button" onClick={() => { onOpenApp(quickMenu.app); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <ArrowSquareOut size={16} className="text-foreground/60" />
              {t('os.launcher.open')}
            </button>
            <button
              type="button"
              onClick={() => {
                toggleDockPin(quickMenu.app.id)
                setQuickMenu({ ...quickMenu, pinned: !quickMenu.pinned })
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8"
            >
              <PushPin size={16} className="text-foreground/60" />
              {quickMenu.pinned ? t('os.quickActions.unpin') : t('os.quickActions.pin')}
            </button>
            <div className="my-1 h-px bg-foreground/8" />
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'window'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.asWindow')}
            </button>
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'split-left'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.splitLeft')}
            </button>
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'split-right'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.splitRight')}
            </button>
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'immersive'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.immersive')}
            </button>
            <button type="button" onClick={() => { onEditModeChange(!editMode); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <PencilSimple size={16} className="text-foreground/60" />
              {t('os.quickActions.arrange')}
            </button>
          </>}
        </motion.div>

        {moreOpen && quickMenu && isManagedApp(quickMenu.app) && (
          <motion.div
            ref={flyoutRef}
            initial={{ opacity: 0, x: -6, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.97 }}
            className="fixed z-[88] w-48 overflow-hidden rounded-2xl border border-white/12 bg-background/95 p-1.5 text-foreground shadow-2xl backdrop-blur-xl"
            style={{ left: Math.min((morePos?.x ?? quickMenu.x + 192) + 6, window.innerWidth - 200), top: Math.min(morePos?.y ?? quickMenu.y + 8, window.innerHeight - 340) }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => { onOpenApp(quickMenu.app); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <ArrowSquareOut size={16} className="text-foreground/60" />
              {t('os.launcher.open')}
            </button>
            <button
              type="button"
              onClick={() => {
                toggleDockPin(quickMenu.app.id)
                setQuickMenu({ ...quickMenu, pinned: !quickMenu.pinned })
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8"
            >
              <PushPin size={16} className="text-foreground/60" />
              {quickMenu.pinned ? t('os.quickActions.unpin') : t('os.quickActions.pin')}
            </button>
            <div className="my-1 h-px bg-foreground/8" />
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'window'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.asWindow')}
            </button>
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'split-left'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.splitLeft')}
            </button>
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'split-right'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.splitRight')}
            </button>
            <button type="button" onClick={() => { onLaunch(quickMenu.app, 'immersive'); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <SquaresFour size={16} className="text-foreground/60" />
              {t('os.window.immersive')}
            </button>
            <button type="button" onClick={() => { onEditModeChange(!editMode); setQuickMenu(null) }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground/85 hover:bg-foreground/8">
              <PencilSimple size={16} className="text-foreground/60" />
              {t('os.quickActions.arrange')}
            </button>
          </motion.div>
        )}
      </>}</AnimatePresence>,
      document.body
      )}
    </>
  )
}
