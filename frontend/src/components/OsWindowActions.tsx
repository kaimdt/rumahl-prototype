import { ArrowSquareOut, Minus, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useOsWindows } from '@/contexts/OsWindowContext'

/**
 * OsWindowActions – the three window actions (minimize / detach / close)
 * shown in the title bar of regular (embedded) apps, top-right.
 *
 *  - minimize: keeps the app running, returns to the launcher
 *  - detach:   turns the embedded app into a floating window on the desktop
 *  - close:    quits the app (closes any open window), returns to launcher
 */
export function OsWindowActions({ pageId }: { pageId: string }) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()
  const { openWindow, closeWindow, minimizeWindow } = useOsWindows()

  const actionButton =
    'flex h-7 w-7 items-center justify-center rounded-lg text-foreground/55 transition-colors hover:bg-foreground/10 hover:text-foreground focus-ring'

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
      <button
        type="button"
        onClick={() => { openWindow(pageId); setCurrentPageId('launcher') }}
        className={actionButton}
        aria-label={t('os.window.fullscreen')}
        title={t('os.window.fullscreen')}
      >
        <ArrowSquareOut size={14} weight="bold" />
      </button>
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
