import type { ReactNode } from 'react'
import { OsAppNavbar } from '@/components/OsAppNavbar'
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
  return (
    <OsAppFrame
      className={`rumahl-app-frame ${noClip ? 'rumahl-app-frame-no-clip' : ''}`}
      navbar={(
        <OsAppNavbar pageId={pageId} title={title} icon={icon} />
      )}
      contentClassName="rumahl-os-app-content-padded"
    >
      {children}
    </OsAppFrame>
  )
}
