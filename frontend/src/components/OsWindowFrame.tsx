import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Minus, SquaresFour, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOsWindows, type OsSnapLayout, type OsWindow } from '@/contexts/OsWindowContext'

interface Props {
  window: OsWindow
  name: string
  icon: ReactNode
  /** Renders the app content for this window. */
  renderContent: (pageId: string) => ReactNode
}

const SNAP_INSET = 8
const SNAP_GAP = 6
const EDGE_MARGIN = 28

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
export function OsWindowFrame({ window, name, icon, renderContent }: Props) {
  const { t } = useTranslation()
  const { focusWindow, minimizeWindow, updateWindow, closeWindow, snapWindow, toggleMaximize } = useOsWindows()
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const [snapPreview, setSnapPreview] = useState<OsSnapLayout | null>(null)

  const isFloating = window.layout !== 'split-left' && window.layout !== 'split-right'

  const bounds = useMemo(() => {
    const snapped = snapBounds(window.layout as OsSnapLayout)
    if (snapped) return snapped
    return { x: window.x, y: window.y, width: window.width, height: window.height }
  }, [window])

  const previewBounds = useMemo(() => (snapPreview ? snapBounds(snapPreview) : null), [snapPreview])

  const onTitlePointerDown = (event: React.PointerEvent) => {
    if (window.layout !== 'window' || event.button !== 0) return
    focusWindow(window.pageId)
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: window.x,
      originY: window.y,
    }
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
    setSnapPreview(null)
    if (preview && window.layout === 'window') {
      snapWindow(window.pageId, preview)
    }
  }

  const onTitleDoubleClick = () => {
    if (window.layout !== 'window') {
      snapWindow(window.pageId, 'window')
    } else {
      toggleMaximize(window.pageId)
    }
  }

  return (
    <>
      <div
        className="rumahl-os-window"
        style={{ zIndex: window.z, left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
        onPointerDown={() => focusWindow(window.pageId)}
      >
        <div
          className={`rumahl-os-window-bar ${window.layout === 'window' ? 'cursor-grab active:cursor-grabbing' : ''}`}
          onPointerDown={onTitlePointerDown}
          onPointerMove={onTitlePointerMove}
          onPointerUp={onTitlePointerUp}
          onDoubleClick={onTitleDoubleClick}
        >
          {icon}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-normal text-foreground/75">
            {window.pageId ? name : t('os.window.emptyPane')}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            {isFloating && (
              <button type="button" className="rumahl-window-action" onPointerDown={(e) => e.stopPropagation()} onClick={() => minimizeWindow(window.pageId)} aria-label={t('os.window.minimize')} title={t('os.window.minimize')}>
                <Minus size={14} />
              </button>
            )}
            <button
              type="button"
              className="rumahl-window-action"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => (window.layout === 'maximized' ? snapWindow(window.pageId, 'window') : toggleMaximize(window.pageId))}
              aria-label={t('os.window.maximize')}
              title={window.layout === 'maximized' ? t('os.window.restore') : t('os.window.maximize')}
            >
              <SquaresFour size={13} />
            </button>
            <button type="button" className="rumahl-window-action hover:!bg-red-500/20 hover:!text-red-400" onPointerDown={(e) => e.stopPropagation()} onClick={() => closeWindow(window.pageId)} aria-label={t('os.window.close')} title={t('os.window.close')}>
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {window.pageId ? renderContent(window.pageId) : (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <SquaresFour size={40} weight="duotone" className="text-foreground/15" />
              <p className="text-sm text-foreground/40">{t('os.window.splitHint')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Snap preview while dragging near a screen edge */}
      {previewBounds && (
        <div
          className="pointer-events-none fixed z-[59] rounded-2xl border-2 border-accent/70 bg-accent/10 backdrop-blur-[2px]"
          style={{ left: previewBounds.x, top: previewBounds.y, width: previewBounds.width, height: previewBounds.height }}
        />
      )}
    </>
  )
}
