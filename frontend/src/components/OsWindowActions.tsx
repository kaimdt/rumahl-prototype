import { useEffect, useRef, useState } from 'react'
import { AlignLeft, AlignRight, ArrowSquareOut, CornersOut, Minus, SquaresFour, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useOsWindows, type OsSnapLayout } from '@/contexts/OsWindowContext'
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities'

/**
 * OsWindowActions – the three window actions shown at the right of the app
 * navbar. They are always shown and never clip, so they work at any size.
 *
 *  - minimize: keeps the app running, returns to the launcher
 *  - fullscreen: opens a hover menu (fullscreen / window / split). A small
 *                hover-intent delay keeps the menu open while the pointer
 *                travels through the gap between button and menu — it never
 *                closes prematurely, which reliably lets the user reach it.
 *  - close: quits the app (closes any open window), returns to launcher
 */
export function OsWindowActions({ pageId }: { pageId: string }) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()
  const { windows, activeWorkspaceId, openWindow, closeWindow, minimizeWindow, openSplit, setImmersive, snapWindow } = useOsWindows()
  const { hasHover } = useDeviceCapabilities()
  const [menuOpen, setMenuOpen] = useState(false)
  const hoverTimer = useRef<number | undefined>(undefined)

  // Hover-intent: delay closing so the pointer can cross the gap between the
  // trigger and the menu without the dropdown collapsing first.
  const closeSoon = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setMenuOpen(false), 220)
  }
  const cancelClose = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
  }
  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current) }, [])

  const actionButton =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-ring'

  const windowState = windows.find((entry) => entry.workspaceId === activeWorkspaceId && entry.pageId === pageId)
  const goFullscreen = () => { setImmersive(pageId); setCurrentPageId(pageId); setMenuOpen(false) }
  const toggleWindowMaximize = () => {
    if (windowState) {
      window.dispatchEvent(new CustomEvent('rumahl:window-toggle-maximize', { detail: { pageId } }))
      setMenuOpen(false)
      return
    }
    goFullscreen()
  }
  const goWindow = () => { openWindow(pageId); setCurrentPageId('launcher'); setMenuOpen(false) }
  const goSplit = (side: 'split-left' | 'split-right') => { openSplit(pageId, side); setCurrentPageId('launcher'); setMenuOpen(false) }
  const applySnap = (layout: OsSnapLayout) => { snapWindow(pageId, layout); setCurrentPageId(pageId); setMenuOpen(false) }

  const snapLayouts: Array<{ label: string; cells: OsSnapLayout[] }> = [
    { label: t('os.window.snapHalves'), cells: ['left', 'right'] },
    { label: t('os.window.snapQuarters'), cells: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] },
    { label: t('os.window.snapRows'), cells: ['top', 'bottom'] },
  ]

  const menuItem =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground/80 transition-colors hover:bg-foreground/8 hover:text-foreground'

  return (
    <div
      className="rumahl-window-actions flex shrink-0 items-center gap-1"
      onMouseEnter={cancelClose}
      onMouseLeave={closeSoon}
    >
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => { minimizeWindow(pageId); setCurrentPageId('launcher') }}
        className={actionButton}
        aria-label={t('os.window.minimize')}
        title={t('os.window.minimize')}
      >
        <Minus size={15} weight="bold" />
      </button>

      <div className="relative" onMouseEnter={() => { cancelClose(); setMenuOpen(true) }}>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => { if (windowState) toggleWindowMaximize(); else if (hasHover) goFullscreen(); else setMenuOpen((v) => !v) }}
          className={actionButton}
          aria-label={windowState ? t('os.window.maximize') : t('os.window.launchModes')}
          aria-expanded={menuOpen}
          title={windowState?.layout === 'maximized' ? t('os.window.restore') : windowState ? t('os.window.maximize') : t('os.window.launchModes')}
        >
          <ArrowSquareOut size={14} weight="bold" />
        </button>

        {menuOpen && (
          <div
            className="rumahl-snap-menu absolute right-0 top-full z-[90] mt-1 w-56 overflow-hidden rounded-xl border border-foreground/10 bg-background/95 p-1.5 text-foreground shadow-xl backdrop-blur-xl"
            onMouseEnter={cancelClose}
            onMouseLeave={closeSoon}
            onClick={() => setMenuOpen(false)}
          >
            {windowState && (
              <div className="rumahl-snap-layouts" aria-label={t('os.window.snapLayouts')}>
                <span>{t('os.window.snapLayouts')}</span>
                <div>
                  {snapLayouts.map((layout) => (
                    <div key={layout.label} className={`rumahl-snap-layout rumahl-snap-layout-${layout.cells.length}`} aria-label={layout.label}>
                      {layout.cells.map((cell) => (
                        <button key={cell} type="button" onClick={() => applySnap(cell)} aria-label={`${t('os.window.snapTo')} ${t(`os.window.snap.${cell}`)}`} title={`${t('os.window.snapTo')} ${t(`os.window.snap.${cell}`)}`} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button type="button" onClick={goFullscreen} className={menuItem}>
              <CornersOut size={14} className="text-foreground/50" /> {t('os.window.fullscreen')}
            </button>
            <button type="button" onClick={goWindow} className={menuItem}>
              <SquaresFour size={14} className="text-foreground/50" /> {t('os.window.asWindow')}
            </button>
            <button type="button" onClick={() => goSplit('split-left')} className={menuItem}>
              <AlignLeft size={14} className="text-foreground/50" /> {t('os.window.splitLeft')}
            </button>
            <button type="button" onClick={() => goSplit('split-right')} className={menuItem}>
              <AlignRight size={14} className="text-foreground/50" /> {t('os.window.splitRight')}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => { closeWindow(pageId); setCurrentPageId('launcher') }}
        className={`${actionButton} hover:!bg-red-500/15 hover:!text-red-400`}
        aria-label={t('os.window.close')}
        title={t('os.window.close')}
      >
        <X size={15} weight="bold" />
      </button>
    </div>
  )
}
