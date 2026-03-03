import { useState, useEffect } from 'react'
import { useKV } from '@github/spark/hooks'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { haService } from '@/lib/homeAssistant'
import { WeatherWidget } from '@/components/widgets/WeatherWidget'
import { LightWidget } from '@/components/widgets/LightWidget'
import type { EntityState, WeatherEntity, LightEntity } from '@/lib/types'
import { Sparkle, Check } from '@phosphor-icons/react'

function DashboardContent() {
  const { theme } = useTheme()
  const [entities, setEntities] = useState<EntityState[]>([])
  const [loading, setLoading] = useState(true)
  const [userName] = useKV<string>('ha-username', 'Kai')
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

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

  return (
    <div className="min-h-screen relative theme-transition overflow-hidden">
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat theme-transition"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1600585154340-be6161a56a0c?q=80&w=2070')`,
          filter: theme === 'sleep' ? 'brightness(0.2)' : theme === 'night' ? 'brightness(0.4)' : theme === 'evening' ? 'brightness(0.6)' : 'brightness(0.75)'
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

              <div className="glass-card rounded-2xl p-6 min-h-[400px] theme-transition">
                <div className="h-full flex items-center justify-center text-foreground/40 text-sm">
                  Kalenderbereich
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
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
