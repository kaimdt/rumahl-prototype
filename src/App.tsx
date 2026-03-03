import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { haService } from '@/lib/homeAssistant'
import { GreetingWidget } from '@/components/widgets/GreetingWidget'
import { WeatherWidget } from '@/components/widgets/WeatherWidget'
import { LightWidget } from '@/components/widgets/LightWidget'
import { Button } from '@/components/ui/button'
import type { EntityState, WeatherEntity, LightEntity } from '@/lib/types'
import { House, MoonStars, Sun, Gear, Sparkle } from '@phosphor-icons/react'

function DashboardContent() {
  const { theme, sleepMode, setSleepMode } = useTheme()
  const [entities, setEntities] = useState<EntityState[]>([])
  const [loading, setLoading] = useState(true)
  const [userName] = useKV<string>('ha-username', 'Kai')

  const loadEntities = async () => {
    const states = await haService.getStates()
    setEntities(states)
    setLoading(false)
  }

  useEffect(() => {
    loadEntities()
    const interval = setInterval(loadEntities, 30000)
    return () => clearInterval(interval)
  }, [])

  const weatherEntity = entities.find(e => e.entity_id.startsWith('weather.')) as WeatherEntity | undefined
  const lightEntities = entities.filter(e => e.entity_id.startsWith('light.')) as LightEntity[]

  const toggleSleepMode = () => {
    setSleepMode(!sleepMode)
  }

  const getThemeIcon = () => {
    if (sleepMode) return <MoonStars size={20} weight="fill" />
    if (theme === 'night') return <MoonStars size={20} />
    if (theme === 'evening') return <MoonStars size={20} weight="duotone" />
    return <Sun size={20} weight="fill" />
  }

  const getTimeBasedContent = () => {
    const hour = new Date().getHours()
    
    if (hour >= 5 && hour < 12) {
      return {
        showWeather: true,
        showCalendar: true,
        showEnergy: false,
        highlightLights: false
      }
    } else if (hour >= 12 && hour < 18) {
      return {
        showWeather: true,
        showCalendar: true,
        showEnergy: true,
        highlightLights: false
      }
    } else if (hour >= 18 && hour < 22) {
      return {
        showWeather: false,
        showCalendar: false,
        showEnergy: true,
        highlightLights: true
      }
    } else {
      return {
        showWeather: false,
        showCalendar: false,
        showEnergy: true,
        highlightLights: true
      }
    }
  }

  const timeContent = getTimeBasedContent()

  return (
    <div className="min-h-screen theme-transition gradient-bg mesh-gradient">
      <header className="glass-header sticky top-0 z-50 theme-transition">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center shadow-lg shadow-accent/20">
              <House size={18} weight="fill" className="text-white" />
            </div>
            <h1 className="text-sm font-semibold tracking-tight">Mist Home</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-muted-foreground mr-2 hidden sm:block">
              {new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={toggleSleepMode}
              className="h-9 w-9 rounded-xl hover:bg-accent/10 hover:scale-105 transition-all duration-200"
            >
              {getThemeIcon()}
            </Button>
            <Button 
              variant="ghost" 
              size="icon"
              className="h-9 w-9 rounded-xl hover:bg-accent/10 hover:scale-105 transition-all duration-200"
            >
              <Gear size={20} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center space-y-4">
              <div className="relative">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-accent/20 border-t-accent mx-auto"></div>
                <Sparkle className="absolute inset-0 m-auto text-accent animate-pulse" size={20} weight="fill" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">Dashboard wird geladen...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4 sm:gap-6">
              <div className="order-2 lg:order-1">
                <GreetingWidget userName={userName} weatherEntity={weatherEntity} theme={theme} />
              </div>
              {timeContent.showWeather && (
                <div className="order-1 lg:order-2 lg:justify-self-end w-full lg:max-w-md">
                  <WeatherWidget entity={weatherEntity} />
                </div>
              )}
            </div>

            {timeContent.highlightLights && lightEntities.length > 0 && (
              <div className="glass-card p-5 sm:p-6 rounded-3xl theme-transition">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-semibold flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shadow-lg shadow-accent/50"></div>
                    Beleuchtung
                  </h2>
                  <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                    {lightEntities.filter(l => l.state === 'on').length} aktiv
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                  {lightEntities.map(light => (
                    <LightWidget 
                      key={light.entity_id} 
                      entity={light}
                      onUpdate={loadEntities}
                    />
                  ))}
                </div>
              </div>
            )}

            {!timeContent.highlightLights && lightEntities.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2.5 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/60"></div>
                  Beleuchtung
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
                  {lightEntities.map(light => (
                    <LightWidget 
                      key={light.entity_id} 
                      entity={light}
                      onUpdate={loadEntities}
                    />
                  ))}
                </div>
              </div>
            )}

            {entities.filter(e => e.entity_id.startsWith('climate.')).length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2.5 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/60"></div>
                  Klima
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {entities
                    .filter(e => e.entity_id.startsWith('climate.'))
                    .map(climate => (
                      <div 
                        key={climate.entity_id}
                        className="glass-card p-5 rounded-3xl theme-transition hover:scale-[1.02] transition-transform duration-200"
                      >
                        <h3 className="font-medium text-sm mb-3">
                          {(climate.attributes as {friendly_name?: string}).friendly_name || climate.entity_id}
                        </h3>
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-mono font-bold">
                            {(climate.attributes as {current_temperature?: number}).current_temperature || 0}°
                          </span>
                          <span className="text-sm text-muted-foreground font-mono">
                            → {(climate.attributes as {temperature?: number}).temperature || 0}°
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {timeContent.showEnergy && entities.filter(e => e.entity_id.startsWith('sensor.')).length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2.5 px-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/60"></div>
                  Sensoren
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                  {entities
                    .filter(e => e.entity_id.startsWith('sensor.'))
                    .slice(0, 10)
                    .map(sensor => (
                      <div 
                        key={sensor.entity_id}
                        className="glass-card p-4 rounded-2xl theme-transition hover:scale-[1.02] transition-transform duration-200"
                      >
                        <p className="text-[10px] sm:text-xs text-muted-foreground mb-2 line-clamp-1">
                          {(sensor.attributes as {friendly_name?: string}).friendly_name || sensor.entity_id}
                        </p>
                        <p className="text-xl sm:text-2xl font-mono font-semibold line-clamp-1">
                          {sensor.state}
                          <span className="text-xs ml-0.5">
                            {(sensor.attributes as {unit_of_measurement?: string}).unit_of_measurement || ''}
                          </span>
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <DashboardContent />
    </ThemeProvider>
  )
}

export default App
