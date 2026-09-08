import React, { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from './ErrorFallback'
import { initApiBase } from '@/lib/apiBase'
import { checkAndInvalidateCache, startVersionPoller, VERSION_POLL_INTERVAL_MS } from '@/lib/versionCheck'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { PageNavigationProvider } from '@/contexts/PageNavigationContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
import { CurrentBackgroundProvider } from '@/contexts/CurrentBackgroundContext'
import { EntityDiscoveryProvider } from '@/contexts/EntityDiscoveryContext'
import { DynamicOverviewProvider } from '@/contexts/DynamicOverviewContext'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { TitleBar } from "./components/TitleBar"
import { DashboardContent } from "./components/DashboardContent"
import { ORAOverlay } from "./ORAOverlay"
import { Toaster } from '@/components/ui/sonner'
import { getPlatform, applyPlatformClass } from '@/hooks/usePlatform'
import { useWindowPersistence } from '@/hooks/useWindowPersistence'
import type { Platform } from '@/lib/tauri'

// ─── Apply Liquid Glass on macOS ───────────────────────────────────────
async function initLiquidGlass() {
  try {
    const { isGlassSupported, setLiquidGlassEffect } = await import('tauri-plugin-liquid-glass-api')
    const supported = await isGlassSupported()
    if (supported) {
      await setLiquidGlassEffect()
      console.log('[App] Liquid Glass effect enabled')
    }
  } catch {
    // Plugin not available or not on macOS
  }
}

export default function App() {
  const [ready, setReady] = useState(false)
  const stopPollerRef = useRef<(() => void) | null>(null)
  const [windowLabel, setWindowLabel] = useState<string>('')

  // Persist window position and size across restarts
  useWindowPersistence()

  // Detect which window we're in based on URL or window label
  useEffect(() => {
    const path = window.location.pathname
    if (path === '/rumahl-overlay') {
      setWindowLabel('rumahl-overlay')
      setReady(true)
      return
    }
    setWindowLabel('main')

    // Apply platform class and data attribute
    const platform = getPlatform()
    applyPlatformClass(platform)
    document.documentElement.setAttribute('data-platform', platform)
  }, [])

  // Load the remote rumahl Home URL from Tauri config, then check the server
  // version. If the version has changed since the last run, cached rumahl Home
  // files are cleared so fresh data is fetched. API requests are never cached.
  useEffect(() => {
    let cancelled = false

    initApiBase().then(async () => {
      // Check version and invalidate stale cache before the first render
      await checkAndInvalidateCache()
      if (!cancelled) {
        // Start a background poller that re-checks every 5 minutes
        stopPollerRef.current = startVersionPoller(VERSION_POLL_INTERVAL_MS)
        setReady(true)
      }
    })

    return () => {
      cancelled = true
      stopPollerRef.current?.()
    }
  }, [])

  if (!ready) return null

  // Render rumahl overlay window
  if (windowLabel === 'rumahl-overlay') {
    return (
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <ORAOverlay />
      </ErrorBoundary>
    )
  }

  // Render main dashboard window
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <AuthProvider>
        <div className="flex flex-col h-screen overflow-hidden">
          <PageNavigationProvider>
            <TitleBar />
            <div className="flex-1 overflow-hidden flex flex-col">
              <ConnectionProvider>
                <ThemeProvider>
                  <ConfigurationProvider>
                    <CurrentBackgroundProvider>
                      <EntityDiscoveryProvider>
                        <DynamicOverviewProvider>
                          <NotificationProvider>
                            <DashboardContent />
                          </NotificationProvider>
                          <Toaster />
                        </DynamicOverviewProvider>
                      </EntityDiscoveryProvider>
                    </CurrentBackgroundProvider>
                  </ConfigurationProvider>
                </ThemeProvider>
              </ConnectionProvider>
            </div>
          </PageNavigationProvider>
        </div>
      </AuthProvider>
    </ErrorBoundary>
  );
}
