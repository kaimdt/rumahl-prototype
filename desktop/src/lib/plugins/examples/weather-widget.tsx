import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Cloud, CloudRain, Sun, CloudSnow, Wind } from '@phosphor-icons/react'
import type { WidgetPlugin, WidgetPluginProps } from '../types'

/**
 * Advanced Weather Widget Plugin
 * Demonstrates a complete plugin with external API integration
 */

interface WeatherData {
  temperature: number
  condition: string
  humidity: number
  windSpeed: number
  forecast: Array<{
    day: string
    high: number
    low: number
    condition: string
  }>
}

function WeatherWidget({ entity, config, onUpdate }: WidgetPluginProps) {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)

  // Get location from config or entity attributes
  const location = config?.location as string || entity.attributes.location as string || 'Unknown'
  const useExternalAPI = config?.useExternalAPI as boolean ?? false

  useEffect(() => {
    fetchWeatherData()
    const interval = setInterval(fetchWeatherData, 300000) // Update every 5 minutes
    return () => clearInterval(interval)
  }, [location])

  const fetchWeatherData = async () => {
    setLoading(true)
    try {
      if (useExternalAPI) {
        // Example: Fetch from external API
        // In production, you'd use a real weather API
        const mockData: WeatherData = {
          temperature: 22,
          condition: 'sunny',
          humidity: 65,
          windSpeed: 12,
          forecast: [
            { day: 'Mon', high: 24, low: 18, condition: 'sunny' },
            { day: 'Tue', high: 22, low: 16, condition: 'cloudy' },
            { day: 'Wed', high: 20, low: 15, condition: 'rainy' },
          ],
        }
        setWeatherData(mockData)
      } else {
        // Use Home Assistant entity data
        const temp = entity.attributes.temperature as number || 0
        const condition = entity.state || 'unknown'
        const humidity = entity.attributes.humidity as number || 0
        const windSpeed = entity.attributes.wind_speed as number || 0

        setWeatherData({
          temperature: temp,
          condition: condition.toLowerCase(),
          humidity,
          windSpeed,
          forecast: [],
        })
      }
    } catch (error) {
      console.error('Failed to fetch weather data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getWeatherIcon = (condition: string) => {
    const iconProps = { size: 48, weight: 'fill' as const }
    switch (condition.toLowerCase()) {
      case 'sunny':
      case 'clear':
        return <Sun {...iconProps} className="text-yellow-400" />
      case 'cloudy':
      case 'partlycloudy':
        return <Cloud {...iconProps} className="text-gray-400" />
      case 'rainy':
      case 'rain':
        return <CloudRain {...iconProps} className="text-blue-400" />
      case 'snowy':
      case 'snow':
        return <CloudSnow {...iconProps} className="text-blue-200" />
      case 'windy':
        return <Wind {...iconProps} className="text-gray-500" />
      default:
        return <Cloud {...iconProps} className="text-gray-400" />
    }
  }

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6 flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <Cloud size={32} className="text-foreground/40" />
        </motion.div>
      </div>
    )
  }

  if (!weatherData) {
    return (
      <div className="glass-card rounded-2xl p-6 text-center">
        <p className="text-foreground/60">Weather data unavailable</p>
      </div>
    )
  }

  return (
    <motion.div
      className="glass-card rounded-2xl p-6 space-y-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{location}</h3>
          <p className="text-sm text-foreground/60 capitalize">{weatherData.condition}</p>
        </div>
        {getWeatherIcon(weatherData.condition)}
      </div>

      {/* Temperature */}
      <div className="text-center">
        <motion.div
          className="text-6xl font-bold text-foreground"
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {Math.round(weatherData.temperature)}°
        </motion.div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-foreground/10">
        <div className="space-y-1">
          <p className="text-xs text-foreground/60">Humidity</p>
          <p className="text-lg font-semibold text-foreground">{weatherData.humidity}%</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-foreground/60">Wind</p>
          <p className="text-lg font-semibold text-foreground">{weatherData.windSpeed} km/h</p>
        </div>
      </div>

      {/* Forecast */}
      {weatherData.forecast.length > 0 && (
        <div className="pt-4 border-t border-foreground/10">
          <h4 className="text-sm font-medium text-foreground/80 mb-3">Forecast</h4>
          <div className="grid grid-cols-3 gap-3">
            {weatherData.forecast.map((day) => (
              <motion.div
                key={day.day}
                className="text-center p-2 rounded-lg bg-foreground/5"
                whileHover={{ scale: 1.05 }}
              >
                <p className="text-xs text-foreground/60 mb-1">{day.day}</p>
                <div className="flex justify-center mb-1">
                  {getWeatherIcon(day.condition)}
                </div>
                <p className="text-sm font-medium text-foreground">
                  {day.high}° / {day.low}°
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}

// Settings component for plugin configuration
function WeatherSettings({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
}) {
  const location = config.location as string || ''
  const useExternalAPI = config.useExternalAPI as boolean || false

  return (
    <div className="space-y-4 p-4">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-2">
          Location
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => onChange({ ...config, location: e.target.value })}
          className="w-full px-3 py-2 bg-foreground/5 border border-foreground/10 rounded-lg text-foreground"
          placeholder="Enter location"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useExternalAPI}
          onChange={(e) => onChange({ ...config, useExternalAPI: e.target.checked })}
          className="w-4 h-4"
        />
        <label className="text-sm text-foreground/80">
          Use external weather API
        </label>
      </div>
    </div>
  )
}

// Export plugin definition
export const weatherWidgetPlugin: WidgetPlugin = {
  metadata: {
    id: 'advanced-weather-widget',
    name: 'Advanced Weather Widget',
    version: '1.0.0',
    description: 'A beautiful weather widget with forecast and external API support',
    author: 'Dashboard Team',
    supportedDomains: ['weather'],
    icon: 'Cloud',
    configSchema: {
      location: { type: 'string', default: 'Unknown' },
      useExternalAPI: { type: 'boolean', default: false },
    },
  },
  component: WeatherWidget,
  settingsComponent: WeatherSettings,
}

export default weatherWidgetPlugin
