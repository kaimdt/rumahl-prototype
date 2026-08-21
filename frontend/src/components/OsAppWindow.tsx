import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OsWindowActions } from '@/components/OsWindowActions'

/**
 * OS-style app window: a rounded Liquid-Glass frame with a slim title bar
 * (app name + window actions). Used by embedded system apps so every app
 * reads as a proper window instead of a floating page.
 */
export function OsAppWindow({
  pageId,
  title,
  icon,
  noClip = false,
  children,
}: {
  pageId: string
  title: string
  icon?: ReactNode
  noClip?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className={`rumahl-app-frame flex flex-col ${noClip ? 'rumahl-app-frame-no-clip' : ''}`}>
      <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-foreground/8 px-4 sm:px-5">
        {icon && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-md" style={{ background: 'linear-gradient(145deg, oklch(0.62 0.14 265), oklch(0.45 0.12 280))' }}>{icon}</span>}
        <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.16em] text-foreground/50">{title}</span>
        <span className="flex-1" />
        <OsWindowActions pageId={pageId} />
      </div>
      <div className="min-w-0 flex-1 p-4 sm:p-6">{children}</div>
    </div>
  )
}
