import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowSquareOut, Minus, SquaresFour, X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useOsWindows } from '@/contexts/OsWindowContext'

/**
 * OsFullscreenBar – slim OS status/action bar shown on the launcher and in
 * immersive (true fullscreen) apps.
 *
 *  - Launcher: acts as a status bar (rumahl OS brand + live clock).
 *  - Immersive app: shows the app name plus the window actions
 *    (minimize → keeps running, exit fullscreen, close).
 *
 * Uses regular icon buttons (no traffic lights). The bar auto-hides while
 * scrolling down in apps and reappears on scroll-up or pointer at the top;
 * on the launcher it stays visible.
 */
export function OsFullscreenBar({
  pageId,
  name,
  icon,
}: {
  pageId: string
  name: string
  icon?: React.ReactNode
}) {
  const { t } = useTranslation()
  const { setCurrentPageId } = usePageNavigation()
  const { closeWindow, minimizeWindow, openWindow, setImmersive, immersivePageId } = useOsWindows()
  // Status-bar mode on regular pages; window actions only in true fullscreen.
  const showActions = Boolean(immersivePageId)
  const [visible, setVisible] = useState(true)
  const hideTimer = useRef<number | null>(null)

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setVisible(false), 2500)
  }, [])

  // Auto-hide only inside fullscreen apps; everywhere else the bar stays put.
  useEffect(() => {
    if (!showActions) {
      setVisible(true)
      return
    }
    let lastY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (y > lastY + 6 && y > 80) {
        setVisible(false)
      } else if (y < lastY - 2) {
        setVisible(true)
        scheduleHide()
      }
      lastY = y
    }
    const onMouseMove = (event: MouseEvent) => {
      if (event.clientY < 64) {
        setVisible(true)
        scheduleHide()
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    scheduleHide()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('mousemove', onMouseMove)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [showActions, scheduleHide])

  const close = useCallback(() => {
    closeWindow(pageId)
    setCurrentPageId('launcher')
  }, [closeWindow, pageId, setCurrentPageId])

  const minimize = useCallback(() => {
    minimizeWindow(pageId)
    setCurrentPageId('launcher')
  }, [minimizeWindow, pageId, setCurrentPageId])

  const exitFullscreen = useCallback(() => {
    if (immersivePageId) {
      setImmersive(null)
      setCurrentPageId('launcher')
      return
    }
    openWindow(pageId)
    setCurrentPageId('launcher')
  }, [immersivePageId, openWindow, pageId, setCurrentPageId, setImmersive])

  const actionButton =
    'flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/6 text-foreground/55 transition-colors hover:bg-foreground/12 hover:text-foreground focus-ring'

  // The status bar (brand + clock) now lives in OsSystemShell; this bar only
  // renders in immersive (true fullscreen) apps where window actions apply.
  if (!showActions) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed inset-x-0 top-0 z-[74] flex justify-center px-3 pt-2"
        >
          <div className="pointer-events-auto flex w-fit max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-white/10 bg-background/70 px-2 py-1 shadow-xl shadow-black/15 backdrop-blur-2xl">
            <>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={minimize} aria-label={t('os.window.minimize')} title={t('os.window.minimize')} className={actionButton}>
                  <Minus size={14} weight="bold" />
                </button>
                <button type="button" onClick={exitFullscreen} aria-label={t('os.window.fullscreen')} title={t('os.window.fullscreen')} className={actionButton}>
                  <ArrowSquareOut size={13} weight="bold" />
                </button>
                <button type="button" onClick={close} aria-label={t('os.window.close')} title={t('os.window.close')} className={`${actionButton} hover:!bg-red-500/15 hover:!text-red-400`}>
                  <X size={14} weight="bold" />
                </button>
              </div>
              <span className="h-4 w-px bg-foreground/10" aria-hidden="true" />
              <div className="flex min-w-0 items-center gap-2 pr-1">
                {icon && <span className="shrink-0">{icon}</span>}
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/60">{name}</span>
              </div>
            </>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
