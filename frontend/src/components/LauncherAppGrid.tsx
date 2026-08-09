import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { closeAllContextMenus, useCloseOnOtherMenu } from '@/lib/contextMenus'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, Check, Folder, PencilSimple, PushPin, SquaresFour, Trash, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { OsAppDefinition } from '@/lib/osAppRegistry'
import { isDockPinned, toggleDockPin } from '@/lib/dockPrefs'
import type { OsLaunchMode } from '@/contexts/OsWindowContext'

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
  const normalizedFolders = folders
    .map((folder) => ({ ...folder, appIds: folder.appIds.filter((id) => availableIds.has(id)) }))
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
      className={`ora-app-icon relative flex shrink-0 items-center justify-center overflow-hidden text-white ${compact ? 'h-8 w-8 rounded-[0.65rem]' : 'h-20 w-20 rounded-[1.7rem]'} ${
        app.iconUrl ? 'border-0 bg-transparent shadow-none' : 'border border-white/15 shadow-lg'
      }`}
      style={app.iconUrl
        ? undefined
        : { background: `linear-gradient(145deg, color-mix(in oklch, ${app.accent} 88%, white), color-mix(in oklch, ${app.accent} 72%, black))` }}
    >
      {!app.iconUrl && <span className="ora-app-icon-highlight absolute inset-0" />}
      {app.iconUrl ? (
        <img src={app.iconUrl} alt={app.fallbackName} className={`h-full w-full ${app.iconPad ? 'object-contain p-1' : 'object-cover'}`} />
      ) : Icon ? (
        <Icon size={size} weight="duotone" className="relative" />
      ) : null}
    </span>
  )
}

export function LauncherAppGrid({
  items,
  apps,
  folders,
  editMode,
  onEditModeChange,
  onFoldersChange,
  onOpenApp,
  getAppName,
  onLaunch,
}: {
  items: LauncherItem[]
  apps: OsAppDefinition[]
  folders: LauncherFolder[]
  editMode: boolean
  onEditModeChange: (enabled: boolean) => void
  onFoldersChange: (folders: LauncherFolder[]) => void
  onOpenApp: (app: OsAppDefinition) => void
  getAppName: (app: OsAppDefinition) => string
  /** Launches an app in a specific OS layout (fullscreen / window / split / immersive). */
  onLaunch: (app: OsAppDefinition, mode: OsLaunchMode) => void
}) {
  const { t } = useTranslation()
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [draggedAppId, setDraggedAppId] = useState<string | null>(null)
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null)
  const dragJustHappenedRef = useRef(false)
  const [quickMenu, setQuickMenu] = useState<{ app: OsAppDefinition; x: number; y: number; pinned: boolean } | null>(null)
  useCloseOnOtherMenu(() => setQuickMenu(null))
  // Close the quick menu on any outside click / right-click (no backdrop, so
  // right-clicking another app opens its own menu instead).
  useEffect(() => {
    if (!quickMenu) return
    const close = () => setQuickMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setQuickMenu(null) }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('contextmenu', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('contextmenu', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [quickMenu])
  const openFolder = folders.find((folder) => folder.id === openFolderId)
  const folderApps = openFolder?.appIds.map((id) => apps.find((app) => app.id === id)).filter((app): app is OsAppDefinition => Boolean(app)) || []

  const updateFolder = (folderId: string, update: (folder: LauncherFolder) => LauncherFolder) => {
    onFoldersChange(folders.map((folder) => folder.id === folderId ? update(folder) : folder))
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
    closeAllContextMenus()
    setQuickMenu({ app, x: event.clientX, y: event.clientY, pinned: isDockPinned(app.id) })
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
          {items.map((item, index) => item.type === 'app' ? (
            <motion.button
              key={item.app.id}
              type="button"
              draggable={editMode}
              onDragStartCapture={(event: React.DragEvent) => { setDraggedAppId(item.app.id); event.dataTransfer.setData('text/plain', item.app.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => setDraggedAppId(null)}
              onDragOver={(event) => { if (editMode) event.preventDefault() }}
              onDrop={() => dropApp(item)}
              onClick={() => { if (!editMode) onOpenApp(item.app) }}
              onContextMenu={(event) => openQuickMenu(item.app, event)}
              className={`group flex min-w-0 touch-manipulation flex-col items-center rounded-3xl p-2 text-center focus-ring ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.025, 0.2), duration: 0.24 }} whileHover={editMode ? undefined : { y: -4, scale: 1.025 }} whileTap={editMode ? undefined : { scale: 0.96 }}
            >
              <AppIcon app={item.app} />
              <span className="mt-2.5 w-full truncate text-xs font-medium text-foreground/90 sm:text-sm">{getAppName(item.app)}</span>
            </motion.button>
          ) : (
            <button
              key={item.folder.id}
              type="button"
              draggable={editMode}
              onDragStartCapture={(event: React.DragEvent) => { setDraggedFolderId(item.folder.id); event.dataTransfer.setData('text/plain', item.folder.id); event.dataTransfer.effectAllowed = 'move' }}
              onDragEnd={() => { setDraggedFolderId(null); dragJustHappenedRef.current = true; window.setTimeout(() => { dragJustHappenedRef.current = false }, 120) }}
              onDragOver={(event) => { if (editMode) event.preventDefault() }}
              onDrop={(event) => {
                if (!editMode) return
                event.preventDefault()
                dragJustHappenedRef.current = true
                window.setTimeout(() => { dragJustHappenedRef.current = false }, 120)
                // Dragging a folder onto another folder reorders them.
                if (draggedFolderId && draggedFolderId !== item.folder.id) {
                  onFoldersChange((() => {
                    const current = [...folders]
                    const from = current.findIndex((f) => f.id === draggedFolderId)
                    const to = current.findIndex((f) => f.id === item.folder.id)
                    if (from === -1 || to === -1) return current
                    const next = [...current]
                    const [moved] = next.splice(from, 1)
                    next.splice(to, 0, moved)
                    return next
                  })())
                } else {
                  dropApp(item)
                }
                setDraggedFolderId(null)
              }}
              onClick={() => { if (!dragJustHappenedRef.current) setOpenFolderId(item.folder.id) }}
              className={`group flex min-w-0 touch-manipulation flex-col items-center rounded-3xl p-2 text-center focus-ring ${editMode ? 'cursor-grab ring-1 ring-accent/25 active:cursor-grabbing' : ''} ${draggedFolderId === item.folder.id ? 'opacity-40' : ''}`}
            >
              <span className="grid h-20 w-20 grid-cols-2 gap-1 overflow-hidden rounded-[1.7rem] border border-white/15 bg-background/90 p-2 shadow-xl backdrop-blur-xl">
                {item.folder.appIds.slice(0, 4).map((id) => {
                  const app = apps.find((candidate) => candidate.id === id)
                  return app ? <AppIcon key={id} app={app} compact /> : null
                })}
              </span>
              <span className="mt-2.5 w-full truncate text-xs font-medium text-foreground/90 sm:text-sm">{item.folder.name}</span>
            </button>
          ))}
        </motion.div>
      </AnimatePresence>

      {createPortal(
      <AnimatePresence>{openFolder && <>
        <motion.button type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpenFolderId(null)} className="fixed inset-0 z-[84] bg-black/55 backdrop-blur-md" aria-label={t('common.close')} />
        <motion.section initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 16 }} role="dialog" aria-modal="true" aria-label={openFolder.name} className="fixed left-1/2 top-1/2 z-[85] max-h-[80dvh] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] border border-white/15 bg-background/95 p-5 shadow-2xl backdrop-blur-2xl sm:p-7">
          <div className="flex items-center gap-3">
            <Folder size={24} weight="duotone" className="shrink-0 text-accent" />
            <input value={openFolder.name} onChange={(event) => updateFolder(openFolder.id, (folder) => ({ ...folder, name: event.target.value }))} aria-label={t('os.launcher.folderName')} className="min-w-0 flex-1 rounded-xl bg-foreground/5 px-3 py-2 text-xl font-semibold outline-none focus:ring-2 focus:ring-accent/40" />
            <button type="button" onClick={() => setOpenFolderId(null)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-foreground/10" aria-label={t('common.close')}><X size={19} /></button>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-5 sm:grid-cols-4">
            {folderApps.map((app) => <div key={app.id} className="relative flex min-w-0 flex-col items-center text-center">
              <button type="button" onClick={() => { if (!editMode) { setOpenFolderId(null); onOpenApp(app) } }} className="rounded-2xl focus-ring"><AppIcon app={app} /></button>
              <span className="mt-2 w-full truncate text-xs">{getAppName(app)}</span>
              {editMode && <button type="button" onClick={() => updateFolder(openFolder.id, (folder) => ({ ...folder, appIds: folder.appIds.filter((id) => id !== app.id) }))} className="absolute -right-1 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background text-foreground shadow-lg" aria-label={t('os.launcher.removeFromFolder', { app: getAppName(app) })}><X size={14} /></button>}
            </div>)}
          </div>
          {editMode && <button type="button" onClick={() => { onFoldersChange(folders.filter((folder) => folder.id !== openFolder.id)); setOpenFolderId(null) }} className="mt-7 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 text-sm font-semibold text-red-300 hover:bg-red-500/15"><Trash size={17} />{t('os.launcher.deleteFolder')}</button>}
        </motion.section>
      </>}</AnimatePresence>,
      document.body
      )}

      {createPortal(
      <AnimatePresence>{quickMenu && <>
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.97 }}
          className="fixed z-[87] w-48 overflow-hidden rounded-2xl border border-white/12 bg-background/95 p-1.5 text-foreground shadow-2xl backdrop-blur-xl"
          style={{ left: Math.min(quickMenu.x, window.innerWidth - 196), top: Math.min(quickMenu.y + 8, window.innerHeight - 260) }}
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
      </>}</AnimatePresence>,
      document.body
      )}
    </>
  )
}
