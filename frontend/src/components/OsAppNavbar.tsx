import type { ReactNode } from 'react'
import { OsWindowActions } from '@/components/OsWindowActions'

/**
 * OsAppNavbar — the unified title bar for every rumahl OS app.
 *
 * Mirrors the Files explorer navbar (the reference design): a gradient app
 * mark, the app name + description, an optional toolbar row, an optional
 * search field, and the window actions (minimize / maximize / launch modes /
 * close). Using one shared component guarantees every app reads identically.
 *
 * The grid is container-based: columns shrink with `minmax(0, …)`, the title
 * truncates, and leading/search/trailing wrap onto a second row on narrow
 * windows (via the `.rumahl-app-navbar` media below) so it never overflows.
 */
export function OsAppNavbar({
  pageId,
  title,
  description,
  icon,
  iconUrl,
  leading,
  search,
  trailing,
}: {
  pageId: string
  title: string
  description?: string
  icon?: ReactNode
  iconUrl?: string
  /** oklch accent color used for the app-mark gradient. */
  accent?: string
  /** Toolbar controls rendered in the second navbar column. */
  leading?: ReactNode
  /** Search field rendered in the third column (use .rumahl-toolbar-search). */
  search?: ReactNode
  /** Extra controls rendered before the window actions. */
  trailing?: ReactNode
}) {
  return (
    <header className="rumahl-app-navbar">
      <div className="rumahl-app-titlebar">
        <div className="rumahl-app-identity min-w-0 flex items-center gap-2">
          {(iconUrl || icon) && <span className="rumahl-app-mark shrink-0">
            {iconUrl ? <img src={iconUrl} alt="" width={18} height={18} className="object-contain" draggable={false} /> : icon}
          </span>}
          <div className="min-w-0">
            <h1 className="rumahl-os-window-title truncate">{title}</h1>
            {description && <p className="rumahl-app-description hidden truncate text-xs text-ui-secondary sm:block">{description}</p>}
          </div>
        </div>
        <OsWindowActions pageId={pageId} />
      </div>
      {(leading || search || trailing) && <div className="rumahl-app-tools">
        {leading && <div className="rumahl-app-leading">{leading}</div>}
        {search && <div className="rumahl-app-search">{search}</div>}
        {trailing && <div className="rumahl-app-actions">{trailing}</div>}
      </div>}
    </header>
  )
}
