import { useRef, type ReactNode } from 'react'
import { Minus, SquaresFour, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useOsWindows, type OsWindow } from '@/contexts/OsWindowContext'

interface Props {
  window: OsWindow
  name: string
  icon: ReactNode
  /** Renders the app content for this window. */
  renderContent: (pageId: string) => ReactNode
  onMaximize: () => void
}

/**
 * OS window chrome: a slim draggable title bar plus the app content.
 * Used for floating windows and split panes.
 */
export function OsWindowFrame({ window, name, icon, renderContent, onMaximize }: Props) {
  const { t } = useTranslation()
  const { focusWindow, minimizeWindow, updateWindow, closeWindow } = useOsWindows()
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

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
  }

  const onTitlePointerUp = () => {
    drag.current = null
  }

  return (
    <div
      className="ora-os-window"
      style={{ zIndex: window.z }}
      onPointerDown={() => focusWindow(window.pageId)}
    >
      <div
        className={`ora-os-window-bar ${window.layout === 'window' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-[0.14em] text-foreground/60">
          {window.pageId ? name : t('os.window.emptyPane')}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {window.layout === 'window' && (
            <button type="button" className="ora-window-action" onClick={() => minimizeWindow(window.pageId)} aria-label={t('os.window.minimize')} title={t('os.window.minimize')}>
              <Minus size={14} />
            </button>
          )}
          <button type="button" className="ora-window-action" onClick={onMaximize} aria-label={t('os.window.fullscreen')} title={t('os.window.fullscreen')}>
            <SquaresFour size={13} />
          </button>
          <button type="button" className="ora-window-action hover:!bg-red-500/20 hover:!text-red-400" onClick={() => closeWindow(window.pageId)} aria-label={t('os.window.close')} title={t('os.window.close')}>
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
  )
}
