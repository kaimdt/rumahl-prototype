import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { OsWindowFrame } from '@/components/OsWindowFrame'
import type { OsAppDefinition } from '@/lib/osAppRegistry'
import { DUR_BASE, EASE_OS } from '@/lib/motion'

interface Props {
  getApp: (pageId: string) => OsAppDefinition | undefined
  getName: (pageId: string) => string
  renderContent: (pageId: string) => ReactNode
}

/** Soft entrance/exit motion shared by floating + split windows. */
const windowMotion = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
  transition: { duration: DUR_BASE, ease: EASE_OS },
}

/**
 * Renders the open OS windows on top of the desktop (launcher):
 * floating windows (with snap layouts) plus the split-view pair.
 */
export function OsWindowOverlay({ getApp, getName, renderContent }: Props) {
  const { windows } = useOsWindows()

  const floating = windows.filter((w) => w.layout !== 'split-left' && w.layout !== 'split-right' && !w.minimized)
  const split = windows.filter((w) => w.layout === 'split-left' || w.layout === 'split-right')
  const hasSplit = split.length > 0

  if (floating.length === 0 && !hasSplit) return null

  const iconFor = (pageId: string | null) => {
    if (!pageId) return undefined
    const app = getApp(pageId)
    if (!app) return undefined
    const Icon = app.icon
    return <Icon size={15} weight="duotone" />
  }

  return (
    <div className="rumahl-os-window-layer" aria-label="Open app windows">
      {/* Split view */}
      {hasSplit && (
        <div className="rumahl-os-split">
          {(['split-left', 'split-right'] as const).map((side) => {
            const win = split.find((w) => w.layout === side)
            if (!win) return null
            return (
              <AnimatePresence key={side} initial={false}>
                <motion.div
                  key={win.pageId ?? side}
                  className="rumahl-os-split-pane"
                  {...windowMotion}
                >
                  <OsWindowFrame
                    window={win}
                    name={win.pageId ? getName(win.pageId) : ''}
                    icon={iconFor(win.pageId)}
                    renderContent={renderContent}
                  />
                </motion.div>
              </AnimatePresence>
            )
          })}
        </div>
      )}

      {/* Floating windows */}
      <AnimatePresence>
        {floating.map((win) => (
          <motion.div
            key={win.pageId}
            className="absolute left-0 top-0"
            {...windowMotion}
          >
            <OsWindowFrame
              window={win}
              name={win.pageId ? getName(win.pageId) : ''}
              icon={iconFor(win.pageId)}
              renderContent={renderContent}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
