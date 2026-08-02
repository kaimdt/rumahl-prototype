import { ArrowLeft, X } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'

export function OsAppCloseButton() {
  const { t } = useTranslation()
  const { currentPageId, setCurrentPageId } = usePageNavigation()

  if (currentPageId === 'launcher') return null

  return createPortal(
    <button
      type="button"
      onClick={() => setCurrentPageId('launcher')}
      className="glass-card fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[75] flex min-h-11 touch-manipulation items-center gap-2 rounded-full px-3 text-sm font-semibold text-foreground/75 shadow-lg transition-colors hover:text-foreground focus-ring sm:left-6 sm:top-5"
      aria-label={t('os.launcher.closeApp')}
    >
      <ArrowLeft size={18} className="sm:hidden" />
      <X size={18} className="hidden sm:block" />
      <span className="hidden sm:inline">{t('os.launcher.closeApp')}</span>
    </button>,
    document.body,
  )
}
