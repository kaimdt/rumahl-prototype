import React, { useState, useEffect } from 'react'
import { Sparkle, Gear, Clock, CalendarBlank, Info } from '@phosphor-icons/react'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { useAuth } from '@/contexts/AuthContext'
import { useConnection } from '@/contexts/ConnectionContext'
import { HomeAssistantOnboarding } from '@/components/HomeAssistantOnboarding'

export function SimpleDashboard() {
  const { setCurrentPageId } = usePageNavigation()
  const { user } = useAuth()
  const { backend, haConfigured } = useConnection()
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const isAdmin = user?.isAdmin || user?.role === 'admin'

  return (
    <div className="page-transition-enter">
      <div className="max-w-4xl mx-auto mt-8 sm:mt-16 px-4 space-y-6">

        {/* Top Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="glass-card rounded-3xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
              <Clock size={24} weight="duotone" className="text-accent" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">Uhrzeit</p>
              <p className="text-2xl font-bold text-foreground">
                {time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          <div className="glass-card rounded-3xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
              <CalendarBlank size={24} weight="duotone" className="text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">Datum</p>
              <p className="text-xl font-bold text-foreground">
                {time.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}
              </p>
            </div>
          </div>

          <div className="glass-card rounded-3xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
              <Info size={24} weight="duotone" className="text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/60 uppercase tracking-wider">System</p>
              <p className="text-xl font-bold text-foreground">
                {backend === 'connected' ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>
        </div>

        {isAdmin && haConfigured === false && <HomeAssistantOnboarding onComplete={() => window.location.reload()} />}

        {/* Welcome Section */}
        <div className="glass-card rounded-3xl p-8 sm:p-12">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="flex-1 space-y-4 text-center md:text-left">
              <h2 className="text-3xl font-semibold tracking-tight">IORA Simple Dashboard</h2>
              <p className="text-sm text-foreground/80 leading-relaxed max-w-xl">
                Willkommen bei IORA OS. Aktuell ist das Advanced Dashboard pausiert oder deaktiviert.
                Das System arbeitet normal weiter und lokale Dienste stehen zur Verfügung.
              </p>
              {isAdmin && (
                <div className="pt-4">
                  <button
                    className="btn btn-secondary px-5 py-2.5 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15 transition flex items-center justify-center gap-2 mx-auto md:mx-0"
                    onClick={() => setCurrentPageId('admin')}
                  >
                    <Gear size={18} />
                    IORA Control Center öffnen
                  </button>
                </div>
              )}
            </div>

            {/* Call to action for HA */}
            {isAdmin && (
              <div className="md:w-72 bg-foreground/5 rounded-2xl p-6 text-center border border-foreground/10 shrink-0">
                <div className="mx-auto w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center mb-4">
                  <Sparkle size={24} weight="duotone" className="text-accent" />
                </div>
                <h3 className="font-medium text-foreground mb-2">Advanced Dashboard</h3>
                <p className="text-xs text-foreground/60 mb-4">
                  Für das volle Smart-Home Erlebnis und Zugriff auf alle Integrationen kannst du Home Assistant in den Einstellungen aktivieren.
                </p>
                <button
                  className="w-full btn btn-primary py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-accent/90 transition"
                  onClick={() => setCurrentPageId('admin')}
                >
                  Konfigurieren
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
