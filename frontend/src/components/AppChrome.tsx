import { Suspense, lazy, type ReactNode } from 'react'
import { NavigationMenu } from '@/components/NavigationMenu'
import { OsSystemShell } from '@/components/OsSystemShell'
import { OsDock } from '@/components/OsDock'
import { OsFullscreenBar } from '@/components/OsFullscreenBar'
import { OsWindowOverlay } from '@/components/OsWindowOverlay'
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
  return (
    <>
      <NavigationMenu hidden={showPageDesigner || isOsAppPage || isNotFoundPage} />
      {!showPageDesigner && !immersivePageId && <OsSystemShell />}
      {/* Dock only on launcher & OS pages — it must never cover the navbar in apps */}
      {!showPageDesigner && !immersivePageId && (isOsAppPage || isNotFoundPage) && <OsDock />}
      {/* Slim OS status bar on every page (like the launcher). Window actions
         only appear inside immersive (true fullscreen) apps. */}
      {!showPageDesigner && (
        <OsFullscreenBar
          pageId={immersivePageId || currentPageId}
          name={getOsAppName(immersivePageId || currentPageId)}
          icon={getOsAppIcon(immersivePageId || currentPageId) ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/15 text-accent">{getOsAppIcon(immersivePageId || currentPageId)}</span>
          ) : undefined}
        />
      )}
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
