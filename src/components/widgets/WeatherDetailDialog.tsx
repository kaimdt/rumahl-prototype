import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Sun, Cloud, CloudRain, CloudSnow, CloudFog, Wind, Drop, ThermometerSimple, Gauge } from '@phosphor-icons/react'
import type { WeatherEntity } from '@/lib/types'
import { haService, type ForecastEntry } from '@/lib/homeAssistant'
import { motion } from 'framer-motion'

interface WeatherDetailDialogProps {
  entity: WeatherEntity
  open: boolean
  onOpenChange: (open: boolean) => void
}

function getWeatherIcon(condition: string, size = 24) {
  const normalized = condition.toLowerCase().replace(/[_-]/g, '')
  const iconMap: Record<string, typeof Sun> = {
    sunny: Sun,
    clear: Sun,
    clearnight: Sun,
    cloudy: Cloud,
    partlycloudy: Cloud,
    rainy: CloudRain,
    pouring: CloudRain,
    snowy: CloudSnow,
    snowyrainy: CloudSnow,
    fog: CloudFog,
    hail: CloudRain,
    lightning: CloudRain,
    lightningrainy: CloudRain,
    windy: Wind,
    windyvariant: Wind,
    exceptional: Cloud,
  }
  const Icon = iconMap[normalized] || Sun
  return <Icon size={size} weight="duotone" />
}

function getConditionColor(condition: string): string {
  const normalized = condition.toLowerCase()
  if (normalized.includes('sun') || normalized === 'clear') return 'oklch(0.75 0.18 80)'
  if (normalized.includes('cloud') || normalized.includes('partly')) return 'oklch(0.65 0.08 250)'
  if (normalized.includes('rain') || normalized.includes('pour')) return 'oklch(0.60 0.15 240)'
  if (normalized.includes('snow')) return 'oklch(0.75 0.10 240)'
  if (normalized.includes('fog')) return 'oklch(0.65 0.05 250)'
  if (normalized.includes('wind')) return 'oklch(0.65 0.10 200)'
  return 'oklch(0.70 0.15 80)'
}

function getWindDirection(bearing: number | undefined): string {
  if (bearing === undefined || bearing === null) return '\u2014'
  const directions = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
  const index = Math.round(bearing / 45) % 8
  return directions[index]
}

function getDayName(dateStr: string, index: number): string {
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Heute'
  if (date.toDateString() === tomorrow.toDateString()) return 'Morgen'
  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  return dayNames[date.getDay()]
}

function getConditionText(condition: string): string {
  const map: Record<string, string> = {
    sunny: 'Sonnig',
    'clear-night': 'Klar',
    clear: 'Klar',
    cloudy: 'Bewölkt',
    partlycloudy: 'Teilw. bewölkt',
    'partly-cloudy': 'Teilw. bewölkt',
    rainy: 'Regnerisch',
    pouring: 'Starkregen',
    snowy: 'Schnee',
    fog: 'Nebelig',
    windy: 'Windig',
    lightning: 'Gewitter',
    'lightning-rainy': 'Gewitter',
    hail: 'Hagel',
    exceptional: 'Ungewöhnlich',
  }
  return map[condition.toLowerCase()] || condition
}

function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/[_-]/g, ' ')
}

export function WeatherDetailDialog({
  entity,
  open,
  onOpenChange,
}: WeatherDetailDialogProps) {
  const name = entity.attributes.friendly_name || 'Wetter'
  const condition = entity.state || 'clear'
  const temperature = entity.attributes.temperature
  const humidity = entity.attributes.humidity
  const windSpeed = entity.attributes.wind_speed
  const pressure = entity.attributes.pressure
  const windBearing = entity.attributes.wind_bearing
  const conditionColor = getConditionColor(condition)

  const [forecastTab, setForecastTab] = useState<'daily' | 'hourly'>('daily')
  const [dailyForecast, setDailyForecast] = useState<ForecastEntry[]>([])
  const [hourlyForecast, setHourlyForecast] = useState<ForecastEntry[]>([])
  const [loadingDaily, setLoadingDaily] = useState(false)
  const [loadingHourly, setLoadingHourly] = useState(false)
  const [dailyError, setDailyError] = useState(false)
  const [hourlyError, setHourlyError] = useState(false)

  // Fetch daily forecast when dialog opens
  useEffect(() => {
    if (open && dailyForecast.length === 0 && !dailyError) {
      setLoadingDaily(true)
      haService.getForecasts(entity.entity_id, 'daily')
        .then(data => {
          if (data.length > 0) {
            setDailyForecast(data)
            return
          }
          const legacy = (entity.attributes.forecast as ForecastEntry[] | undefined) || []
          setDailyForecast(legacy)
          if (legacy.length === 0) console.warn('[Weather] Daily forecast returned empty array')
        })
        .catch((err) => {
          console.error('[Weather] Failed to fetch daily forecast:', err)
          const legacy = (entity.attributes.forecast as ForecastEntry[] | undefined) || []
          if (legacy.length > 0) {
            setDailyForecast(legacy)
            setDailyError(false)
          } else {
            setDailyError(true)
          }
        })
        .finally(() => setLoadingDaily(false))
    }
  }, [open, entity.entity_id, dailyForecast.length, dailyError])

  // Fetch hourly forecast when tab is selected
  useEffect(() => {
    if (open && forecastTab === 'hourly' && hourlyForecast.length === 0 && !hourlyError) {
      setLoadingHourly(true)
      haService.getForecasts(entity.entity_id, 'hourly')
        .then(data => {
          if (data.length > 0) {
            setHourlyForecast(data)
            return
          }
          // Fallback: no hourly API data -> use first daily rows as coarse replacement.
          const fallbackDaily = (entity.attributes.forecast as ForecastEntry[] | undefined) || []
          setHourlyForecast(fallbackDaily.slice(0, 24))
          if (fallbackDaily.length === 0) console.warn('[Weather] Hourly forecast returned empty array')
        })
        .catch((err) => {
          console.error('[Weather] Failed to fetch hourly forecast:', err)
          const fallbackDaily = (entity.attributes.forecast as ForecastEntry[] | undefined) || []
          if (fallbackDaily.length > 0) {
            setHourlyForecast(fallbackDaily.slice(0, 24))
            setHourlyError(false)
          } else {
            setHourlyError(true)
          }
        })
        .finally(() => setLoadingHourly(false))
    }
  }, [open, forecastTab, entity.entity_id, hourlyForecast.length, hourlyError])

  // Reset forecasts when entity changes
  useEffect(() => {
    setDailyForecast([])
    setHourlyForecast([])
    setDailyError(false)
    setHourlyError(false)
  }, [entity.entity_id])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[520px] max-h-[85vh] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden"
        hideCloseButton
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Wetter Details</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        <motion.div
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
          animate={{ opacity: 0.2, scale: [1, 1.05, 1] }}
          transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
          style={{
            background: `radial-gradient(circle, ${conditionColor}, transparent 70%)`,
            filter: 'blur(40px)',
          }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="p-2 rounded-xl shrink-0"
              style={{
                backgroundColor: `color-mix(in oklch, ${conditionColor} 25%, transparent)`,
                color: conditionColor,
              }}
            >
              {getWeatherIcon(condition, 20)}
            </motion.div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">
                {name}
              </h2>
              <p className="text-xs text-foreground/40">{capitalize(condition)}</p>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="relative px-5 pb-5 space-y-5">
          {/* Current weather - large display */}
          <motion.div
            className="flex flex-col items-center py-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
          >
            <div className="mb-3" style={{ color: conditionColor }}>
              {getWeatherIcon(condition, 56)}
            </div>
            <div className="text-center">
              <span className="text-6xl font-light" style={{ color: conditionColor }}>
                {temperature !== undefined ? Math.round(temperature) : '\u2014'}
              </span>
              <span className="text-3xl font-light ml-1" style={{ color: conditionColor }}>
                °C
              </span>
            </div>
            <p className="text-sm text-foreground/50 mt-1">{getConditionText(condition)}</p>
          </motion.div>

          {/* Stats grid */}
          <motion.div
            className="grid grid-cols-2 gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {/* Humidity */}
            <div
              className="rounded-xl p-3 flex items-center gap-2.5"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            >
              <Drop size={18} weight="fill" className="text-foreground/40 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Feuchtigkeit</p>
                <p className="text-sm font-semibold text-foreground/80">
                  {humidity !== undefined ? `${humidity}%` : '\u2014'}
                </p>
              </div>
            </div>

            {/* Wind speed */}
            <div
              className="rounded-xl p-3 flex items-center gap-2.5"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            >
              <Wind size={18} weight="fill" className="text-foreground/40 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Wind</p>
                <p className="text-sm font-semibold text-foreground/80">
                  {windSpeed !== undefined ? `${windSpeed} km/h` : '\u2014'}
                </p>
              </div>
            </div>

            {/* Pressure */}
            <div
              className="rounded-xl p-3 flex items-center gap-2.5"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            >
              <Gauge size={18} weight="fill" className="text-foreground/40 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Luftdruck</p>
                <p className="text-sm font-semibold text-foreground/80">
                  {pressure !== undefined ? `${pressure} hPa` : '\u2014'}
                </p>
              </div>
            </div>

            {/* Wind direction */}
            <div
              className="rounded-xl p-3 flex items-center gap-2.5"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            >
              <ThermometerSimple size={18} weight="fill" className="text-foreground/40 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Wind-Richtung</p>
                <p className="text-sm font-semibold text-foreground/80">
                  {windBearing !== undefined
                    ? `${windBearing}° ${getWindDirection(windBearing)}`
                    : '\u2014'}
                </p>
              </div>
            </div>
          </motion.div>

          {/* Forecast section with tabs */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {/* Tab bar */}
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-semibold text-foreground/70">
                Vorhersage
              </label>
              <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid oklch(from var(--foreground) l c h / 0.1)' }}>
                <button
                  onClick={() => setForecastTab('daily')}
                  className="px-3 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: forecastTab === 'daily' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                    color: forecastTab === 'daily' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
                  }}
                >
                  Täglich
                </button>
                <button
                  onClick={() => setForecastTab('hourly')}
                  className="px-3 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: forecastTab === 'hourly' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                    color: forecastTab === 'hourly' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
                  }}
                >
                  Stündlich
                </button>
              </div>
            </div>

            {/* Daily forecast tab */}
            {forecastTab === 'daily' && (
              <>
                {loadingDaily ? (
                  <div
                    className="rounded-xl flex items-center justify-center py-8"
                    style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                  >
                    <span className="text-xs text-foreground/40">Laden...</span>
                  </div>
                ) : dailyForecast.length > 0 ? (
                  <div
                    className="rounded-xl overflow-hidden divide-y"
                    style={{
                      background: 'oklch(from var(--foreground) l c h / 0.04)',
                      borderColor: 'oklch(from var(--foreground) l c h / 0.06)',
                    }}
                  >
                    {dailyForecast.slice(0, 7).map((day, idx) => (
                      <motion.div
                        key={idx}
                        className="flex items-center px-4 py-3"
                        style={{ borderColor: 'oklch(from var(--foreground) l c h / 0.06)' }}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 + idx * 0.03 }}
                      >
                        <span className="text-sm text-foreground/60 font-medium w-16 shrink-0">
                          {getDayName(day.datetime, idx)}
                        </span>
                        <div className="text-foreground/60 shrink-0 w-10 flex justify-center">
                          {getWeatherIcon(day.condition, 22)}
                        </div>
                        <span className="text-[11px] text-foreground/40 ml-2 flex-1 truncate">
                          {getConditionText(day.condition)}
                        </span>
                        <span className="text-sm font-semibold text-foreground/80 ml-2 w-14 text-right">
                          {Math.round(day.temperature)}°C
                        </span>
                        {day.templow !== undefined && (
                          <span className="text-xs text-foreground/40 ml-1 w-10 text-right">
                            {Math.round(day.templow)}°
                          </span>
                        )}
                        <span className="text-[11px] text-foreground/40 ml-3 w-14 text-right">
                          {day.precipitation !== undefined && day.precipitation > 0
                            ? `${day.precipitation} mm`
                            : ''}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="rounded-xl flex items-center justify-center py-8"
                    style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                  >
                    <span className="text-xs text-foreground/40">Keine tägliche Vorhersage verfügbar</span>
                  </div>
                )}
              </>
            )}

              {/* Hourly forecast tab */}
              {forecastTab === 'hourly' && (
                <>
                  {loadingHourly ? (
                    <div
                      className="rounded-xl flex items-center justify-center py-8"
                      style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                    >
                      <span className="text-xs text-foreground/40">Laden...</span>
                    </div>
                  ) : hourlyForecast.length > 0 ? (
                    <div
                      className="rounded-xl overflow-hidden divide-y"
                      style={{
                        background: 'oklch(from var(--foreground) l c h / 0.04)',
                        borderColor: 'oklch(from var(--foreground) l c h / 0.06)',
                      }}
                    >
                      {hourlyForecast.slice(0, 24).map((hour, idx) => (
                        <motion.div
                          key={idx}
                          className="flex items-center px-3 py-2.5"
                          style={{ borderColor: 'oklch(from var(--foreground) l c h / 0.06)' }}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.15 + idx * 0.02 }}
                        >
                          <span className="text-[11px] text-foreground/50 font-medium w-14 shrink-0">
                            {new Date(hour.datetime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div className="text-foreground/60 shrink-0 w-8 flex justify-center">
                            {getWeatherIcon(hour.condition, 16)}
                          </div>
                          <span className="text-xs font-semibold text-foreground/80 ml-2 w-12 text-right">
                            {Math.round(hour.temperature)}°C
                          </span>
                          <span className="text-[10px] text-foreground/40 ml-auto">
                            {hour.precipitation_probability !== undefined ? `${hour.precipitation_probability}%` : ''}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="rounded-xl flex items-center justify-center py-8"
                      style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                    >
                      <span className="text-xs text-foreground/40">Keine stündliche Vorhersage verfügbar</span>
                    </div>
                  )}
                </>
              )}
            </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
