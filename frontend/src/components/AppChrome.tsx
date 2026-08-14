import { Suspense, lazy, type ReactNode } from 'react'
import { NavigationMenu } from '@/components/NavigationMenu'
import { OsSystemShell } from '@/components/OsSystemShell'
import { OsDock } from '@/components/OsDock'
import { OsWindowOverlay } from '@/components/OsWindowOverlay'
import { MobileBottomNav } from '@/components/MobileBottomNav'
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities'
import { CommandPalette } from '@/components/CommandPalette'
import { PermissionRequestDialog } from '@/components/PermissionRequestDialog'
import { OsSessionLock } from '@/components/OsSessionLock'
import { ORAAssistant } from '@/components/ORAAssistant'
import type { OsAppDefinition } from '@/lib/osAppRegistry'

const CodingAgent = lazy(() => import('@/components/CodingAgent').then((m) => ({ default: m.CodingAgent })))

export interface AppChromeProps {
  showPageDesigner: boolean
  immersivePageId: string | null
  isOsAppPage: boolean
  isNotFoundPage: boolean
  currentPageId: string
  aiEnabled: boolean
  getOsAppName: (id: string) => string
  getOsAppIcon: (id: string) => ReactNode
  osAppByPageId: Map<string, OsAppDefinition>
  renderOsAppContent: (pageId: string, opts?: { inWindow?: boolean }) => ReactNode
}

/**
 * AppChrome — the fixed overlay layer of ORA OS (navigation menu, control
 * center, dock, status bar, window overlay, palette, assistant). Kept out of
 * DashboardContent so the page body stays focused on rendering the page.
 */
export function AppChrome({
  showPageDesigner,
  immersivePageId,
  isOsAppPage,
  isNotFoundPage,
  currentPageId,
  aiEnabled,
  getOsAppName,
  getOsAppIcon,
  osAppByPageId,
  renderOsAppContent,
}: AppChromeProps) {
  const { isPhone } = useDeviceCapabilities()
  return (
    <>
      <NavigationMenu hidden={showPageDesigner || isOsAppPage || isNotFoundPage} />
      {!showPageDesigner && <OsSystemShell />}
      {/* Dock only on launcher & OS pages — it must never cover the navbar in apps.
         On phones the bottom tab bar replaces it. */}
      {!isPhone && !showPageDesigner && !immersivePageId && (isOsAppPage || isNotFoundPage) && <OsDock />}
      <MobileBottomNav />
      {currentPageId === 'launcher' && !showPageDesigner && !immersivePageId && (
        <OsWindowOverlay
          getApp={(pageId) => osAppByPageId.get(pageId)}
          getName={getOsAppName}
          renderContent={(pageId) => renderOsAppContent(pageId, { inWindow: true })}
        />
      )}
      <CommandPalette />
      <PermissionRequestDialog />
      <OsSessionLock />
      <ORAAssistant />
      {aiEnabled && <Suspense fallback={null}><CodingAgent /></Suspense>}
    </>
  )
}
