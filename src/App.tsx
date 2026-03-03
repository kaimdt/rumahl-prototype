import { useState, useEffect } from 'react'
import { useLocalStorage } from '@/lib/storage'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { PageNavigationProvider, usePageNavigation } from '@/contexts/PageNavigationContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { EntityDiscoveryProvider, useEntityDiscovery } from '@/contexts/EntityDiscoveryContext'
import { haService } from '@/lib/homeAssistant'
import { WeatherWidget } from '@/components/widgets/WeatherWidget'
import { LightWidget } from '@/components/widgets/LightWidget'
import { ClimateWidget } from '@/components/widgets/ClimateWidget'
import { SwitchWidget } from '@/components/widgets/SwitchWidget'
import { SensorWidget } from '@/components/widgets/SensorWidget'
import { AnalogClock } from '@/components/widgets/AnalogClock'
import { DigitalClock } from '@/components/widgets/DigitalClock'
import { CalendarWidget } from '@/components/widgets/CalendarWidget'
import { SceneSelector } from '@/components/scenes/SceneSelector'
import { NavigationMenu } from '@/components/NavigationMenu'
import { SplashScreen } from '@/components/SplashScreen'
import { ConnectionStatus, BackendUnavailableOverlay } from '@/components/ConnectionStatus'
import { EntityDiscoveryNotification } from '@/components/EntityDiscoveryNotification'
import type { EntityState, WeatherEntity, LightEntity, ClimateEntity, SwitchEntity, SensorEntity } from '@/lib/types'
import { Sparkle, Check } from '@phosphor-icons/react'
import { Toaster } from '@/components/ui/sonner'

function DashboardContent() {
  const { theme } = useTheme()
  const { currentPageId } = usePageNavigation()
  const { checkForNewEntities } = useEntityDiscovery()
  const [entities, setEntities] = useState<EntityState[]>([])
  const [loading, setLoading] = useState(true)
  const [userName] = useLocalStorage<string>('ha-username', 'Kai')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const loadEntities = async () => {
    try {
      const states = await haService.getStates()
      setEntities(states)
      checkForNewEntities(states)
      setLoading(false)
    } catch (error) {
      console.error('Failed to load entities:', error)
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEntities()
    const interval = setInterval(loadEntities, 30000)
    return () => clearInterval(interval)
  }, [])

  const weatherEntity = entities.find(e => e.entity_id.startsWith('weather.')) as WeatherEntity | undefined
  const lightEntities = entities.filter(e => e.entity_id.startsWith('light.')) as LightEntity[]
  const climateEntities = entities.filter(e => e.entity_id.startsWith('climate.')) as ClimateEntity[]
  const switchEntities = entities.filter(e => e.entity_id.startsWith('switch.')) as SwitchEntity[]
  const sensorEntities = entities.filter(e => e.entity_id.startsWith('sensor.')) as SensorEntity[]

  const getGreeting = () => {
    const hour = currentTime.getHours()
    if (hour >= 5 && hour < 12) return 'Guten Morgen'
    if (hour >= 12 && hour < 18) return 'Guten Tag'
    if (hour >= 18 && hour < 22) return 'Guten Abend'
    return 'Gute Nacht'
  }

  const getContextMessage = () => {
    const hour = currentTime.getHours()
    const location = weatherEntity?.attributes.friendly_name || 'Kissing'
    const temp = weatherEntity?.attributes.temperature || 20

    if (hour >= 5 && hour < 12) {
      return `heute ist ein schöner Tag, das Wetter in ${location} beträgt ${Math.round(temp)}°C bei klarem Himmel. Heute sind keine Termine geplant. Ich habe keine weiteren Meldungen.`
    } else if (hour >= 12 && hour < 18) {
      return `einen angenehmen Nachmittag. Keine anstehenden Termine oder Benachrichtigungen.`
    } else if (hour >= 18 && hour < 22) {
      return `Zeit zum Entspannen. Die Beleuchtung wurde für den Abend optimiert.`
    } else {
      return `Ruhige Nacht. Alle Systeme im Standby-Modus.`
    }
  }

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />
  }

  return (
    <div className="min-h-screen relative theme-transition overflow-hidden">
      <BackendUnavailableOverlay />
      <ConnectionStatus />
      <EntityDiscoveryNotification />

      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat theme-transition"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=2070')`,
          filter: theme === 'sleep' ? 'brightness(0.05) grayscale(0.8)' : theme === 'night' ? 'brightness(0.4)' : theme === 'evening' ? 'brightness(0.5)' : 'brightness(0.75)'
        }}
      />

      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60"></div>

      <div className="relative z-10">
        <header className="glass-header theme-transition">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <h1 className="text-sm font-medium tracking-wide">MDT HOME</h1>
            <span className="text-sm font-medium">
              {currentTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center py-32">
              <div className="text-center space-y-4">
                <Sparkle className="mx-auto text-foreground animate-pulse" size={32} weight="fill" />
                <p className="text-sm text-foreground/80">Dashboard wird geladen...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {currentPageId === 'home' && (
                <>
                  <div className="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
                    <div className="space-y-3">
                      <div className="flex items-center gap-4">
                        <h2 className="text-[2.5rem] leading-tight font-normal text-foreground">
                          Hallo {userName},
                        </h2>
                        <Check size={40} weight="thin" className="text-foreground/60 mt-1" />
                      </div>
                      <p className="text-foreground/90 leading-relaxed max-w-2xl text-[15px]">
                        {getGreeting()}, {getContextMessage()}
                      </p>
                    </div>

                    <div className="lg:justify-self-end w-full">
                      <WeatherWidget entity={weatherEntity} />
                    </div>
                  </div>

                  {/* Clock widgets */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <DigitalClock showSeconds showDate />
                    <AnalogClock size={220} />
                    <CalendarWidget />
                  </div>

                  <SceneSelector
                    lightEntities={lightEntities}
                    onUpdate={loadEntities}
                  />

                  {sensorEntities.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-foreground/60 px-1">Sensoren</h3>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {sensorEntities.slice(0, 6).map((sensor) => (
                          <SensorWidget
                            key={sensor.entity_id}
                            entity={sensor}
                            onUpdate={loadEntities}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {currentPageId === 'lights' && lightEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Beleuchtung</h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {lightEntities.map((light) => (
                      <LightWidget
                        key={light.entity_id}
                        entity={light}
                        onUpdate={loadEntities}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'climate' && climateEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Klima</h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-4">
                    {climateEntities.map((climate) => (
                      <ClimateWidget
                        key={climate.entity_id}
                        entity={climate}
                        onUpdate={loadEntities}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'switches' && switchEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Schalter</h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {switchEntities.map((switchEntity) => (
                      <SwitchWidget
                        key={switchEntity.entity_id}
                        entity={switchEntity}
                        onUpdate={loadEntities}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'sensors' && sensorEntities.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xl font-medium text-foreground px-1">Sensoren</h3>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sensorEntities.map((sensor) => (
                      <SensorWidget
                        key={sensor.entity_id}
                        entity={sensor}
                        onUpdate={loadEntities}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentPageId === 'settings' && (
                <div className="space-y-6">
                  <h3 className="text-xl font-medium text-foreground px-1">Einstellungen</h3>
                  <div className="glass-card rounded-2xl p-6 theme-transition">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2">Benutzername</h4>
                        <p className="text-foreground/60 text-sm">{userName}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2">Theme</h4>
                        <p className="text-foreground/60 text-sm capitalize">{theme}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-foreground mb-2">Entitäten</h4>
                        <p className="text-foreground/60 text-sm">
                          {entities.length} Entitäten geladen
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
        <NavigationMenu />
      </div>
    </div>
  )
}

function App() {
  return (
    <ConnectionProvider>
      <ThemeProvider>
        <PageNavigationProvider>
          <EntityDiscoveryProvider>
            <DashboardContent />
            <Toaster />
          </EntityDiscoveryProvider>
        </PageNavigationProvider>
      </ThemeProvider>
    </ConnectionProvider>
  )
}

export default App
