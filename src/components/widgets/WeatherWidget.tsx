import { Card } from '@/components/ui/card'
import type { WeatherEntity } from '@/lib/types'
import { Sun, Cloud, CloudRain, CloudSnow, CloudFog, Wind, Drop } from '@phosphor-icons/react'

interface WeatherWidgetProps {
  entity?: WeatherEntity
}

function getWeatherIcon(condition: string, size: number = 32) {
  const icons: Record<string, typeof Sun> = {
    sunny: Sun,
    clear: Sun,
    cloudy: Cloud,
    'partly-cloudy': Cloud,
    rainy: CloudRain,
    pouring: CloudRain,
    snowy: CloudSnow,
    fog: CloudFog,
    windy: Wind,
  }
  
  const Icon = icons[condition.toLowerCase()] || Sun
  return <Icon size={size} weight="fill" />
}

function getDayName(dateStr: string) {
  const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  const date = new Date(dateStr)
  return days[date.getDay()]
}

export function WeatherWidget({ entity }: WeatherWidgetProps) {
  if (!entity) return null

  const temperature = entity.attributes.temperature || 0
  const forecast = entity.attributes.forecast || []
  const location = entity.attributes.friendly_name || 'Zuhause'

  return (
    <Card className="glass-card p-5 sm:p-6 rounded-3xl theme-transition hover:scale-[1.01] transition-transform duration-500">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-[10px] sm:text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">
              Wetter
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl sm:text-6xl font-bold font-mono leading-none">{Math.round(temperature)}°</span>
              {entity.attributes.humidity && (
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Drop size={16} weight="fill" />
                  <span className="text-base sm:text-lg font-mono">{entity.attributes.humidity}%</span>
                </div>
              )}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-2 font-medium">{location}</p>
          </div>
          <div className="text-accent/80 mt-4">
            {getWeatherIcon(entity.state, 56)}
          </div>
        </div>

        {forecast.length > 0 && (
          <div className="grid grid-cols-5 gap-2 sm:gap-3 pt-4 border-t border-border/30">
            {forecast.slice(0, 5).map((day, idx) => (
              <div key={idx} className="text-center space-y-1.5 sm:space-y-2">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">
                  {idx === 0 ? 'Jetzt' : getDayName(day.datetime)}
                </p>
                <div className="flex justify-center text-accent/70">
                  {getWeatherIcon(day.condition, 24)}
                </div>
                <p className="text-xs sm:text-sm font-mono font-semibold">{Math.round(day.temperature)}°</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
