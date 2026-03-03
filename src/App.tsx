import { useState, useEffect } from 'react'
import { useLocalStorage } from '@/lib/storage'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { PageNavigationProvider, usePageNavigation } from '@/contexts/PageNavigationContext'
import { ConnectionProvider } from '@/contexts/ConnectionContext'
import { ConfigurationProvider } from '@/contexts/ConfigurationContext'
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
import { PageDesigner } from '@/components/PageDesigner'
import { ConfigurationSettings } from '@/components/ConfigurationSettings'
import { DynamicBackground } from '@/components/DynamicBackground'
import { Screensaver, useScreensaverSettings } from '@/components/Screensaver'
import { Switch } from '@/components/ui/switch'
import { useAccentColor } from '@/hooks/useAccentColor'
import { useNightModeSettings } from '@/hooks/useNightModeSettings'
import type { EntityState, WeatherEntity, LightEntity, ClimateEntity, SwitchEntity, SensorEntity } from '@/lib/types'
import { Sparkle, Check, Palette, Moon, PaintBucket } from '@phosphor-icons/react'
import { Toaster } from '@/components/ui/sonner'

function DashboardContent() {
  const { theme } = useTheme()
  const { currentPageId } = usePageNavigation()
  const { checkForNewEntities } = useEntityDiscovery()
  const screensaverSettings = useScreensaverSettings()
  const accentColorSettings = useAccentColor()
  const nightModeSettings = useNightModeSettings()
  const [entities, setEntities] = useState<EntityState[]>([])
  const [loading, setLoading] = useState(true)
  const [userName] = useLocalStorage<string>('ha-username', 'Kai')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [showSplash, setShowSplash] = useState(true)
  const [showPageDesigner, setShowPageDesigner] = useState(false)

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
      <Screensaver
        enabled={screensaverSettings.enabled}
        timeout={screensaverSettings.timeout}
      />
      <DynamicBackground />
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

                  {/* Configuration Settings */}
                  <ConfigurationSettings />

                  {/* Screensaver Settings */}
                  <div className="glass-card rounded-2xl p-6 theme-transition">
                    <h4 className="text-sm font-medium text-foreground mb-4">Bildschirmschoner</h4>
                    <p className="text-xs text-foreground/60 mb-4">
                      Aktivieren Sie den Bildschirmschoner, um nach einer bestimmten Zeit der Inaktivität nur die Uhrzeit anzuzeigen.
                    </p>

                    <div className="space-y-4">
                      {/* Enable/Disable Toggle */}
                      <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                            <Moon size={20} weight="fill" className="text-accent" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">Bildschirmschoner aktivieren</p>
                            <p className="text-xs text-foreground/60">Zeigt nur die Uhrzeit bei Inaktivität</p>
                          </div>
                        </div>
                        <Switch
                          checked={screensaverSettings.enabled}
                          onCheckedChange={screensaverSettings.setEnabled}
                        />
                      </div>

                      {/* Timeout Setting */}
                      {screensaverSettings.enabled && (
                        <div className="p-4 rounded-xl bg-foreground/5">
                          <label className="text-sm font-medium text-foreground block mb-3">
                            Inaktivitätsdauer (Minuten)
                          </label>
                          <div className="flex items-center gap-4">
                            <input
                              type="range"
                              min="1"
                              max="30"
                              value={screensaverSettings.timeout / 60000}
                              onChange={(e) => screensaverSettings.setTimeout(Number(e.target.value) * 60000)}
                              className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
                            />
                            <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">
                              {screensaverSettings.timeout / 60000} min
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Accent Color Settings */}
                  <div className="glass-card rounded-2xl p-6 theme-transition">
                    <h4 className="text-sm font-medium text-foreground mb-4">Akzentfarbe</h4>
                    <p className="text-xs text-foreground/60 mb-4">
                      Wählen Sie, ob die Akzentfarbe automatisch aus dem Hintergrundbild extrahiert oder statisch festgelegt werden soll.
                    </p>

                    <div className="space-y-4">
                      {/* Mode Selection */}
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => accentColorSettings.setMode('auto')}
                          className={`
                            p-3 rounded-xl border-2 transition-all
                            ${accentColorSettings.mode === 'auto'
                              ? 'border-accent bg-accent/10'
                              : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                            }
                          `}
                        >
                          <Sparkle
                            size={24}
                            weight="fill"
                            className={accentColorSettings.mode === 'auto' ? 'text-accent' : 'text-foreground/60'}
                          />
                          <p className="text-xs mt-2 font-medium">Automatisch</p>
                        </button>

                        <button
                          onClick={() => accentColorSettings.setMode('static')}
                          className={`
                            p-3 rounded-xl border-2 transition-all
                            ${accentColorSettings.mode === 'static'
                              ? 'border-accent bg-accent/10'
                              : 'border-foreground/10 bg-foreground/5 hover:border-foreground/20'
                            }
                          `}
                        >
                          <PaintBucket
                            size={24}
                            weight="fill"
                            className={accentColorSettings.mode === 'static' ? 'text-accent' : 'text-foreground/60'}
                          />
                          <p className="text-xs mt-2 font-medium">Statisch</p>
                        </button>
                      </div>

                      {/* Static Color Picker */}
                      {accentColorSettings.mode === 'static' && (
                        <div className="p-4 rounded-xl bg-foreground/5">
                          <label className="text-sm font-medium text-foreground block mb-3">
                            Farbe auswählen
                          </label>
                          <div className="flex items-center gap-4">
                            <input
                              type="color"
                              value={accentColorSettings.staticColor}
                              onChange={(e) => accentColorSettings.setStaticColor(e.target.value)}
                              className="w-16 h-16 rounded-lg cursor-pointer border-2 border-foreground/10"
                            />
                            <div className="flex-1">
                              <p className="text-sm font-mono text-foreground">{accentColorSettings.staticColor}</p>
                              <p className="text-xs text-foreground/60">Klicken Sie auf das Farbfeld zum Ändern</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Current Color Display */}
                      <div className="p-4 rounded-xl bg-foreground/5">
                        <p className="text-xs text-foreground/60 mb-2">Aktuelle Akzentfarbe</p>
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-lg border-2 border-foreground/10"
                            style={{ backgroundColor: accentColorSettings.accentColor }}
                          />
                          <p className="text-sm font-mono text-foreground">{accentColorSettings.accentColor}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Night Mode Settings */}
                  <div className="glass-card rounded-2xl p-6 theme-transition">
                    <h4 className="text-sm font-medium text-foreground mb-4">Nachtmodus</h4>
                    <p className="text-xs text-foreground/60 mb-4">
                      Reduzieren Sie blaues Licht für angenehmeres Sehen in der Nacht und verbessern Sie Ihren Schlaf.
                    </p>

                    <div className="space-y-4">
                      {/* Blue Light Reduction Slider */}
                      <div className="p-4 rounded-xl bg-foreground/5">
                        <label className="text-sm font-medium text-foreground block mb-3">
                          Blaulichtfilter-Intensität
                        </label>
                        <div className="space-y-2">
                          <div className="flex items-center gap-4">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={nightModeSettings.blueLightReduction}
                              onChange={(e) => nightModeSettings.setBlueLightReduction(Number(e.target.value))}
                              className="flex-1 h-2 bg-foreground/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:border-0"
                            />
                            <span className="text-sm font-medium text-foreground min-w-[3rem] text-right">
                              {nightModeSettings.blueLightReduction}%
                            </span>
                          </div>
                          <div className="flex justify-between text-xs text-foreground/60">
                            <span>Aus</span>
                            <span>Maximum</span>
                          </div>
                        </div>
                      </div>

                      {/* Auto Brightness Toggle */}
                      <div className="flex items-center justify-between p-4 rounded-xl bg-foreground/5">
                        <div>
                          <p className="font-medium text-sm">Automatische Helligkeit</p>
                          <p className="text-xs text-foreground/60">Helligkeit basierend auf Blaulichtfilter anpassen</p>
                        </div>
                        <Switch
                          checked={nightModeSettings.autoBrightness}
                          onCheckedChange={nightModeSettings.setAutoBrightness}
                        />
                      </div>

                      {/* Info */}
                      <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
                        <p className="text-xs text-foreground/80">
                          <strong>Tipp:</strong> Der Blaulichtfilter ist nur im Nacht- und Schlafmodus aktiv und hilft, Ihre Augen zu schonen und die Schlafqualität zu verbessern.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Dashboard Customization */}
                  <div className="glass-card rounded-2xl p-6 theme-transition">
                    <h4 className="text-sm font-medium text-foreground mb-4">Dashboard-Anpassung</h4>
                    <button
                      onClick={() => setShowPageDesigner(true)}
                      className="w-full px-4 py-3 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent transition-colors flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
                          <Palette size={20} weight="fill" />
                        </div>
                        <div className="text-left">
                          <p className="font-medium">Seiten-Designer</p>
                          <p className="text-xs text-foreground/60">Dashboard-Seiten anpassen und organisieren</p>
                        </div>
                      </div>
                      <Sparkle size={20} weight="fill" className="group-hover:rotate-12 transition-transform" />
                    </button>
                  </div>

                  {/* System Information */}
                  <div className="glass-card rounded-2xl p-6 theme-transition">
                    <h4 className="text-sm font-medium text-foreground mb-4">System-Information</h4>
                    <div className="space-y-4">
                      <div>
                        <h5 className="text-sm font-medium text-foreground mb-2">Benutzername</h5>
                        <p className="text-foreground/60 text-sm">{userName}</p>
                      </div>
                      <div>
                        <h5 className="text-sm font-medium text-foreground mb-2">Theme</h5>
                        <p className="text-foreground/60 text-sm capitalize">{theme}</p>
                      </div>
                      <div>
                        <h5 className="text-sm font-medium text-foreground mb-2">Entitäten</h5>
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
        <PageDesigner isOpen={showPageDesigner} onClose={() => setShowPageDesigner(false)} />
      </div>
    </div>
  )
}

function App() {
  return (
    <ConnectionProvider>
      <ThemeProvider>
        <PageNavigationProvider>
          <ConfigurationProvider>
            <EntityDiscoveryProvider>
              <DashboardContent />
              <Toaster />
            </EntityDiscoveryProvider>
          </ConfigurationProvider>
        </PageNavigationProvider>
      </ThemeProvider>
    </ConnectionProvider>
  )
}

export default App
