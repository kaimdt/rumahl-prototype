import type { ReactNode } from 'react'
import { GlobalConfigProvider } from '@/hooks/useGlobalConfig'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ThemeIframeProvider } from '@/components/ThemeIframeProvider'
import { PageNavigationProvider } from '@/contexts/PageNavigationContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
import { CurrentBackgroundProvider } from '@/contexts/CurrentBackgroundContext'
import { EntityDiscoveryProvider } from '@/contexts/EntityDiscoveryContext'
import { DynamicOverviewProvider } from '@/contexts/DynamicOverviewContext'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { OsWindowProvider } from '@/contexts/OsWindowContext'
import { SetupWizardOverlay } from '@/components/SetupWizardOverlay'
import { Toaster } from '@/components/ui/sonner'

/**
 * AppProviders — the composable provider tree of the ORA OS foundation.
 * Kept in one place so adding a new provider is a single, obvious change.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GlobalConfigProvider>
      <ConnectionProvider>
        <AuthProvider>
          <ThemeProvider>
            <ThemeIframeProvider />
            <PageNavigationProvider>
              <ConfigurationProvider>
                <CurrentBackgroundProvider>
                  <EntityDiscoveryProvider>
                    <DynamicOverviewProvider>
                      <NotificationProvider>
                        <SetupWizardOverlay>
                          <OsWindowProvider>{children}</OsWindowProvider>
                        </SetupWizardOverlay>
                      </NotificationProvider>
                      <Toaster />
                    </DynamicOverviewProvider>
                  </EntityDiscoveryProvider>
                </CurrentBackgroundProvider>
              </ConfigurationProvider>
            </PageNavigationProvider>
          </ThemeProvider>
        </AuthProvider>
      </ConnectionProvider>
    </GlobalConfigProvider>
  )
}
