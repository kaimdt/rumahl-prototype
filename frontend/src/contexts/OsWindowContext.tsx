import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

export type OsWindowLayout = 'window' | 'split-left' | 'split-right'

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
}

const OsWindowContext = createContext<OsWindowContextValue | null>(null)

const DEFAULT_WINDOW_WIDTH = 880
const DEFAULT_WINDOW_HEIGHT = 640

/**
 * Pure window-manager state (no navigation coupling): floating windows and
 * split-view panes rendered on top of the desktop. Callers own navigation.
 */
export function OsWindowProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<OsWindow[]>([])
  const [immersivePageId, setImmersivePageId] = useState<string | null>(null)
  const zCounter = useRef(10)

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
      const withoutSplit = current.filter((w) => w.layout === 'window')
      return [...withoutSplit, makeDefaultWindow(pageId, 'window')]
    })
  }, [makeDefaultWindow])

  const openSplit = useCallback((pageId: string, side: OsSplitSide) => {
    const other: OsSplitSide = side === 'split-left' ? 'split-right' : 'split-left'
    setWindows((current) => {
      // Entering split replaces any floating windows.
      const split = current.filter((w) => w.layout !== 'window')
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
      if (target.layout !== 'window') {
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

  const setImmersive = useCallback((pageId: string | null) => {
    setImmersivePageId(pageId)
  }, [])

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
