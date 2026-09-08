import type { ReactNode } from 'react'

/**
 * Shared application layout used by both desktop windows and fullscreen
 * launcher apps. The shell owns the outer window chrome; applications only
 * provide their navigation, toolbar, sidebar, content, and optional details.
 */
export function OsAppFrame({
  navbar,
  toolbar,
  sidebar,
  children,
  detail,
  className = '',
  contentClassName = '',
}: {
  navbar?: ReactNode
  toolbar?: ReactNode
  sidebar?: ReactNode
  children: ReactNode
  detail?: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section className={`rumahl-os-app-frame ${className}`.trim()}>
      {navbar}
      {toolbar && <div className="rumahl-os-app-toolbar">{toolbar}</div>}
      <div className="rumahl-os-app-body">
        {sidebar && <aside className="rumahl-os-app-sidebar">{sidebar}</aside>}
        <div className={`rumahl-os-app-content ${contentClassName}`.trim()}>{children}</div>
        {detail && <aside className="rumahl-os-app-detail">{detail}</aside>}
      </div>
    </section>
  )
}
