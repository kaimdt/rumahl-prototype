import React, { useEffect, useState } from "react";
import { ErrorBoundary } from 'react-error-boundary'
import { ErrorFallback } from './ErrorFallback'
import { initApiBase } from '@/lib/apiBase'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { PageNavigationProvider } from '@/contexts/PageNavigationContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
import { EntityDiscoveryProvider } from '@/contexts/EntityDiscoveryContext'
import { DynamicOverviewProvider } from '@/contexts/DynamicOverviewContext'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { TitleBar } from "./components/TitleBar"
import { DashboardContent } from "./components/DashboardContent"
import { Toaster } from '@/components/ui/sonner'

export default function App() {
  const [ready, setReady] = useState(false)

  // Load the remote IORA Home URL from Tauri config before rendering
  useEffect(() => {
    initApiBase().then(() => setReady(true))
  }, [])

  if (!ready) return null

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
        </div>
      </div>
    </ErrorBoundary>
  );
}
