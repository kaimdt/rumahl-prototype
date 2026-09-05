import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { SquaresFour } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOsWindows, type OsSnapLayout, type OsWindow } from '@/contexts/OsWindowContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { OsWindowActions } from '@/components/OsWindowActions'
import { captureWindowPreview, setWindowPreview } from '@/lib/windowPreview'

interface Props {
  window: OsWindow
  active?: boolean
  name: string
  icon: ReactNode
  /** Renders the app content for this window. */
  renderContent: (pageId: string) => ReactNode
}

const SNAP_INSET = 8
const SNAP_GAP = 6
const EDGE_MARGIN = 28

/** Resize direction bit flags (CSS-style). */
type ResizeDir = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Minimum window size so a window can never be resized into oblivion. */
const MIN_W = 340
const MIN_H = 220

/** Screen-relative bounds for a snap layout (mirrors the context math). */
function snapBounds(layout: OsSnapLayout) {
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

/** Derive the snap target from the pointer position while dragging. */
function snapTargetFromPointer(clientX: number, clientY: number): OsSnapLayout | null {
  const w = globalThis.innerWidth
  const h = globalThis.innerHeight
  const nearLeft = clientX <= EDGE_MARGIN
  const nearRight = clientX >= w - EDGE_MARGIN
  const nearTop = clientY <= EDGE_MARGIN
  const nearBottom = clientY >= h - EDGE_MARGIN
  if (nearTop && nearLeft) return 'top-left'
  if (nearTop && nearRight) return 'top-right'
  if (nearBottom && nearLeft) return 'bottom-left'
  if (nearBottom && nearRight) return 'bottom-right'
  if (nearTop) return 'maximized'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  if (nearBottom) return 'bottom'
  return null
}

/**
 * OS window chrome: a slim draggable title bar plus the app content.
 * Supports snap layouts (drag-to-edge with live preview, double-click to
 * maximize, dedicated toggle button) for floating windows.
 */
export function OsWindowFrame({ window, active = false, name, icon, renderContent }: Props) {
  const { t } = useTranslation()
  const titleId = useId()
  const { focusWindow, updateWindow, snapWindow, toggleMaximize } = useOsWindows()

  useEffect(() => {
    const toggleFromAppChrome = (event: Event) => {
      const requestedPageId = (event as CustomEvent<{ pageId?: string }>).detail?.pageId
      if (requestedPageId === window.pageId) toggleMaximize(window.pageId)
    }
    globalThis.addEventListener('rumahl:window-toggle-maximize', toggleFromAppChrome)
    return () => globalThis.removeEventListener('rumahl:window-toggle-maximize', toggleFromAppChrome)
  }, [toggleMaximize, window.pageId])
  const { setCurrentPageId } = usePageNavigation()

  // Capture a REAL preview thumbnail of this window's rendered content so the
  // taskbar preview shows a screenshot instead of a bare icon. Captures when
  // the window opens and (debounced) whenever its size/geometry changes.
  useEffect(() => {
    if (!window.pageId) return
    let cancelled = false
    let timer: number | undefined
    const capture = async () => {
      const node = contentRef.current
      if (!node) return
      const dataUrl = await captureWindowPreview(node)
      if (cancelled || !dataUrl) return
      setWindowPreview(window.pageId, dataUrl)
      globalThis.dispatchEvent(new CustomEvent('rumahl:window-preview-updated'))
    }
    const schedule = () => {
      if (timer) globalThis.clearTimeout(timer)
      timer = globalThis.setTimeout(() => void capture(), 600)
    }
    // Capture after the content has painted.
    const raf = globalThis.requestAnimationFrame(() => schedule())
    return () => {
      cancelled = true
      globalThis.cancelAnimationFrame(raf)
      if (timer) globalThis.clearTimeout(timer)
    }
  }, [window.pageId, window.width, window.height, window.x, window.y])

  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [snapPreview, setSnapPreview] = useState<OsSnapLayout | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)

  // Direct user click on a window (content or title): focus it AND sync the
  // URL to its app. This is the explicit interaction that drives the address
  // bar — the reactive App-side effect only goes URL → window, so the two
  // never race (no /admin ↔ /files loop).
  const onWindowPointerDown = (event: React.PointerEvent) => {
    if (window.pageId) {
      setCurrentPageId(window.pageId)
    }
    onTitlePointerDown(event)
  }

  // Active resize (direction + snapshot of start geometry).
  const resize = useRef<{ dir: ResizeDir; startX: number; startY: number; x: number; y: number; width: number; height: number } | null>(null)

  const isFloating = window.layout !== 'split-left' && window.layout !== 'split-right'

  const bounds = useMemo(() => {
    const snapped = snapBounds(window.layout as OsSnapLayout)
    if (snapped) return snapped
    return { x: window.x, y: window.y, width: window.width, height: window.height }
  }, [window])

  const previewBounds = useMemo(() => (snapPreview ? snapBounds(snapPreview) : null), [snapPreview])

  // Drag is centralised on the window root so it works both from the (hidden)
  // chrome bar and from the app navbar (OsAppNavbar), which replaces the
  // chrome bar in desktop windows. The drag only starts when the pointer goes
  // down on a non-interactive header region (navbar or chrome bar); clicks on
  // buttons/inputs/handles behave normally.
  const canDraggable = (event: React.PointerEvent) => {
    const el = event.target as HTMLElement
    if (!el || typeof el.closest !== 'function') return false
    return Boolean(el.closest('.rumahl-app-navbar, .rumahl-os-window-bar'))
  }

  const onTitlePointerDown = (event: React.PointerEvent) => {
    if (window.layout !== 'window' || event.button !== 0) return
    if (!canDraggable(event)) return
    if ((event.target as HTMLElement).closest('.rumahl-window-action, button, input, select, a, .rumahl-resize-handle')) return
    focusWindow(window.pageId)
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: window.x,
      originY: window.y,
    }
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onTitlePointerMove = (event: React.PointerEvent) => {
    if (!drag.current || window.layout !== 'window') return
    const nextX = drag.current.originX + (event.clientX - drag.current.startX)
    const nextY = Math.max(8, drag.current.originY + (event.clientY - drag.current.startY))
    updateWindow(window.pageId, {
      x: Math.min(Math.max(nextX, 8), Math.max(8, globalThis.innerWidth - window.width - 8)),
      y: nextY,
    })
    setSnapPreview(snapTargetFromPointer(event.clientX, event.clientY))
  }

  const onTitlePointerUp = (event: React.PointerEvent) => {
    const preview = snapPreview
    drag.current = null
    setIsDragging(false)
    setSnapPreview(null)
    if (preview && window.layout === 'window') {
      snapWindow(window.pageId, preview)
    }
  }

  const onTitlePointerCancel = () => {
    drag.current = null
    setIsDragging(false)
    setSnapPreview(null)
  }

  const onTitleDoubleClick = (event: React.MouseEvent) => {
    // Only the app navbar / chrome bar toggles maximize on double-click — never
    // the window content. Content double-clicks must behave normally (select
    // text, rename, etc.).
    if (!canDraggable(event as unknown as React.PointerEvent)) return
    if (window.layout !== 'window') {
      snapWindow(window.pageId, 'window')
    } else {
      toggleMaximize(window.pageId)
    }
  }

  const onResizeStart = (dir: ResizeDir) => (event: React.PointerEvent) => {
    if (window.layout !== 'window' || event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    focusWindow(window.pageId)
    resize.current = {
      dir,
      startX: event.clientX,
      startY: event.clientY,
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
    }
    setIsResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onResizeMove = (event: React.PointerEvent) => {
    const r = resize.current
    if (!r || window.layout !== 'window') return
    const dx = event.clientX - r.startX
    const dy = event.clientY - r.startY

    let nextX = r.x
    let nextY = r.y
    let nextW = r.width
    let nextH = r.height

    if (r.dir.includes('e')) nextW = Math.max(MIN_W, r.width + dx)
    if (r.dir.includes('s')) nextH = Math.max(MIN_H, r.height + dy)
    if (r.dir.includes('w')) {
      nextW = Math.max(MIN_W, r.width - dx)
      nextX = r.x + (r.width - nextW)
    }
    if (r.dir.includes('n')) {
      nextH = Math.max(MIN_H, r.height - dy)
      nextY = Math.max(8, r.y + (r.height - nextH))
    }

    updateWindow(window.pageId, { x: nextX, y: nextY, width: nextW, height: nextH })
  }

  const onResizeEnd = () => {
    resize.current = null
    setIsResizing(false)
  }

  return (
    <>
      <div
        className="rumahl-os-window"
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-layout={window.layout}
        data-active={active ? 'true' : 'false'}
        data-dragging={isDragging ? 'true' : 'false'}
        data-resizing={isResizing ? 'true' : 'false'}
        style={{ zIndex: window.z, left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        onPointerDown={onWindowPointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerCancel}
        onDoubleClick={onTitleDoubleClick}
        onFocusCapture={() => {
          if (!active && window.pageId) {
            focusWindow(window.pageId)
            setCurrentPageId(window.pageId)
          }
        }}
      >
        <div
          className={`rumahl-os-window-bar ${window.layout === 'window' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
          {icon}
          <span id={titleId} className="rumahl-os-window-title min-w-0 flex-1 truncate">
            {window.pageId ? name : t('os.window.emptyPane')}
          </span>
          <OsWindowActions pageId={window.pageId} showMinimize={isFloating} />
        </div>
        <div ref={contentRef} className="rumahl-os-window-content min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {window.pageId ? renderContent(window.pageId) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <SquaresFour size={40} weight="duotone" className="text-foreground/15" />
              <p className="text-sm text-foreground/40">{t('os.window.splitHint')}</p>
            </div>
          )}
        </div>

        {/* Resize handles — only for free-form (unsnapped) windows so the
            corner/edge zones never fight the snap-drag or maximize behavior. */}
        {window.layout === 'window' && (
          <>
            {(['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDir[]).map((dir) => (
              <div
                key={dir}
                className={`rumahl-resize-handle rumahl-resize-${dir}`}
                onPointerDown={onResizeStart(dir)}
                onPointerMove={onResizeMove}
                onPointerUp={onResizeEnd}
                onPointerCancel={onResizeEnd}
              />
            ))}
          </>
        )}
      </div>

      {/* Snap preview while dragging near a screen edge */}
      {previewBounds && (
        <div
          className="rumahl-snap-preview pointer-events-none fixed z-[59] rounded-2xl border-2 border-accent/70 bg-accent/10 backdrop-blur-[2px]"
          data-layout={snapPreview}
          style={{ left: previewBounds.x, top: previewBounds.y, width: previewBounds.width, height: previewBounds.height }}
        />
      )}
    </>
  )
}
