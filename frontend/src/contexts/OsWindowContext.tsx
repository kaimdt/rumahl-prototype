import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { authFetch } from '@/lib/authHelpers'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Snap layouts: floating-window arrangements (half/quarter/whole screen)
 * plus the classic split-view pair. `window` is the free-form state.
 */
export type OsSnapLayout =
  | 'window'
  | 'maximized'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type OsWindowLayout = OsSnapLayout | 'split-left' | 'split-right'

export interface OsWindow {
  /** null = empty split pane placeholder */
  pageId: string | null
  layout: OsWindowLayout
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  /** Virtual desktop that owns this window. */
  workspaceId: number
}

export type OsSplitSide = 'split-left' | 'split-right'

export type OsLaunchMode = 'fullscreen' | 'immersive' | 'window' | OsSplitSide

export const SNAP_LAYOUTS: readonly OsSnapLayout[] = [
  'window', 'maximized', 'left', 'right', 'top', 'bottom',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
]

interface OsWindowContextValue {
  windows: OsWindow[]
  workspaces: number[]
  activeWorkspaceId: number
  immersivePageId: string | null
  openWindow: (pageId: string) => void
  openSplit: (pageId: string, side: OsSplitSide) => void
  closeWindow: (pageId: string | null) => void
  focusWindow: (pageId: string | null) => void
  minimizeWindow: (pageId: string | null) => void
  updateWindow: (pageId: string | null, patch: Partial<OsWindow>) => void
  setImmersive: (pageId: string | null) => void
  /** Snap a floating window into a screen arrangement. */
  snapWindow: (pageId: string | null, layout: OsSnapLayout) => void
  /** Toggle between `window` and `maximized`. */
  toggleMaximize: (pageId: string | null) => void
  /** Discard the current window set (used on explicit desktop reset). */
  resetWindows: () => void
  createWorkspace: () => void
  removeWorkspace: (workspaceId: number) => void
  switchWorkspace: (workspaceId: number) => void
  moveWindowToWorkspace: (pageId: string | null, workspaceId: number) => void
}

const OsWindowContext = createContext<OsWindowContextValue | null>(null)

const DEFAULT_WINDOW_WIDTH = 880
const DEFAULT_WINDOW_HEIGHT = 640
const SESSION_STORAGE_KEY = 'rumahl-os-session-windows'
const WORKSPACES_STORAGE_KEY = 'rumahl-os-workspaces'
const ACTIVE_WORKSPACE_STORAGE_KEY = 'rumahl-os-active-workspace'
const MAX_WORKSPACES = 4
/** Per-app remembered free-form geometry (localStorage), so re-opening an app
 *  returns to the position/size the user last had it at. */
const APP_GEOMETRY_KEY = 'rumahl-os-app-geometry'
const SAVE_DEBOUNCE_MS = 800

interface AppGeometry { x: number; y: number; width: number; height: number }

function readWorkspaces(): number[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACES_STORAGE_KEY) || '[1,2]')
    const values = Array.isArray(parsed)
      ? parsed.filter((value): value is number => Number.isInteger(value) && value > 0).slice(0, MAX_WORKSPACES)
      : []
    return values.length ? [...new Set(values)] : [1, 2]
  } catch {
    return [1, 2]
  }
}

function readActiveWorkspace(workspaces: number[]): number {
  const stored = Number(localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY))
  return workspaces.includes(stored) ? stored : workspaces[0]
}

function readAppGeometry(): Record<string, AppGeometry> {
  try {
    const parsed = JSON.parse(localStorage.getItem(APP_GEOMETRY_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAppGeometry(map: Record<string, AppGeometry>): void {
  try { localStorage.setItem(APP_GEOMETRY_KEY, JSON.stringify(map)) } catch { /* non-critical */ }
}

/** Clamp a remembered rect into the current viewport (with a small margin) so
 *  a window restored from an old/other-sized screen never lands off-screen. */
function clampToViewport(g: AppGeometry): AppGeometry {
  const w = globalThis.innerWidth
  const h = globalThis.innerHeight
  const margin = 8
  const width = Math.max(340, Math.min(g.width, w - 2 * margin))
  const height = Math.max(220, Math.min(g.height, h - 2 * margin))
  return {
    width,
    height,
    x: Math.max(margin, Math.min(g.x, w - width - margin)),
    y: Math.max(margin, Math.min(g.y, h - height - margin)),
  }
}

/** Screen geometry (with a small inset so maximized/snapped windows keep a margin). */
const SNAP_INSET = 8
const SNAP_GAP = 6

function screenBounds(layout: OsSnapLayout) {
  const w = globalThis.innerWidth
  const h = globalThis.innerHeight
  const half = (v: number) => v / 2 - SNAP_GAP / 2
  const left = SNAP_INSET
  const right = w - SNAP_INSET
  const top = SNAP_INSET
  const bottom = h - SNAP_INSET
  switch (layout) {
    case 'maximized': return { x: 0, y: 0, width: w, height: h - (document.documentElement.dataset.shellMode === 'desktop' ? document.querySelector('.rumahl-system-bar')?.getBoundingClientRect().height || 44 : 0) }
    case 'left': return { x: left, y: top, width: half(w) - SNAP_INSET, height: h - 2 * SNAP_INSET }
    case 'right': return { x: w / 2 + SNAP_GAP / 2, y: top, width: half(w) - SNAP_INSET, height: h - 2 * SNAP_INSET }
    case 'top': return { x: left, y: top, width: w - 2 * SNAP_INSET, height: half(h) - SNAP_INSET }
    case 'bottom': return { x: left, y: h / 2 + SNAP_GAP / 2, width: w - 2 * SNAP_INSET, height: half(h) - SNAP_INSET }
    case 'top-left': return { x: left, y: top, width: half(w) - SNAP_INSET, height: half(h) - SNAP_INSET }
    case 'top-right': return { x: w / 2 + SNAP_GAP / 2, y: top, width: half(w) - SNAP_INSET, height: half(h) - SNAP_INSET }
    case 'bottom-left': return { x: left, y: h / 2 + SNAP_GAP / 2, width: half(w) - SNAP_INSET, height: half(h) - SNAP_INSET }
    case 'bottom-right': return { x: w / 2 + SNAP_GAP / 2, y: h / 2 + SNAP_GAP / 2, width: half(w) - SNAP_INSET, height: half(h) - SNAP_INSET }
    default: return null
  }
}

/** Pure window-manager state (no navigation coupling): floating windows and
 * split-view panes rendered on top of the desktop. Callers own navigation. */
export function OsWindowProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<OsWindow[]>([])
  const [workspaces, setWorkspaces] = useState<number[]>(readWorkspaces)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => readActiveWorkspace(readWorkspaces()))
  const [immersivePageId, setImmersivePageId] = useState<string | null>(null)
  const zCounter = useRef(10)
  const { user } = useAuth()
  const saveTimer = useRef<number | null>(null)

  // Free-form geometry last seen before a window snapped/maximized, keyed by
  // pageId. Lets "restore to window" return to the exact size/position the
  // user had, instead of snapping back to fullscreen (which happened when the
  // maximized bounds were kept as the free-form geometry).
  const restoreRectsRef = useRef<Map<string, { x: number; y: number; width: number; height: number }>>(new Map())

  const nextZ = () => ++zCounter.current

  const makeDefaultWindow = useCallback((pageId: string | null, layout: OsWindowLayout): OsWindow => {
    if (pageId) {
      const remembered = readAppGeometry()[pageId]
      if (remembered) {
        const g = clampToViewport(remembered)
        return { pageId, layout, ...g, z: nextZ(), minimized: false, workspaceId: activeWorkspaceId }
      }
    }
    const width = Math.min(DEFAULT_WINDOW_WIDTH, globalThis.innerWidth * 0.86)
    const height = Math.min(DEFAULT_WINDOW_HEIGHT, globalThis.innerHeight * 0.78)
    return {
      pageId,
      layout,
      x: Math.max(16, (globalThis.innerWidth - width) / 2 + 28),
      y: Math.max(16, (globalThis.innerHeight - height) / 2 - 24 + 24),
      width,
      height,
      z: nextZ(),
      minimized: false,
      workspaceId: activeWorkspaceId,
    }
  }, [activeWorkspaceId])

  const openWindow = useCallback((pageId: string) => {
    setWindows((current) => {
      const existing = current.find((w) => w.pageId === pageId)
      if (existing) {
        return current.map((w) => (w.pageId === pageId ? { ...w, z: nextZ(), minimized: false, workspaceId: activeWorkspaceId } : w))
      }
      // Opening a floating window clears the split layout.
      const withoutSplit = current.filter((w) => w.workspaceId !== activeWorkspaceId || SNAP_LAYOUTS.includes(w.layout as OsSnapLayout))
      return [...withoutSplit, makeDefaultWindow(pageId, 'window')]
    })
  }, [activeWorkspaceId, makeDefaultWindow])

  const openSplit = useCallback((pageId: string, side: OsSplitSide) => {
    const other: OsSplitSide = side === 'split-left' ? 'split-right' : 'split-left'
    setWindows((current) => {
      // Entering split replaces any floating windows.
      const otherWorkspaces = current.filter((w) => w.workspaceId !== activeWorkspaceId)
      const split = current.filter((w) => w.workspaceId === activeWorkspaceId && (w.layout === 'split-left' || w.layout === 'split-right'))
      const otherPane = split.find((w) => w.layout === other)
      const thisPane = split.find((w) => w.layout === side)
      const next: OsWindow[] = []
      // Keep the opposite pane if it exists, otherwise create an empty one.
      if (otherPane) {
        next.push({ ...otherPane, z: nextZ(), minimized: false })
      } else {
        next.push(makeDefaultWindow(null, other))
      }
      // Place the requested app on this side (or focus it if already there).
      if (thisPane && thisPane.pageId === pageId) {
        next.push({ ...thisPane, z: nextZ(), minimized: false })
      } else {
        next.push(makeDefaultWindow(pageId, side))
      }
      return [...otherWorkspaces, ...next]
    })
  }, [activeWorkspaceId, makeDefaultWindow])

  const closeWindow = useCallback((pageId: string | null) => {
    setImmersivePageId((current) => current === pageId ? null : current)
    restoreRectsRef.current.delete(pageId ?? '')
    setWindows((current) => {
      const target = current.find((w) => w.pageId === pageId)
      if (!target) return current
      const remaining = current.filter((w) => w.pageId !== pageId)
      // A remaining split pane becomes a floating window.
      if (target.layout === 'split-left' || target.layout === 'split-right') {
        return remaining.map((w) => (w.layout === 'split-left' || w.layout === 'split-right')
          ? { ...w, layout: 'window' as OsWindowLayout, z: nextZ() }
          : w)
      }
      return remaining
    })
  }, [])

  const focusWindow = useCallback((pageId: string | null) => {
    setWindows((current) => current.map((w) =>
      w.pageId === pageId ? { ...w, z: nextZ(), minimized: false } : w))
  }, [])

  const minimizeWindow = useCallback((pageId: string | null) => {
    setImmersivePageId((current) => current === pageId ? null : current)
    setWindows((current) => current.map((w) =>
      w.pageId === pageId ? { ...w, minimized: true } : w))
  }, [])

  const updateWindow = useCallback((pageId: string | null, patch: Partial<OsWindow>) => {
    setWindows((current) => current.map((w) =>
      w.pageId === pageId ? { ...w, ...patch } : w))
  }, [])

  const snapWindow = useCallback((pageId: string | null, layout: OsSnapLayout) => {
    setWindows((current) => current.map((w) => {
      if (w.pageId !== pageId) return w
      const bounds = screenBounds(layout)
      if (!bounds) {
        // Restoring to 'window': give back the pre-snap geometry (stored when
        // the window was snapped/maximized), if any — otherwise keep the
        // current free-form geometry.
        const saved = restoreRectsRef.current.get(pageId ?? '')
        const restored = saved && w.layout !== 'window'
          ? { ...w, layout, ...saved, z: nextZ(), minimized: false }
          : { ...w, layout, z: nextZ(), minimized: false }
        return restored
      }
      // Snap/maximize: remember the starting free-form rect so it can be
      // restored later. Only stash once — further snaps (e.g. left → right)
      // must not overwrite the original free-form size.
      const isFreeForm = w.layout === 'window'
      if (isFreeForm) {
        restoreRectsRef.current.set(pageId ?? '', { x: w.x, y: w.y, width: w.width, height: w.height })
      }
      return { ...w, layout, ...bounds, z: nextZ(), minimized: false }
    }))
  }, [])

  const toggleMaximize = useCallback((pageId: string | null) => {
    setWindows((current) => current.map((w) => {
      if (w.pageId !== pageId) return w
      if (w.layout === 'maximized') {
        // Restore from the stored pre-maximize rect, if present.
        const saved = restoreRectsRef.current.get(pageId ?? '')
        const restored = saved
          ? { ...w, layout: 'window', ...saved, z: nextZ(), minimized: false }
          : { ...w, layout: 'window', z: nextZ(), minimized: false }
        // React may replay this updater; retain the rectangle until the next snap or close.
        return restored
      }
      // Maximize every non-maximized state, including restored legacy session
      // values and split layouts. Restricting this branch to SNAP_LAYOUTS made
      // the visible titlebar button silently do nothing for those windows.
      const bounds = screenBounds('maximized')
      if (!bounds) return w
      if (w.layout === 'window') {
        restoreRectsRef.current.set(pageId ?? '', { x: w.x, y: w.y, width: w.width, height: w.height })
      }
      return { ...w, layout: 'maximized', ...bounds, z: nextZ() }
    }))
  }, [])

  const resetWindows = useCallback(() => {
    restoreRectsRef.current.clear()
    setWindows([])
  }, [])

  const createWorkspace = useCallback(() => {
    setWorkspaces((current) => {
      if (current.length >= MAX_WORKSPACES) return current
      const nextId = Math.max(...current, 0) + 1
      const next = [...current, nextId]
      localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(next))
      setActiveWorkspaceId(nextId)
      localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, String(nextId))
      return next
    })
  }, [])

  const removeWorkspace = useCallback((workspaceId: number) => {
    setWorkspaces((current) => {
      if (current.length <= 1 || !current.includes(workspaceId)) return current
      const next = current.filter((id) => id !== workspaceId)
      const fallbackId = next[Math.max(0, current.indexOf(workspaceId) - 1)] ?? next[0]
      setWindows((items) => items.map((item) => item.workspaceId === workspaceId ? { ...item, workspaceId: fallbackId } : item))
      setActiveWorkspaceId((active) => {
        const nextActive = active === workspaceId ? fallbackId : active
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, String(nextActive))
        return nextActive
      })
      localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const switchWorkspace = useCallback((workspaceId: number) => {
    if (!workspaces.includes(workspaceId)) return
    setActiveWorkspaceId(workspaceId)
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, String(workspaceId))
  }, [workspaces])

  const moveWindowToWorkspace = useCallback((pageId: string | null, workspaceId: number) => {
    if (!workspaces.includes(workspaceId)) return
    setWindows((current) => current.map((item) => item.pageId === pageId ? { ...item, workspaceId, z: nextZ() } : item))
  }, [workspaces])

  const setImmersive = useCallback((pageId: string | null) => {
    setImmersivePageId(pageId)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.immersive = immersivePageId ? 'true' : 'false'
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setImmersivePageId(null)
    }
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('keydown', onEscape)
      delete document.documentElement.dataset.immersive
    }
  }, [immersivePageId])

  // ── Session restore: load persisted windows once on boot ────────────────
  useEffect(() => {
    if (!user) return
    let alive = true
    const fallback = () => {
      if (!alive) return
      try {
        const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '[]')
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWindows((current) => (current.length === 0 ? parsed.map((w: OsWindow) => ({ ...w, workspaceId: w.workspaceId || 1 })) : current))
        }
      } catch {
        // corrupt fallback — ignore
      }
    }
    authFetch('/api/session/windows')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (!alive) return
        const restored = (data.windows || [])
          .filter((w: OsWindow) => w.pageId)
          .map((w: OsWindow) => ({ ...w, minimized: false, workspaceId: w.workspaceId || 1 }))
        if (restored.length > 0) {
          setWindows((current) => (current.length === 0 ? restored : current))
        }
      })
      .catch(fallback)
    return () => {
      alive = false
    }
  }, [user])

  // ── Per-app geometry persist ─────────────────────────────────────────
  // Remember each app's free-form window geometry (position + size) so that
  // re-opening the same app returns to where the user last had it. Only free
  // form (`window`) rects are stored; split/maximized/snapped are transient
  // layouts. Written debounced alongside the session save.
  useEffect(() => {
    if (!user) return
    const map = readAppGeometry()
    let changed = false
    for (const w of windows) {
      if (w.pageId && w.layout === 'window') {
        map[w.pageId] = { x: w.x, y: w.y, width: w.width, height: w.height }
        changed = true
      }
    }
    if (changed) writeAppGeometry(map)
  }, [windows, user])

  // ── Session persist: debounced save of the window set ───────────────────
  useEffect(() => {
    if (!user) return
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const payload = { windows }
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(windows))
      } catch {
        // storage full — non-critical
      }
      void authFetch('/api/session/windows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        // backend unreachable — localStorage fallback already persisted
      })
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [windows, user])

  // Flush pending saves when the tab is hidden/unloaded.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      if (!user || windows.length === 0) return
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(windows))
      } catch {
        // non-critical
      }
      void authFetch('/api/session/windows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windows }),
      }).catch(() => {
        // best-effort
      })
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [windows, user])

  return (
    <OsWindowContext.Provider
      value={{
        windows,
        workspaces,
        activeWorkspaceId,
        immersivePageId,
        openWindow,
        openSplit,
        closeWindow,
        focusWindow,
        minimizeWindow,
        updateWindow,
        setImmersive,
        snapWindow,
        toggleMaximize,
        resetWindows,
        createWorkspace,
        removeWorkspace,
        switchWorkspace,
        moveWindowToWorkspace,
      }}
    >
      {children}
    </OsWindowContext.Provider>
  )
}

export function useOsWindows() {
  const context = useContext(OsWindowContext)
  if (!context) throw new Error('useOsWindows must be used within OsWindowProvider')
  return context
}
