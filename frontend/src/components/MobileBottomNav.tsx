import { House, Gear, SquaresFour } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useDeviceCapabilities } from '@/hooks/useDeviceCapabilities'
import { useShellMode } from '@/hooks/useShellMode'

/**
 * MobileBottomNav — a compact bottom tab bar shown only on phones AND outside
 * the iOS/Android-style launcher. In launcher mode the OS dock is the app rail
 * instead, so this bar is suppressed there (it would otherwise duplicate/cover
 * the dock). It provides Home / Apps / Settings for one-thumb navigation.
 */
export function MobileBottomNav() {
  const { t } = useTranslation()
  const { currentPageId, setCurrentPageId } = usePageNavigation()
  const { isPhone } = useDeviceCapabilities()
  const { resolvedMode } = useShellMode()

  if (!isPhone || resolvedMode === 'launcher') return null

  const tabs = [
    { id: 'home', label: t('os.apps.home.name'), icon: House },
    { id: 'launcher', label: t('os.shell.apps'), icon: SquaresFour },
    { id: 'settings', label: t('os.apps.settings.name'), icon: Gear },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[65] border-t border-foreground/10 bg-background/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-3">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = currentPageId === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCurrentPageId(tab.id)}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${active ? 'text-accent' : 'text-foreground/55'}`}
            >
              <Icon size={22} weight={active ? 'fill' : 'regular'} />
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
