import type { WeatherEntity } from '@/lib/types'

interface GreetingWidgetProps {
  userName?: string
  weatherEntity?: WeatherEntity
}

function getGreeting() {
  const hour = new Date().getHours()
  
  if (hour >= 5 && hour < 12) return 'Guten Morgen'
  if (hour >= 12 && hour < 18) return 'Guten Tag'
  if (hour >= 18 && hour < 22) return 'Guten Abend'
  return 'Gute Nacht'
}

export function GreetingWidget({ userName = 'Kai', weatherEntity }: GreetingWidgetProps) {
  const greeting = getGreeting()
  const temperature = weatherEntity?.attributes.temperature || 20
  const location = weatherEntity?.attributes.friendly_name || 'Kissing'
  
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">
        {greeting}, {userName},
      </h1>
      <p className="text-base text-muted-foreground leading-relaxed max-w-2xl">
        heute ist ein schöner Tag, das Wetter in {location} beträgt {Math.round(temperature)}°C bei klaren Himmel. 
        Heute habe keine Termine geplant, ich habe keine weiteren Meldungen.
      </p>
    </div>
  )
}
