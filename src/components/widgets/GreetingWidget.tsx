import type { WeatherEntity, ThemeMode } from '@/lib/types'
import { CloudRain, CloudSun, Sun, MoonStars } from '@phosphor-icons/react'

interface GreetingWidgetProps {
  userName?: string
  weatherEntity?: WeatherEntity
  theme?: ThemeMode
}

function getGreeting() {
  const hour = new Date().getHours()
  
  if (hour >= 5 && hour < 12) return 'Guten Morgen'
  if (hour >= 12 && hour < 18) return 'Guten Tag'
  if (hour >= 18 && hour < 22) return 'Guten Abend'
  return 'Gute Nacht'
}

function getTimeSpecificMessage(theme?: ThemeMode, location?: string) {
  const hour = new Date().getHours()
  
  if (hour >= 5 && hour < 12) {
    return `Einen schönen Start in den Tag! Das Wetter in ${location} lädt zu einem produktiven Morgen ein.`
  } else if (hour >= 12 && hour < 18) {
    return `Einen angenehmen Nachmittag. Keine anstehenden Termine oder Benachrichtigungen.`
  } else if (hour >= 18 && hour < 22) {
    return `Zeit zum Entspannen. Die Beleuchtung wurde für den Abend optimiert.`
  } else if (theme === 'sleep') {
    return `Schlafmodus aktiv. Gute Nacht.`
  } else {
    return `Ruhige Nacht. Alle Systeme im Standby-Modus.`
  }
}

export function GreetingWidget({ userName = 'Kai', weatherEntity, theme }: GreetingWidgetProps) {
  const greeting = getGreeting()
  const temperature = weatherEntity?.attributes.temperature || 20
  const location = weatherEntity?.attributes.friendly_name || 'Kissing'
  const hour = new Date().getHours()
  
  const getThemeIcon = () => {
    if (theme === 'sleep' || hour < 5 || hour >= 22) {
      return <MoonStars size={48} weight="fill" className="text-accent/40" />
    } else if (hour >= 18) {
      return <MoonStars size={48} weight="duotone" className="text-accent/60" />
    } else if (hour >= 12) {
      return <CloudSun size={48} weight="duotone" className="text-accent/70" />
    } else {
      return <Sun size={48} weight="fill" className="text-accent" />
    }
  }
  
  return (
    <div className="glass-card p-6 sm:p-8 rounded-3xl theme-transition hover:scale-[1.01] transition-transform duration-500">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-4">
            <div className="hidden sm:block">
              {getThemeIcon()}
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
                {greeting}, {userName}
              </h1>
              {weatherEntity && (
                <p className="text-sm text-muted-foreground mt-2 font-mono">
                  {Math.round(temperature)}°C in {location}
                </p>
              )}
            </div>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl">
            {getTimeSpecificMessage(theme, location)}
          </p>
        </div>
        <div className="sm:hidden flex justify-end">
          {getThemeIcon()}
        </div>
      </div>
    </div>
  )
}
