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
}

export type OsSplitSide = 'split-left' | 'split-right'

export type OsLaunchMode = 'fullscreen' | 'immersive' | 'window' | OsSplitSide

export const SNAP_LAYOUTS: readonly OsSnapLayout[] = [
  'window', 'maximized', 'left', 'right', 'top', 'bottom',
  'top-left', 'top-right', 'bottom-left', 'bottom-right',
]

interface OsWindowContextValue {
  windows: OsWindow[]
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
}

const OsWindowContext = createContext<OsWindowContextValue | null>(null)

const DEFAULT_WINDOW_WIDTH = 880
const DEFAULT_WINDOW_HEIGHT = 640
const SESSION_STORAGE_KEY = 'iora-os-session-windows'
const SAVE_DEBOUNCE_MS = 800

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
    case 'maximized': return { x: left, y: top, width: w - 2 * SNAP_INSET, height: h - 2 * SNAP_INSET }
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
  const [immersivePageId, setImmersivePageId] = useState<string | null>(null)
  const zCounter = useRef(10)
  const { user } = useAuth()
  const saveTimer = useRef<number | null>(null)

  const nextZ = () => ++zCounter.current

  const makeDefaultWindow = useCallback((pageId: string | null, layout: OsWindowLayout): OsWindow => {
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
    }
  }, [])

  const openWindow = useCallback((pageId: string) => {
    setWindows((current) => {
      const existing = current.find((w) => w.pageId === pageId)
      if (existing) {
        return current.map((w) => (w.pageId === pageId ? { ...w, z: nextZ(), minimized: false } : w))
      }
      // Opening a floating window clears the split layout.
      const withoutSplit = current.filter((w) => SNAP_LAYOUTS.includes(w.layout as OsSnapLayout))
      return [...withoutSplit, makeDefaultWindow(pageId, 'window')]
    })
  }, [makeDefaultWindow])

  const openSplit = useCallback((pageId: string, side: OsSplitSide) => {
    const other: OsSplitSide = side === 'split-left' ? 'split-right' : 'split-left'
    setWindows((current) => {
      // Entering split replaces any floating windows.
      const split = current.filter((w) => w.layout === 'split-left' || w.layout === 'split-right')
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
      return next
    })
  }, [makeDefaultWindow])

  const closeWindow = useCallback((pageId: string | null) => {
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
        // Restoring to 'window': keep the free-form geometry.
        return { ...w, layout, z: nextZ(), minimized: false }
      }
      return { ...w, layout, ...bounds, z: nextZ(), minimized: false }
    }))
  }, [])

  const toggleMaximize = useCallback((pageId: string | null) => {
    setWindows((current) => current.map((w) => {
      if (w.pageId !== pageId) return w
      if (w.layout === 'maximized') {
        return { ...w, layout: 'window', z: nextZ(), minimized: false }
      }
      if (SNAP_LAYOUTS.includes(w.layout as OsSnapLayout)) {
        const bounds = screenBounds('maximized')
        return bounds ? { ...w, layout: 'maximized', ...bounds, z: nextZ() } : w
      }
      return w
    }))
  }, [])

  const resetWindows = useCallback(() => {
    setWindows([])
  }, [])

  const setImmersive = useCallback((pageId: string | null) => {
    setImmersivePageId(pageId)
  }, [])

  // ── Session restore: load persisted windows once on boot ────────────────
  useEffect(() => {
    if (!user) return
    let alive = true
    const fallback = () => {
      if (!alive) return
      try {
        const parsed = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '[]')
        if (Array.isArray(parsed) && parsed.length > 0) {
          setWindows((current) => (current.length === 0 ? parsed : current))
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
          .map((w: OsWindow) => ({ ...w, minimized: false }))
        if (restored.length > 0) {
          setWindows((current) => (current.length === 0 ? restored : current))
        }
      })
      .catch(fallback)
    return () => {
      alive = false
    }
  }, [user])

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
