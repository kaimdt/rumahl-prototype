import { useState, useEffect, useMemo, useRef } from 'react'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { PageNavigationProvider, usePageNavigation } from '@/contexts/PageNavigationContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import { EntityDiscoveryProvider, useEntityDiscovery } from '@/contexts/EntityDiscoveryContext'
import { DynamicOverviewProvider, useDynamicOverview, getVisibleWidgetTypes } from '@/contexts/DynamicOverviewContext'
import { useEntityStore } from '@/hooks/useEntityStore'
import { NavigationMenu } from '@/components/NavigationMenu'
import { SettingsPage } from '@/components/SettingsPage'
import { AdminPanel } from '@/components/AdminPanel'
import { DocsPage } from '@/components/DocsPage'
import { StreamSender } from '@/components/StreamSender'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { useAccentColor } from '@/hooks/useAccentColor'
import { useNightModeSettings } from '@/hooks/useNightModeSettings'
import { useGlassSettings } from '@/hooks/useGlassSettings'
import { useLocalStorage } from '@/lib/storage'
import { Toaster } from '@/components/ui/sonner'
import { DEFAULT_DASHBOARD_BACKGROUND_URL, getCardStyleClass } from '@/lib/defaults'

// Isolated clock component – only re-renders per minute in the header
function HeaderClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined
    // Sync to the next full minute, then tick every 60 s
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000
    const boot = setTimeout(() => {
      setTime(new Date())
      intervalId = setInterval(() => setTime(new Date()), 60_000)
    }, msToNextMinute)
    // Also tick once per second for the first minute so we don't miss it
    const fastTick = setInterval(() => setTime(new Date()), 1000)
    return () => {
      clearTimeout(boot)
      clearInterval(fastTick)
      if (intervalId) clearInterval(intervalId)
    }
  }, [])
  return (
    <span className="text-sm font-medium tabular-nums tracking-wide">
      {time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

// Premium loading skeletons for the dashboard
function DashboardSkeleton() {
  return (
    <div className="space-y-6 page-transition-enter">
      {/* Title skeleton */}
      <div className="skeleton-premium h-6 w-40 ml-1" />
      {/* Widget grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-premium h-[76px] rounded-2xl" style={{ animationDelay: `${i * 0.08}s` }} />
        ))}
      </div>
    </div>
  )
}

async function hashPin(pin: string): Promise<string> {
  const encoded = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function DashboardContent() {
  const { background, savePreference, getPreference } = useConfiguration()
  const { theme } = useTheme()
  const { user, isAuthenticated, isLoading: authLoading, logout, updateProfile } = useAuth()
  const { currentPageId, currentPage, modalPageId, closeModalPage, pages } = usePageNavigation()
  const { checkForNewEntities } = useEntityDiscovery()
  const { evaluateTriggers, currentVariant } = useDynamicOverview()
  const accentColorSettings = useAccentColor()
  const nightModeSettings = useNightModeSettings()
  const glassSettings = useGlassSettings()
  const [fontSize] = useLocalStorage<'small' | 'normal' | 'large'>('ha-font-size', 'normal')
  const [reducedAnimations] = useLocalStorage('ha-animations-reduced', false)
  const [compactWidgets] = useLocalStorage('ha-widget-compact', false)
  const [globalCardStyle] = useLocalStorage('ha-global-card-style', 'default')
  const { entities, loading, refresh } = useEntityStore()

  // Apply global card style class on <html> so it covers portals/modals/dialogs
  useEffect(() => {
    const root = document.documentElement
    // Remove any existing card-style-* classes
    root.classList.forEach(cls => {
      if (cls.startsWith('card-style-')) root.classList.remove(cls)
    })
    const styleClass = getCardStyleClass(globalCardStyle !== 'default' ? globalCardStyle : undefined)
    if (styleClass) root.classList.add(styleClass)
  }, [globalCardStyle])
  const userName = useMemo(() => user?.displayName || user?.username || 'Benutzer', [user])
  const [showSplash, setShowSplash] = useState(true)
  const [showPageDesigner, setShowPageDesigner] = useState(false)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [deviceLockMode, setDeviceLockMode] = useState(false)
  const [lockLoading, setLockLoading] = useState(false)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileUsername, setProfileUsername] = useState('')
  const [profileDisplayName, setProfileDisplayName] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinHash, setPinHash] = useState<string | null>(null)
  const [unlockPinInput, setUnlockPinInput] = useState('')
  const [showUnlockDialog, setShowUnlockDialog] = useState(false)
  const lastEvalRef = useRef(0)
  const hasActiveCustomBackground = Boolean(background?.is_active)

  return (
    <>
      <div
        className={`min-h-screen relative theme-transition overflow-x-hidden font-size-${fontSize}${reducedAnimations ? ' reduce-animations' : ''}${compactWidgets ? ' compact-widgets' : ''}`}
      >
        {!hasActiveCustomBackground && (
          <div
            className="fixed inset-0 bg-cover bg-center bg-no-repeat theme-transition z-0 pointer-events-none"
            style={{
              backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
              backgroundAttachment: 'fixed',
              filter: theme === 'sleep'
                ? 'brightness(0.02) grayscale(1) saturate(0)'
                : theme === 'night' ? 'brightness(0.4)'
                  : theme === 'evening' ? 'brightness(0.5)'
                    : theme === 'light' ? 'brightness(1.15) saturate(0.9)'
                      : theme === 'day' ? 'brightness(0.95) saturate(0.95)'
                        : theme === 'day-classic' ? 'brightness(0.75)'
                          : 'brightness(0.75)',
              opacity: theme === 'sleep' ? 0.15 : 1,
              transform: 'translateZ(0)',
              transition: 'filter var(--transition-duration) ease, opacity var(--transition-duration) ease',
            }}
          />
        )}

        <div
          className="fixed inset-0 z-10 pointer-events-none"
          style={{
            background: theme === 'sleep'
              ? 'black'
              : (theme === 'day' || theme === 'light')
                ? 'linear-gradient(to bottom, rgba(255,255,255,0.50), rgba(255,255,255,0.30), rgba(255,255,255,0.55))'
                : 'linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.2), rgba(0,0,0,0.6))',
            opacity: theme === 'sleep' ? 0.92 : hasActiveCustomBackground ? 0.5 : 1,
            transition: 'opacity var(--transition-duration) ease, background var(--transition-duration) ease',
          }}
        />
        {(theme === 'night' || theme === 'sleep') && nightModeSettings.nightFilterEnabled && (
          <div
            className="fixed inset-0 z-10 pointer-events-none"
            style={{
              background: theme === 'sleep' ? 'rgba(0, 0, 0, 1)' : 'rgba(35, 22, 12, 1)',
              opacity: theme === 'sleep'
                ? 0.88 * (nightModeSettings.overlayStrength / 100)
                : 0.45 * (nightModeSettings.overlayStrength / 100),
              transition: 'opacity var(--transition-duration) ease',
            }}
          />
        )}

        <div
          className="relative z-20"
          style={{
            filter: theme === 'sleep' ? 'saturate(0.25) brightness(0.65)' : 'none',
            transition: 'filter var(--transition-duration) ease',
          }}
        >
          <header
            className="glass-header theme-transition"
            style={{
              transition: 'background 0.5s ease, border-bottom 0.5s ease',
            }}
          >
            <div className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent" style={{ boxShadow: '0 0 8px oklch(from var(--accent) l c h / 0.5)' }} />
                <h1 className="text-sm font-medium tracking-[0.15em] uppercase">rumahl</h1>
                <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-foreground/25 hidden sm:block">
                  {currentPageId === 'settings' ? 'Core' : currentPageId === 'admin' ? 'Core' : currentPageId === 'docs' ? 'Docs' : currentPageId === 'streaming' ? 'Stream' : 'Home'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-foreground/40 font-light tracking-wider hidden sm:block">
                  {entities.length > 0 ? `${entities.length} Entitäten` : ''}
                </span>
                <HeaderClock />
              </div>
            </div>
          </header>

          <main className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 pb-28 sm:pb-32">
            <div className="space-y-6">
              {currentPageId === 'settings' && (
                <SettingsPage theme={theme} />
              )}
              {currentPageId === 'admin' && user?.isAdmin && (
                <AdminPanel />
              )}
              {currentPageId === 'docs' && (
                <DocsPage />
              )}
              {currentPageId === 'streaming' && (
                <StreamSender />
              )}
              {currentPageId === 'connection' && (
                <div className="p-6">
                  <ConnectionSettings />
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
      <NavigationMenu hidden={showPageDesigner} />
    </>
  )
}

function App() {
  return (
    <ConnectionProvider>
      <AuthProvider>
        <ThemeProvider>
          <PageNavigationProvider>
            <ConfigurationProvider>
              <EntityDiscoveryProvider>
                <DynamicOverviewProvider>
                  <NotificationProvider>
                    <DashboardContent />
                  </NotificationProvider>
                  <Toaster />
                </DynamicOverviewProvider>
              </EntityDiscoveryProvider>
            </ConfigurationProvider>
          </PageNavigationProvider>
        </ThemeProvider>
      </AuthProvider>
    </ConnectionProvider>
  )
}

export default App
