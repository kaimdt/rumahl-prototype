import { useState } from 'react'
import { AlignLeft, AlignRight, ArrowSquareOut, CornersOut, Minus, SquaresFour, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities'

/**
 * OsWindowActions – the three window actions (minimize / fullscreen / close)
 * shown in the title bar of regular (embedded) apps, top-right.
 *
 *  - minimize:   keeps the app running, returns to the launcher
 *  - fullscreen: hover shows a macOS-style dropdown (fullscreen / window /
 *                split left / split right); click enters fullscreen
 *  - close:      quits the app (closes any open window), returns to launcher
 */
export function OsWindowActions({ pageId }: { pageId: string }) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()
  const { openWindow, closeWindow, minimizeWindow, openSplit, setImmersive } = useOsWindows()
  const { hasHover } = useDeviceCapabilities()
  const [menuOpen, setMenuOpen] = useState(false)

  const actionButton =
    'flex h-7 w-7 items-center justify-center rounded-lg text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-ring'

  const goFullscreen = () => { setImmersive(pageId); setCurrentPageId(pageId); setMenuOpen(false) }
  const goWindow = () => { openWindow(pageId); setCurrentPageId('launcher'); setMenuOpen(false) }
  const goSplit = (side: 'split-left' | 'split-right') => { openSplit(pageId, side); setCurrentPageId('launcher'); setMenuOpen(false) }

  const menuItem =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground/80 transition-colors hover:bg-foreground/8 hover:text-foreground'

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => { minimizeWindow(pageId); setCurrentPageId('launcher') }}
        className={actionButton}
        aria-label={t('os.window.minimize')}
        title={t('os.window.minimize')}
      >
        <Minus size={15} weight="bold" />
      </button>

      <div className="relative" onMouseEnter={() => setMenuOpen(true)} onMouseLeave={() => setMenuOpen(false)}>
        <button
          type="button"
          onClick={() => { if (hasHover) goFullscreen(); else setMenuOpen((v) => !v) }}
          className={actionButton}
          aria-label={t('os.window.fullscreen')}
          aria-expanded={menuOpen}
          title={t('os.window.fullscreen')}
        >
          <ArrowSquareOut size={14} weight="bold" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-[90] mt-1 w-44 overflow-hidden rounded-xl border border-foreground/10 bg-background/95 p-1.5 text-foreground shadow-xl backdrop-blur-xl">
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
