import type { CSSProperties, ReactNode } from 'react'
import { OsWindowActions } from '@/components/OsWindowActions'

/**
 * OsAppNavbar — the unified title bar for every ORA OS app.
 *
 * Mirrors the Files explorer navbar (the reference design): a gradient app
 * mark, the app name + description, an optional toolbar row, an optional
 * search field, and the three window actions (minimize / detach / close).
 * Using one shared component guarantees every app reads identically.
 */
export function OsAppNavbar({
  pageId,
  title,
  description,
  icon,
  iconUrl,
  accent,
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
  /** Search field rendered in the third column (use .ora-toolbar-search). */
  search?: ReactNode
  /** Extra controls rendered before the window actions. */
  trailing?: ReactNode
}) {
  const markStyle: CSSProperties | undefined = accent
    ? {
        background: `linear-gradient(145deg, color-mix(in oklch, ${accent} 88%, white), color-mix(in oklch, ${accent} 72%, black))`,
      }
    : undefined

  return (
    <header className="ora-app-navbar">
      <div className="flex min-w-0 items-center gap-3">
        <span className="ora-app-mark" style={markStyle}>
          {iconUrl ? (
            <img src={iconUrl} alt="" width={28} height={28} className="object-contain" draggable={false} />
          ) : (
            icon
          )}
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold">{title}</p>
          {description && <p className="hidden text-xs text-foreground/45 sm:block">{description}</p>}
        </div>
      </div>
      {leading ? <div className="flex items-center gap-2">{leading}</div> : <span aria-hidden="true" />}
      {search ? <>{search}</> : <span aria-hidden="true" />}
      <div className="flex items-center gap-2">
        {trailing}
        <span className="mx-0.5 h-6 w-px bg-foreground/10" aria-hidden="true" />
        <OsWindowActions pageId={pageId} />
      </div>
    </header>
  )
}
