import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type DragEvent as ReactDragEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { iconMap, usePageNavigation } from '@/contexts/PageNavigationContext'
import { useAuth } from '@/contexts/AuthContext'
import { useOsPermissions } from '@/hooks/useOsPermissions'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { createPageApps, SYSTEM_OS_APPS, type OsAppDefinition } from '@/lib/osAppRegistry'
import { useInstalledApps } from '@/hooks/useInstalledApps'
import { isAppAllowed } from '@/lib/userRestrictions'
import { DesktopContextMenu, type DesktopMenuState } from '@/components/DesktopContextMenu'
import { closeAllContextMenus, useCloseOnOtherMenu } from '@/lib/contextMenus'
import { authFetch } from '@/lib/authHelpers'
import { deleteFileEntry, resolveDesktopFolder, createDesktopShortcut, createDesktopFile, createDesktopFolder } from '@/lib/desktopShortcuts'
import { fileTypeIcon } from '@/lib/fileTypeRegistry'
import { GearSix, MagnifyingGlass, FolderSimple, X } from '@phosphor-icons/react'

/** Session-scoped: whether the desktop initial layout has been applied. */
let initialLayoutAppliedOnce = false

interface MarqueeRect { x: number; y: number; width: number; height: number }

interface DesktopFile {
  id: string
  name: string
  /** Serialized field name from the files API. */
  original_name?: string | null
  is_folder: boolean
  mime_type: string | null
  size_bytes: number
  updated_at: string
  /** For app shortcuts: the target app pageId. */
  description?: string | null
}

const APP_SHORTCUT_MIME = 'application/x-rumahl-app-shortcut'
function isShortcut(f: DesktopFile): boolean { return f.mime_type === APP_SHORTCUT_MIME }
/** Display name for a desktop entry (the API serializes `original_name`). */
function fileDisplayName(f: DesktopFile): string { return f.original_name ?? f.name ?? '' }

type DesktopItemKey = `app:${string}` | `file:${string}`

/** Persisted free-grid position of a desktop item. */
interface ItemPos { col: number; row: number }

interface DesktopCreateDraft {
  kind: 'file' | 'folder'
  name: string
}

const POS_KEY = 'rumahl-os-desktop-positions'
const CURRENT_FOLDER_KEY = 'rumahl-os-desktop-folder'

interface DesktopMetrics { scale: number; cellWidth: number; cellHeight: number; iconSize: number; labelSize: number }

/** Windows-like desktop density that reacts to viewport size without letting
 * ultrawide/4K displays inflate controls or compact screens crush labels. */
function desktopMetricsForViewport(width: number, height: number): DesktopMetrics {
  const scale = Math.min(1.08, Math.max(0.9, Math.min(width / 1440, height / 900)))
  return {
    scale,
    cellWidth: Math.round(85 * scale),
    cellHeight: Math.round(71 * scale),
    iconSize: Math.min(48, Math.max(40, Math.round(44 * scale))),
    labelSize: Math.round(Math.min(13, Math.max(12, 12.2 * scale)) * 10) / 10,
  }
}

function readPositions(): Record<string, ItemPos> {
  try {
    const parsed = JSON.parse(localStorage.getItem(POS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}
function writePositions(map: Record<string, ItemPos>): void {
  try { localStorage.setItem(POS_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

function DesktopIcon({
  name,
  iconUrl,
  accent,
  Icon,
  fileIcon,
  isFolder,
  selected,
  onSelect,
  onOpen,
  onStartDrag,
  onEndDrag,
  onContextMenu,
}: {
  name: string
  iconUrl?: string
  accent?: string
  Icon?: OsAppDefinition['icon']
  fileIcon?: string | null
  isFolder?: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  onStartDrag: () => void
  onEndDrag: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event: React.DragEvent) => {
        event.dataTransfer.effectAllowed = 'move'
        // Required by the HTML5 DnD spec for the drag to initiate + drop to fire.
        event.dataTransfer.setData('text/plain', 'desktop-move')
        event.dataTransfer.setData('application/x-rumahl-desktop', '1')
        onStartDrag()
      }}
      onDragEnd={onEndDrag}
      onDoubleClick={onOpen}
      onClick={(event) => {
        if (event.detail === 1) onSelect()
        if (event.detail === 1 && matchMedia('(pointer: coarse)').matches) onOpen()
      }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(event) }}
      className={`rumahl-desktop-icon group ${selected ? 'is-selected' : ''}`}
      aria-label={name}
      aria-pressed={selected}
    >
      <span
        className={`rumahl-desktop-icon-art ${isFolder ? 'rumahl-desktop-icon-folder' : ''} ${iconUrl ? 'is-image' : ''}`}
        style={!iconUrl ? { '--app-accent': accent ?? 'oklch(0.5 0.15 280)' } as CSSProperties : undefined}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" />
        ) : isFolder ? (
          <FolderSimple size={27} weight="duotone" />
        ) : fileIcon ? (
          <img src={fileIcon} alt="" className="h-full w-full object-contain p-0.5" />
        ) : Icon ? (
          <Icon size={27} weight="duotone" />
        ) : null}
      </span>
      <span className="rumahl-desktop-icon-label">{name}</span>
    </button>
  )
}

export function DesktopWorkspace() {
  const { t } = useTranslation()
  const { pages, setCurrentPageId } = usePageNavigation()
  const { user } = useAuth()
  const { can } = useOsPermissions()
  const { installedApps } = useInstalledApps()
  const { windows, openWindow, focusWindow, updateWindow } = useOsWindows()

  const initialLayoutApplied = useRef(initialLayoutAppliedOnce)

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  const marqueeStart = useRef<{ x: number; y: number } | null>(null)
  const marqueeBaseSelection = useRef<Set<string>>(new Set())
  const marqueeActive = useRef(false)
  const marqueePointerId = useRef<number | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const creatingEntryRef = useRef(false)
  const [menu, setMenu] = useState<DesktopMenuState | null>(null)
  useCloseOnOtherMenu(() => setMenu(null))

  // Desktop folder files (1:1 with the Files "Desktop" system folder).
  const [desktopFolderId, setDesktopFolderId] = useState<string | null>(null)
  const [desktopFiles, setDesktopFiles] = useState<DesktopFile[]>([])
  const [positions, setPositions] = useState<Record<string, ItemPos>>(readPositions)
  const [dropHighlight, setDropHighlight] = useState(false)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [createDraft, setCreateDraft] = useState<DesktopCreateDraft | null>(null)
  const [desktopMetrics, setDesktopMetrics] = useState(() => desktopMetricsForViewport(window.innerWidth, window.innerHeight))

  useEffect(() => {
    const updateDesktopMetrics = () => setDesktopMetrics(desktopMetricsForViewport(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', updateDesktopMetrics)
    window.visualViewport?.addEventListener('resize', updateDesktopMetrics)
    return () => {
      window.removeEventListener('resize', updateDesktopMetrics)
      window.visualViewport?.removeEventListener('resize', updateDesktopMetrics)
    }
  }, [])

  // Resolve the personal Desktop system folder (created on first use).
  useEffect(() => {
    if (!user) return
    let alive = true
    const resolve = () => {
      authFetch('/api/files/system-folder?name=Desktop')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data) => {
          if (!alive) return
          const id = data?.folder?.id as string | undefined
          setDesktopFolderId(id ?? null)
          localStorage.setItem(CURRENT_FOLDER_KEY, id ?? '')
        })
        .catch(() => { /* files service may be offline */ })
    }
    resolve()
    // Re-resolve when a shortcut is added/removed elsewhere.
    window.addEventListener('rumahl:desktop-refresh', resolve)
    return () => { alive = false; window.removeEventListener('rumahl:desktop-refresh', resolve) }
  }, [user])

  // Load the Desktop folder's files whenever it resolves / refreshes.
  useEffect(() => {
    if (!desktopFolderId) return
    let alive = true
    const load = async () => {
      try {
        const res = await authFetch(`/api/files/?folder_id=${desktopFolderId}&limit=500`)
        if (!res.ok) return
        const data = await res.json() as { files?: DesktopFile[] }
        if (alive) setDesktopFiles(data.files || [])
      } catch { /* offline */ }
    }
    void load()
    const id = window.setInterval(load, 12000)
    const refresh = () => void load()
    window.addEventListener('rumahl:desktop-refresh', refresh)
    return () => { alive = false; window.clearInterval(id); window.removeEventListener('rumahl:desktop-refresh', refresh) }
  }, [desktopFolderId])

  useEffect(() => {
    if (!user) return
    if (initialLayoutApplied.current) return
    if (windows.length > 0) {
      initialLayoutApplied.current = true
      initialLayoutAppliedOnce = true
      return
    }
    initialLayoutApplied.current = true
    initialLayoutAppliedOnce = true

    const primaryPageId = user?.isAdmin ? 'admin' : 'os-system'
    const openTimer = window.setTimeout(() => {
      openWindow('os-files')
      openWindow(primaryPageId)
    }, 120)
    const layoutTimer = window.setTimeout(() => {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      updateWindow('os-files', {
        x: Math.max(112, viewportWidth * 0.085),
        y: Math.max(74, viewportHeight * 0.09),
        width: Math.min(555, viewportWidth * 0.42),
        height: Math.min(660, viewportHeight * 0.69),
      })
      updateWindow(primaryPageId, {
        x: Math.max(360, viewportWidth * 0.255),
        y: Math.max(44, viewportHeight * 0.05),
        width: Math.min(955, viewportWidth * 0.64),
        height: Math.min(730, viewportHeight * 0.76),
      })
      focusWindow(primaryPageId)
    }, 260)
    return () => {
      window.clearTimeout(openTimer)
      window.clearTimeout(layoutTimer)
    }
  }, [focusWindow, openWindow, updateWindow, user, windows.length])

  const apps = useMemo(() => {
    const pageApps = createPageApps(pages, (name) => iconMap[name as keyof typeof iconMap])
    const desktopOnlyApps: OsAppDefinition[] = user?.isAdmin ? [{
      id: 'rumahl-admin-center', pageId: 'admin', nameKey: 'adminCenter.title', fallbackName: 'Admin Center', icon: GearSix, kind: 'system', adminOnly: true, accent: 'oklch(0.63 0.23 285)', order: -1,
    }] : []
    const knownIds = new Set([...desktopOnlyApps, ...SYSTEM_OS_APPS, ...pageApps].map((app) => app.pageId))
    return [...desktopOnlyApps, ...SYSTEM_OS_APPS, ...pageApps, ...installedApps.filter((app) => !knownIds.has(app.pageId))]
      .filter((app) => !app.adminOnly || user?.isAdmin)
      .filter((app) => !app.requiredPermission || can(app.requiredPermission))
      .filter((app) => isAppAllowed(user, app.id))
      .sort((a, b) => a.order - b.order)
  }, [can, installedApps, pages, user])

  // Only the user-chosen apps appear as desktop shortcuts (not every app).
  // ── Desktop icons = the Desktop folder's entries (1:1 with Files) ────
  // App shortcuts (real entries with the shortcut mime) resolve to their app;
  // files/folders render as file icons. Both the desktop and the Files
  // "Desktop" folder read these same entries, so they are always identical.
  const fileItems = useMemo(() => {
    return desktopFiles.map((f) => {
      if (isShortcut(f)) {
        const app = apps.find((a) => a.pageId === f.description)
        return app ? { key: `file:${f.id}` as DesktopItemKey, file: f, app } : null
      }
      return { key: `file:${f.id}` as DesktopItemKey, file: f, app: undefined }
    }).filter((item): item is { key: DesktopItemKey; file: DesktopFile; app?: OsAppDefinition } => Boolean(item))
  }, [desktopFiles, apps])

  // Track whether each app already has a real shortcut on the desktop (derived
  // from the Desktop folder entries). The manage panel + context menu create or
  // delete these real shortcut entries via the API.
  const shortcutAppPageIds = useMemo(() => {
    const s = new Set<string>()
    for (const item of fileItems) if (item.app) s.add(item.app.pageId)
    return s
  }, [fileItems])
  // Apps currently present as desktop shortcuts (for the context menu "open").
  const desktopApps = useMemo(() => {
    return fileItems.map((item) => item.app).filter((a): a is OsAppDefinition => Boolean(a))
  }, [fileItems])
  const idMapByPageId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const app of apps) m[app.pageId] = app.id
    return m
  }, [apps])

  // Create a real shortcut entry for an app (if not already on desktop), or
  // delete the existing one. Keeps desktop + Desktop folder in sync.
  const toggleDesktopApp = useCallback(async (appId: string) => {
    const app = apps.find((a) => a.id === appId || a.pageId === appId)
    if (!app) return
    const existing = fileItems.find((item) => item.app?.id === app.id || item.app?.pageId === app.pageId)
    if (existing) {
      await deleteFileEntry(existing.file.id)
    } else {
      const folderId = await resolveDesktopFolder()
      await createDesktopShortcut({ pageId: app.pageId, name: app.nameKey ? t(app.nameKey, app.fallbackName) : app.fallbackName }, folderId)
    }
    window.dispatchEvent(new Event('rumahl:desktop-refresh'))
    window.dispatchEvent(new Event('rumahl:installed-apps-refresh'))
  }, [apps, fileItems, t])

  const openApp = (app: OsAppDefinition) => {
    if (app.openUrl) { setCurrentPageId(app.pageId); return }
    if (windows.some((w) => w.pageId === app.pageId)) focusWindow(app.pageId)
    else openWindow(app.pageId)
    setCurrentPageId('launcher')
  }

  const beginCreate = useCallback((kind: DesktopCreateDraft['kind']) => {
    setSelectedKeys(new Set())
    setCreateDraft({
      kind,
      name: kind === 'file' ? t('os.files.defaultNewFileName') : t('os.files.defaultNewFolderName'),
    })
  }, [t])

  // Commit the inline desktop editor to the same Desktop folder Files uses.
  const commitCreate = useCallback(async () => {
    if (!createDraft || creatingEntryRef.current) return
    const name = createDraft.name.trim()
    if (!name) { setCreateDraft(null); return }
    creatingEntryRef.current = true
    setCreateDraft(null)
    try {
      const folderId = await resolveDesktopFolder()
      const created = createDraft.kind === 'file'
        ? await createDesktopFile(name, folderId)
        : await createDesktopFolder(name, folderId)
      if (created) window.dispatchEvent(new Event('rumahl:desktop-refresh'))
    } finally {
      creatingEntryRef.current = false
    }
  }, [createDraft])

  // ── Desktop icons = the Desktop folder's entries (1:1 with Files) ────
  // App shortcuts (real entries with the shortcut mime) resolve to their app;
  // files/folders render as file icons. Both the desktop and the Files
  // "Desktop" folder read these same entries, so they are always identical.
  // ── Marquee selection over both shortcut and file icons ─────────────
  const onWallpaperPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.rumahl-desktop-icon, .rumahl-desktop-search')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    marqueePointerId.current = event.pointerId
    marqueeStart.current = { x: event.clientX, y: event.clientY }
    marqueeActive.current = false
    marqueeBaseSelection.current = event.shiftKey || event.metaKey || event.ctrlKey ? new Set(selectedKeys) : new Set()
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) setSelectedKeys(new Set())
  }

  const onWallpaperPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!marqueeStart.current || !workspaceRef.current) return
    const start = marqueeStart.current
    const left = Math.min(start.x, event.clientX)
    const top = Math.min(start.y, event.clientY)
    const width = Math.abs(event.clientX - start.x)
    const height = Math.abs(event.clientY - start.y)
    if (!marqueeActive.current && Math.hypot(width, height) <= 5) return
    marqueeActive.current = true
    setMarquee({ x: left - workspaceRef.current.getBoundingClientRect().left, y: top - workspaceRef.current.getBoundingClientRect().top, width, height })
    setSelectedKeys(() => {
      const next = new Set(marqueeBaseSelection.current)
      workspaceRef.current?.querySelectorAll<HTMLElement>('.rumahl-desktop-icon-slot').forEach((el) => {
        const key = el.getAttribute('data-item-key')
        if (!key) return
        const rect = el.getBoundingClientRect()
        const overlap = rect.left < left + width && rect.right > left && rect.top < top + height && rect.bottom > top
        if (overlap) next.add(key)
      })
      return next
    })
  }

  const endMarquee = () => {
    if (marqueePointerId.current !== null && workspaceRef.current?.hasPointerCapture(marqueePointerId.current)) workspaceRef.current.releasePointerCapture(marqueePointerId.current)
    marqueePointerId.current = null
    marqueeStart.current = null
    marqueeActive.current = false
    setMarquee(null)
  }

  const toggleSelected = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // ── Drag & drop: reposition shortcuts / upload files onto the Desktop folder ──
  const handleDrop = async (event: ReactDragEvent) => {
    event.preventDefault()
    setDropHighlight(false)
    if (!desktopFolderId || !can('os.files.write')) return
    const files = event.dataTransfer.files
    if (files.length) {
      const form = new FormData()
      form.append('folder_id', desktopFolderId)
      Array.from(files).forEach((f) => form.append('files', f))
      try { await authFetch('/api/files/upload', { method: 'POST', body: form }) } catch { /* offline */ }
      return
    }
    // Internal move: a Files/OS item dragged here → move into Desktop folder.
    const movedId = event.dataTransfer.getData('application/x-rumahl-file-id')
    if (movedId) {
      try { await authFetch(`/api/files/${movedId}/move`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_folder_id: desktopFolderId }) }) } catch { /* offline */ }
    }
  }

  const openDesktopMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault(); closeAllContextMenus(); setMenu({ x: event.clientX, y: event.clientY })
  }, [])

  const iconContextMenu = useCallback((event: React.MouseEvent, key: string, fileId?: string) => {
    event.preventDefault(); closeAllContextMenus()
    setSelectedKeys((prev) => prev.has(key) ? prev : new Set([key]))
    const appPageId = key.startsWith('app:') ? key.slice(4) : undefined
    setMenu({ x: event.clientX, y: event.clientY, appPageId, fileId })
  }, [])

  // Persist grid positions on change.
  useEffect(() => { writePositions(positions) }, [positions])

  // Seed positions for any item missing one (new list items / first run) using
  // a stable column-major layout so every icon has a real, distinct persisted
  // cell. Also guarantees a dragged item always has a previous slot to swap
  // from. Existing positions are kept; only missing keys get the next free cell.
  useEffect(() => {
    const allKeys: string[] = [...fileItems.map((i) => i.key)]
    const occupied = new Set<string>()
    for (const key of allKeys) {
      if (positions[key]) occupied.add(`${positions[key].col}:${positions[key].row}`)
    }
    let changed = false
    let nextCol = 0
    let nextRow = 0
    const next = { ...positions }
    for (const key of allKeys) {
      if (next[key]) continue
      // Find the next free cell not already claimed by an existing or newly
      // placed item.
      while (occupied.has(`${nextCol}:${nextRow}`)) {
        nextRow += 1
        if (nextRow > 40) { nextRow = 0; nextCol += 1 }
      }
      next[key] = { col: nextCol, row: nextRow }
      occupied.add(`${nextCol}:${nextRow}`)
      nextRow += 1
      changed = true
    }
    if (changed) setPositions(next)
  }, [fileItems])

  const posFor = (key: DesktopItemKey, index: number): ItemPos => positions[key] ?? { col: index % 6, row: Math.floor(index / 6) }
  const createDraftPosition = useMemo(() => {
    const occupied = new Set(fileItems.map((item, index) => {
      const position = posFor(item.key, index)
      return `${position.col}:${position.row}`
    }))
    let row = 0
    let col = 0
    while (occupied.has(`${col}:${row}`)) {
      row += 1
      if (row > 40) { row = 0; col += 1 }
    }
    return { col, row }
  }, [fileItems, positions])
  // Dropping a shortcut/file onto a cell places it there via absolute
  // positioning. If another item already occupies that cell, the two SWAP so
  // nothing stacks on top of anything (the collision the user saw).
  const placeDraggedAt = useCallback((col: number, row: number) => {
    if (!draggingKey) return
    setPositions((prev) => {
      const target: ItemPos = { col, row }
      // Find any OTHER item currently at the target cell (exclude the dragged
      // one so dropping back onto its own cell is a no-op).
      const occupant = Object.entries(prev).find(([k, p]) => k !== draggingKey && p.col === col && p.row === row)
      const next = { ...prev }
      if (occupant) {
        // Swap: give the occupant the dragged item's old slot.
        const old = prev[draggingKey]
        if (old) next[occupant[0]] = old
        delete next[draggingKey]
        next[draggingKey] = target
      } else {
        next[draggingKey] = target
      }
      return next
    })
    setDraggingKey(null)
  }, [draggingKey])

  const renderSlot = (key: string, content: React.ReactNode, pos: ItemPos, index: number, draggableKey: string) => (
    <div
      key={key}
      className="rumahl-desktop-icon-slot"
      style={{ left: pos.col * desktopMetrics.cellWidth, top: pos.row * desktopMetrics.cellHeight }}
      data-item-key={draggableKey}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); placeDraggedAt(pos.col, pos.row) }}
    >
      {content}
    </div>
  )

  return createPortal(
    <section
      ref={workspaceRef}
      className={`rumahl-desktop-workspace ${dropHighlight ? 'is-drop' : ''}`}
      style={{
        '--desktop-scale': desktopMetrics.scale,
        '--desktop-cell-width': `${desktopMetrics.cellWidth}px`,
        '--desktop-cell-height': `${desktopMetrics.cellHeight}px`,
        '--desktop-icon-size': `${desktopMetrics.iconSize}px`,
        '--desktop-label-size': `${desktopMetrics.labelSize}px`,
      } as CSSProperties}
      aria-label={t('os.shellMode.desktopWorkspace')}
      onPointerDown={onWallpaperPointerDown}
      onPointerMove={onWallpaperPointerMove}
      onPointerUp={endMarquee}
      onPointerCancel={endMarquee}
      onContextMenu={openDesktopMenu}
      onDragOver={(event) => { event.preventDefault(); setDropHighlight(true) }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropHighlight(false) }}
      onDrop={handleDrop}
    >
      <div className="rumahl-desktop-icons">
        {createDraft && (
          <div
            className="rumahl-desktop-icon-slot"
            style={{ left: createDraftPosition.col * desktopMetrics.cellWidth, top: createDraftPosition.row * desktopMetrics.cellHeight }}
          >
            <div className="rumahl-desktop-icon is-selected">
              <span className={`rumahl-desktop-icon-art ${createDraft.kind === 'folder' ? 'rumahl-desktop-icon-folder' : 'is-image'}`}>
                {createDraft.kind === 'folder'
                  ? <FolderSimple size={27} weight="duotone" />
                  : <img src="/icons/file.png" alt="" />}
              </span>
              <input
                autoFocus
                value={createDraft.name}
                onChange={(event) => setCreateDraft((draft) => draft ? { ...draft, name: event.target.value } : null)}
                onFocus={(event) => {
                  const extensionStart = createDraft.kind === 'file' ? event.target.value.lastIndexOf('.') : -1
                  event.target.setSelectionRange(0, extensionStart > 0 ? extensionStart : event.target.value.length)
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); void commitCreate() }
                  if (event.key === 'Escape') { event.preventDefault(); setCreateDraft(null) }
                  event.stopPropagation()
                }}
                onBlur={() => { if (createDraft.name.trim()) void commitCreate(); else setCreateDraft(null) }}
                className="rumahl-desktop-inline-name"
                aria-label={createDraft.kind === 'file' ? t('os.desktopMenu.newFile') : t('os.desktopMenu.newFolder')}
              />
            </div>
          </div>
        )}
        {fileItems.map((item, index) => {
          const pos = posFor(item.key, index)
          const isAppShortcut = Boolean(item.app)
          return renderSlot(item.key, (
            <DesktopIcon
              name={item.app ? (item.app.nameKey ? t(item.app.nameKey, item.app.fallbackName) : item.app.fallbackName) : fileDisplayName(item.file)}
              iconUrl={item.app?.iconUrl}
              accent={item.app?.accent}
              Icon={item.app?.icon}
              fileIcon={item.app ? undefined : fileTypeIcon(item.file.mime_type, fileDisplayName(item.file))}
              isFolder={!item.app && item.file.is_folder}
              selected={selectedKeys.has(item.key)}
              onSelect={() => toggleSelected(item.key)}
              onOpen={() => item.app ? openApp(item.app) : setCurrentPageId('os-files')}
              onStartDrag={() => setDraggingKey(item.key)}
              onEndDrag={() => setDraggingKey((k) => k === item.key ? null : k)}
              onContextMenu={(e) => iconContextMenu(e, item.key, item.file.id)}
            />
          ), pos, index, item.key)
        })}
      </div>

      {windows.length === 0 && (
        <button type="button" className="rumahl-desktop-search" onClick={() => window.dispatchEvent(new Event('rumahl:spotlight-toggle'))}>
          <MagnifyingGlass size={15} />
          <span>{t('os.shellMode.search')}</span>
          <kbd>Ctrl K</kbd>
        </button>
      )}

      <AnimatePresence>
        {marquee && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rumahl-desktop-marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
      </AnimatePresence>

      <DesktopContextMenu
        menu={menu}
        onClose={() => setMenu(null)}
        onOpenApp={() => {
          if (menu?.appPageId) {
            const app = desktopApps.find((a) => a.pageId === menu.appPageId)
            if (app) openApp(app)
          } else if (menu?.fileId) {
            // Open the file/folder in the Files app (Desktop folder).
            openWindow('os-files')
            setCurrentPageId('os-files')
          }
          setMenu(null)
        }}
        onOpenSettings={() => { setCurrentPageId('settings'); setMenu(null) }}
        onRefresh={() => window.location.reload()}
        onToggleDesktopApp={(pageId) => { toggleDesktopApp(idMapByPageId[pageId] ?? pageId) }}
        onNewFile={() => beginCreate('file')}
        onNewFolder={() => beginCreate('folder')}
        onDelete={async (fileId) => {
          const ok = await deleteFileEntry(fileId)
          if (ok) {
            window.dispatchEvent(new Event('rumahl:desktop-refresh'))
            window.dispatchEvent(new Event('rumahl:installed-apps-refresh'))
          }
        }}
        isRightClickedAppOnDesktop={Boolean(menu?.appPageId && desktopApps.some((a) => a.pageId === menu.appPageId))}
      />
    </section>,
    document.body,
  )
}
