import type { ReactNode } from 'react'
import { useOsWindows } from '@/contexts/OsWindowContext'
import { OsWindowFrame } from '@/components/OsWindowFrame'
import type { OsAppDefinition } from '@/lib/osAppRegistry'

interface Props {
  getApp: (pageId: string) => OsAppDefinition | undefined
  getName: (pageId: string) => string
  renderContent: (pageId: string) => ReactNode
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
    <div className="ora-os-window-layer" aria-label="Open app windows">
      {/* Split view */}
      {hasSplit && (
        <div className="ora-os-split">
          {(['split-left', 'split-right'] as const).map((side) => {
            const win = split.find((w) => w.layout === side)
            if (!win) return null
            return (
              <div key={side} className="ora-os-split-pane">
                <OsWindowFrame
                  window={win}
                  name={win.pageId ? getName(win.pageId) : ''}
                  icon={iconFor(win.pageId)}
                  renderContent={renderContent}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Floating windows */}
      {floating.map((win) => (
        <OsWindowFrame
          key={win.pageId}
          window={win}
          name={win.pageId ? getName(win.pageId) : ''}
          icon={iconFor(win.pageId)}
          renderContent={renderContent}
        />
      ))}
    </div>
  )
}
