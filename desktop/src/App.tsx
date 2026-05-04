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

export default function App() {
  const [ready, setReady] = useState(false)
  const stopPollerRef = useRef<(() => void) | null>(null)
  const [windowLabel, setWindowLabel] = useState<string>('')

  // Detect which window we're in based on URL or window label
  useEffect(() => {
    const path = window.location.pathname
    if (path === '/ora-overlay') {
      setWindowLabel('ora-overlay')
      setReady(true)
      return
    }
    setWindowLabel('main')
  }, [])

  // Load the remote IORA Home URL from Tauri config, then check the server
  // version. If the version has changed since the last run, cached IORA Home
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

  // Render ORA overlay window
  if (windowLabel === 'ora-overlay') {
    return (
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <ORAOverlay />
      </ErrorBoundary>
    )
  }

  // Render main dashboard window
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <div className="flex flex-col h-screen overflow-hidden">
        {/* Tauri Custom Titlebar */}
        <TitleBar />

        {/* Dashboard Content with all providers */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <ConnectionProvider>
            <AuthProvider>
              <ThemeProvider>
                <PageNavigationProvider>
                  <ConfigurationProvider>
                    <CurrentBackgroundProvider>
                    <EntityDiscoveryProvider>
                      <DynamicOverviewProvider>
                        <NotificationProvider>
                          <DashboardContent />
                        </NotificationProvider>
                        <Toaster />
                    </CurrentBackgroundProvider>
                      </DynamicOverviewProvider>
                    </EntityDiscoveryProvider>
                  </ConfigurationProvider>
                </PageNavigationProvider>
              </ThemeProvider>
            </AuthProvider>
          </ConnectionProvider>
        </div>
      </div>
    </ErrorBoundary>
  );
}
