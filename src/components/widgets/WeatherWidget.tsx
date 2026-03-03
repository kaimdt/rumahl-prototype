import { Card } from '@/components/ui/card'
import type { WeatherEntity } from '@/lib/types'
import { Sun, Cloud, CloudRain, CloudSnow, CloudFog, Wind } from '@phosphor-icons/react'

interface WeatherWidgetProps {
  entity?: WeatherEntity
}

function getWeatherIcon(condition: string) {
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
  return <Icon size={32} weight="fill" />
}

function getDayName(dateStr: string) {
  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
  const date = new Date(dateStr)
  return days[date.getDay()]
}

export function WeatherWidget({ entity }: WeatherWidgetProps) {
  if (!entity) return null

  const temperature = entity.attributes.temperature || 0
  const forecast = entity.attributes.forecast || []
  const location = entity.attributes.friendly_name || 'Zuhause'

  return (
    <Card className="glass-card p-6 border-0">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Derzeit sind es</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-6xl font-bold font-mono">{Math.round(temperature)}°C</span>
              <span className="text-2xl text-muted-foreground">
                {entity.attributes.humidity ? `${entity.attributes.humidity}%` : ''}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{location}</p>
          </div>
          <div className="text-accent">
            {getWeatherIcon(entity.state)}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-4 pt-4 border-t border-border/50">
          {forecast.slice(0, 5).map((day, idx) => (
            <div key={idx} className="text-center space-y-2">
              <p className="text-xs text-muted-foreground">
                {idx === 0 ? 'Heute' : getDayName(day.datetime).slice(0, 2)}
              </p>
              <div className="flex justify-center text-accent/80">
                {getWeatherIcon(day.condition)}
              </div>
              <p className="text-sm font-mono font-medium">{Math.round(day.temperature)}°</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}
