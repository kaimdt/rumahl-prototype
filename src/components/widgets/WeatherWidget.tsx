import type { WeatherEntity } from '@/lib/types'
import { Sun, Cloud, CloudRain, CloudSnow, CloudFog, Wind } from '@phosphor-icons/react'

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
  return <Icon size={size} weight="duotone" />
}

function getDayName(dateStr: string) {
  const days = ['Morgen', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']
  const date = new Date(dateStr)
  return days[date.getDay()] || 'Heute'
}

export function WeatherWidget({ entity }: WeatherWidgetProps) {
  if (!entity) return null

  const temperature = entity.attributes.temperature || 20
  const forecast = entity.attributes.forecast || []
  const condition = entity.state || 'clear'

  return (
    <div className="glass-card rounded-xl p-5 theme-transition">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="text-foreground/80 mb-2">
            {getWeatherIcon(condition, 40)}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-foreground/60 uppercase tracking-wide">Derzeit wird es</p>
            <p className="text-5xl font-light text-foreground">{Math.round(temperature)}°C</p>
            <p className="text-xs text-foreground/60">bei klarem Himmel. Heute sind keine Termine geplant</p>
          </div>
        </div>
      </div>

      {forecast.length > 0 && (
        <div className="grid grid-cols-6 gap-2 mt-5 pt-5 border-t border-foreground/10">
          {forecast.slice(0, 6).map((day, idx) => (
            <div key={idx} className="text-center space-y-1">
              <p className="text-[9px] text-foreground/50 font-medium uppercase tracking-wider">
                {idx === 0 ? 'Morgen' : getDayName(day.datetime).slice(0, 2)}
              </p>
              <div className="flex justify-center text-foreground/60">
                {getWeatherIcon(day.condition, 18)}
              </div>
              <p className="text-xs font-medium text-foreground/90">{Math.round(day.temperature)}°</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
