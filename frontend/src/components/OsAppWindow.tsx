import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OsWindowActions } from '@/components/OsWindowActions'
import { OsAppFrame } from '@/components/OsAppFrame'

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
    <OsAppFrame
      className={`rumahl-app-frame ${noClip ? 'rumahl-app-frame-no-clip' : ''}`}
      navbar={(
        <div className="rumahl-os-window-titlebar">
          {icon && <span className="rumahl-os-window-app-icon">{icon}</span>}
          <span className="rumahl-os-window-title">{title}</span>
          <span className="flex-1" />
          <OsWindowActions pageId={pageId} />
        </div>
      )}
      contentClassName="rumahl-os-app-content-padded"
    >
      {children}
    </OsAppFrame>
  )
}
