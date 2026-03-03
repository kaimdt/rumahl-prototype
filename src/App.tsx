import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { haService } from '@/lib/homeAssistant'
import { GreetingWidget } from '@/components/widgets/GreetingWidget'
import { WeatherWidget } from '@/components/widgets/WeatherWidget'
import { LightWidget } from '@/components/widgets/LightWidget'
import { Button } from '@/components/ui/button'
import type { EntityState, WeatherEntity, LightEntity } from '@/lib/types'
import { House, MoonStars, Sun, Gear } from '@phosphor-icons/react'

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
    return <Sun size={20} />
  }

  return (
    <div className="min-h-screen theme-transition">
      <header className="border-b border-border/50 theme-transition backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <House size={24} weight="fill" className="text-accent" />
            <h1 className="text-sm font-semibold uppercase tracking-wider">Mist Home</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground mr-2">
              {new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={toggleSleepMode}
              className="transition-colors"
            >
              {getThemeIcon()}
            </Button>
            <Button variant="ghost" size="icon">
              <Gear size={20} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent mx-auto"></div>
              <p className="text-sm text-muted-foreground">Dashboard wird geladen...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid lg:grid-cols-[2fr_1fr] gap-6">
              <div>
                <GreetingWidget userName={userName} weatherEntity={weatherEntity} />
              </div>
              <div className="lg:justify-self-end w-full lg:max-w-md">
                <WeatherWidget entity={weatherEntity} />
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="text-accent">●</span> Beleuchtung
              </h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {lightEntities.map(light => (
                  <LightWidget 
                    key={light.entity_id} 
                    entity={light}
                    onUpdate={loadEntities}
                  />
                ))}
              </div>
            </div>

            {entities.filter(e => e.entity_id.startsWith('climate.')).length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="text-accent">●</span> Klima
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {entities
                    .filter(e => e.entity_id.startsWith('climate.'))
                    .map(climate => (
                      <div 
                        key={climate.entity_id}
                        className="glass-card p-4 border-0 theme-transition"
                      >
                        <h3 className="font-medium">
                          {(climate.attributes as {friendly_name?: string}).friendly_name || climate.entity_id}
                        </h3>
                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-3xl font-mono font-bold">
                            {(climate.attributes as {current_temperature?: number}).current_temperature || 0}°
                          </span>
                          <span className="text-sm text-muted-foreground">
                            → {(climate.attributes as {temperature?: number}).temperature || 0}°
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {entities.filter(e => e.entity_id.startsWith('sensor.')).length > 0 && (
              <div>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <span className="text-accent">●</span> Sensoren
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {entities
                    .filter(e => e.entity_id.startsWith('sensor.'))
                    .slice(0, 8)
                    .map(sensor => (
                      <div 
                        key={sensor.entity_id}
                        className="glass-card p-4 border-0 theme-transition"
                      >
                        <p className="text-xs text-muted-foreground mb-1">
                          {(sensor.attributes as {friendly_name?: string}).friendly_name || sensor.entity_id}
                        </p>
                        <p className="text-2xl font-mono font-semibold">
                          {sensor.state}
                          {(sensor.attributes as {unit_of_measurement?: string}).unit_of_measurement || ''}
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
