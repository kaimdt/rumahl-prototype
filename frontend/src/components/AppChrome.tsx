import { Suspense, type ReactNode } from 'react'
import { NavigationMenu } from '@/components/NavigationMenu'
import { OsSystemShell } from '@/components/OsSystemShell'
import { OsDock } from '@/components/OsDock'
import { OsWindowOverlay } from '@/components/OsWindowOverlay'
import { MobileBottomNav } from '@/components/MobileBottomNav'
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities'
import { useLocalStorage } from '@/lib/storage'
import { useAppSettings } from '@/hooks/useAppSettings'
import { LockKey, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandPalette } from '@/components/CommandPalette'
import { PermissionRequestDialog } from '@/components/PermissionRequestDialog'
import { OsSessionLock } from '@/components/OsSessionLock'
import { useOsWindows } from '@/contexts/OsWindowContext'
import type { OsAppDefinition } from '@/lib/osAppRegistry'
import { useShellMode } from '@/hooks/useShellMode'

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
 * AppChrome — the fixed overlay layer of rumahl OS (navigation menu, control
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
  const { resolvedMode } = useShellMode()
  const { windows } = useOsWindows()
  const [kioskMode, setKioskMode] = useLocalStorage<boolean>('rumahl-kiosk-mode', false)
  const { verifyPin } = useAppSettings()
  const { t } = useTranslation()
  const [exitPrompt, setExitPrompt] = useState(false)
  const [exitPin, setExitPin] = useState('')
  const [exitError, setExitError] = useState(false)

  useEffect(() => {
    if (!kioskMode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExitPrompt((v) => !v) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kioskMode])

  const tryExitKiosk = async () => {
    const ok = await verifyPin(exitPin)
    if (ok) {
      setKioskMode(false)
      setExitPrompt(false)
      setExitPin('')
      setExitError(false)
    } else {
      setExitError(true)
      setExitPin('')
    }
  }

  if (kioskMode) {
    // Kiosk mode: full-screen dashboard without navigation chrome. Escape
    // opens a PIN prompt to leave kiosk (PIN = the account/device PIN).
    return <>
      <OsSessionLock />
      {exitPrompt && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md" onClick={() => setExitPrompt(false)}>
          <div className="rumahl-card w-full max-w-xs rounded-2xl p-5 text-foreground" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">{t('os.kiosk.exit')}</p>
              <button type="button" onClick={() => setExitPrompt(false)} className="rounded-lg p-1.5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"><X size={16} /></button>
            </div>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              value={exitPin}
              onChange={(e) => { setExitPin(e.target.value.replace(/\D/g, '').slice(0, 8)); setExitError(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void tryExitKiosk() }}
              placeholder="PIN"
              className="w-full rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            {exitError && <p className="mt-2 text-xs text-red-400">{t('os.kiosk.wrongPin')}</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setExitPrompt(false)} className="flex-1 rounded-xl bg-foreground/8 px-3 py-2 text-sm">{t('common.cancel')}</button>
              <button type="button" onClick={() => void tryExitKiosk()} className="flex-1 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white">{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  }
  return (
    <>
      <NavigationMenu hidden={showPageDesigner || isOsAppPage || isNotFoundPage} />
      {!showPageDesigner && <OsSystemShell />}
      {/* Dock/launcher rail: on the iOS/Android-style launcher it is the app
         rail on phones AND desktop; in desktop mode it is the Windows-style
         taskbar. It must never cover the navbar inside apps. */}
      {!showPageDesigner && !immersivePageId && (
        (resolvedMode === 'launcher' || (!isPhone && (resolvedMode === 'desktop' || isOsAppPage || isNotFoundPage))) && <OsDock />
      )}
      <MobileBottomNav />
      {/* Window overlay — visible whenever windows are open. In desktop mode
         this is independent of `currentPageId` so that navigating within an
         app (multiple pages) keeps the windows drawn on top instead of
         collapsing them into a full-page render. In launcher mode the overlay
         also stays while a window is open, but it is hidden by CSS whenever
         launcher-mode layouts are active. */}
      {windows.length > 0 && !showPageDesigner && !immersivePageId && (
        <OsWindowOverlay
          getApp={(pageId) => osAppByPageId.get(pageId)}
          getName={getOsAppName}
          renderContent={(pageId) => renderOsAppContent(pageId, { inWindow: true })}
        />
      )}
      <CommandPalette />
      <PermissionRequestDialog />
      <OsSessionLock />
    </>
  )
}
