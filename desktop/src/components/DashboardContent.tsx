/**
 * @ai-info IORA Desktop – DashboardContent.tsx
 *
 * This is the main content shell for the IORA Desktop Tauri client.
 * It renders ONLY:
 *   - The Desktop Settings page (SettingsPage — local Tauri config, no auth needed)
 *   - Admin panel, Docs, Streaming, Connection settings
 *   - A glass header bar
 *   - The NavigationMenu
 *
 * ALL legacy IORA Home widgets (lights, climate, switches, sensors,
 * custom pages, splash screen, login modal, screensaver, maintenance mode,
 * emergency overlays, etc.) have been REMOVED. Those live in the IORA Home
 * frontend and are loaded via RemoteHomeView when connected.
 */
import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useConfiguration } from '@/contexts/ConfigurationContext'
import { SettingsPage } from '@/components/SettingsPage'
import { AdminPanel } from '@/components/AdminPanel'
import { DocsPage } from '@/components/DocsPage'
import { StreamSender } from '@/components/StreamSender'
import { ConnectionSettings } from '@/components/ConnectionSettings'
import { RemoteHomeView } from '@/components/RemoteHomeView'
import { NavigationMenu } from '@/components/NavigationMenu'
import { useAccentColor } from '@/hooks/useAccentColor'
import { useNightModeSettings } from '@/hooks/useNightModeSettings'
import { useGlassSettings } from '@/hooks/useGlassSettings'
import { useLocalStorage } from '@/lib/storage'
import { DEFAULT_DASHBOARD_BACKGROUND_URL, getCardStyleClass } from '@/lib/defaults'
import { getApiBase } from '@/lib/apiBase'

// Isolated clock component – only re-renders per minute in the header
function HeaderClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000
    const boot = setTimeout(() => {
      setTime(new Date())
      intervalId = setInterval(() => setTime(new Date()), 60_000)
    }, msToNextMinute)
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

export function DashboardContent() {
  const { background } = useConfiguration()
  const { theme } = useTheme()
  const { user } = useAuth()
  const { currentPageId, setCurrentPageId } = usePageNavigation()
  useAccentColor()
  const nightModeSettings = useNightModeSettings()
  useGlassSettings()
  const [fontSize] = useLocalStorage<'small' | 'normal' | 'large'>('ha-font-size', 'normal')
  const [reducedAnimations] = useLocalStorage('ha-animations-reduced', false)
  const [compactWidgets] = useLocalStorage('ha-widget-compact', false)
  const [globalCardStyle] = useLocalStorage('ha-global-card-style', 'default')

  const hasActiveCustomBackground = Boolean(background?.is_active)
  const remoteHomeUrl = getApiBase()
  const isRemoteHome = currentPageId === 'home' && Boolean(remoteHomeUrl)

  // Apply global card style class on <html>
  useEffect(() => {
    const root = document.documentElement
    root.classList.forEach(cls => {
      if (cls.startsWith('card-style-')) root.classList.remove(cls)
    })
    const styleClass = getCardStyleClass(globalCardStyle !== 'default' ? globalCardStyle : undefined)
    if (styleClass) root.classList.add(styleClass)
  }, [globalCardStyle])

  // When no remote home is configured, always show settings
  useEffect(() => {
    if (isRemoteHome) {
      if (!['home', 'settings', 'connection'].includes(currentPageId)) {
        setCurrentPageId('home')
      }
    } else if (!['settings', 'connection', 'admin', 'docs', 'streaming'].includes(currentPageId)) {
      setCurrentPageId('settings')
    }
  }, [isRemoteHome, currentPageId, setCurrentPageId])

  // Listen for desktop-open-settings event from the TitleBar
  useEffect(() => {
    const openSettings = () => setCurrentPageId('settings')
    window.addEventListener('desktop-open-settings', openSettings)
    return () => window.removeEventListener('desktop-open-settings', openSettings)
  }, [setCurrentPageId])

  // If RemoteHome is configured and we're on home page, show the remote view
  if (isRemoteHome) {
    return <RemoteHomeView />
  }

  return (
    <>
      <div
        className={`flex-1 min-h-0 relative theme-transition overflow-x-hidden overflow-y-auto font-size-${fontSize}${reducedAnimations ? ' reduce-animations' : ''}${compactWidgets ? ' compact-widgets' : ''}`}
      >
        {/* Background layer */}
        {!hasActiveCustomBackground && (
          <div
            className="fixed inset-0 bg-cover bg-center bg-no-repeat theme-transition z-0 pointer-events-none"
            style={{
              backgroundImage: `url('${DEFAULT_DASHBOARD_BACKGROUND_URL}')`,
              backgroundAttachment: 'fixed',
              filter: theme === 'sleep'
                ? 'brightness(0.02) grayscale(1) saturate(0)'
                : theme === 'night' ? 'brightness(0.4)'
                  : theme === 'light' ? 'brightness(1.15) saturate(0.9)'
                    : theme === 'day' ? 'brightness(0.95) saturate(0.95)'
                      : 'brightness(0.75)',
              opacity: theme === 'sleep' ? 0.15 : 1,
              transform: 'translateZ(0)',
              transition: 'filter var(--transition-duration) ease, opacity var(--transition-duration) ease',
            }}
          />
        )}

        {/* Gradient overlay */}
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

        {/* Night filter */}
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

        {/* Main content */}
        <div
          className="relative z-20"
          style={{
            overflow: 'scroll',
            height: '100vh',
            filter: theme === 'sleep' ? 'saturate(0.25) brightness(0.65)' : 'none',
            transition: 'filter var(--transition-duration) ease',
          }}
        >
          <header
            className="glass-header theme-transition"
            style={{ transition: 'background 0.5s ease, border-bottom 0.5s ease' }}
          >
            <div className="max-w-[1500px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-accent" style={{ boxShadow: '0 0 8px oklch(from var(--accent) l c h / 0.5)' }} />
                <h1 className="text-sm font-medium tracking-[0.15em] uppercase">IORA</h1>
                <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-foreground/25 hidden sm:block">
                  {currentPageId === 'settings' ? 'Desktop' : currentPageId === 'admin' ? 'Admin' : currentPageId === 'docs' ? 'Docs' : currentPageId === 'streaming' ? 'Stream' : 'Desktop'}
                </span>
              </div>
              <div className="flex items-center gap-4">
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
      <NavigationMenu />
    </>
  )
}
