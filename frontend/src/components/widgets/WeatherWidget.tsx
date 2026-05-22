import { useTranslation } from 'react-i18next'
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'motion/react'
import type { WeatherEntity } from '@/lib/types'
import { Sun, Cloud, CloudRain, CloudSnow, CloudFog, Wind, Drop, ThermometerSimple } from '@phosphor-icons/react'
import { haptics } from '@/lib/haptics'
import { WeatherDetailDialog } from './WeatherDetailDialog'
import { haService, type ForecastEntry } from '@/lib/homeAssistant'

interface WeatherWidgetProps {
  entity?: WeatherEntity
  config?: Record<string, unknown>
  widgetSize?: { w: number; h: number }
}

function getWeatherIcon(condition: string, size: number = 32) {
  const icons: Record<string, typeof Sun> = {
    sunny: Sun,
    'clear-night': Sun,
    clear: Sun,
    cloudy: Cloud,
    partlycloudy: Cloud,
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

function getConditionText(condition: string) {
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

function getDayName(dateStr: string) {
  const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Heu.'
  if (date.toDateString() === tomorrow.toDateString()) return 'Morg.'
  return dayNames[date.getDay()]
}

export function WeatherWidget({ entity, config, widgetSize }: WeatherWidgetProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [forecast, setForecast] = useState<ForecastEntry[]>([])
  const [forecastLoading, setForecastLoading] = useState(false)

  // Fetch daily forecast via modern HA service call
  useEffect(() => {
    if (!entity) return
    let cancelled = false

    setForecastLoading(true)
    haService.getForecasts(entity.entity_id, 'daily')
      .then(data => {
        if (cancelled) return
        if (data.length > 0) {
          setForecast(data)
          return
        }
        const legacyForecast = entity.attributes.forecast as ForecastEntry[] | undefined
        setForecast(legacyForecast || [])
      })
      .catch(err => {
        console.warn('[WeatherWidget] Failed to fetch forecast:', err)
        // Fallback to legacy attribute for older HA versions
        if (!cancelled) {
          const legacyForecast = entity.attributes.forecast as ForecastEntry[] | undefined
          setForecast(legacyForecast || [])
        }
      })
      .finally(() => {
        if (!cancelled) setForecastLoading(false)
      })

    return () => { cancelled = true }
  }, [entity?.entity_id, entity?.last_updated])

  // Refresh forecast every 30 minutes
  useEffect(() => {
    if (!entity) return
    const interval = setInterval(() => {
      haService.getForecasts(entity.entity_id, 'daily')
        .then(setForecast)
        .catch(() => {})
    }, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [entity?.entity_id])

  if (!entity) return null

  const temperature = entity.attributes.temperature || 20
  const condition = entity.state || 'clear'
  const variant = (config?.cardVariant as string) || 'standard'
  const humidity = entity.attributes.humidity
  const windSpeed = entity.attributes.wind_speed
  const pressure = entity.attributes.pressure

  const handleTap = () => {
    haptics.impact('light')
    setDialogOpen(true)
  }

  // Pointer gesture system: tap → open dialog, hold → open dialog with haptic
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const dialogOpenedRef = useRef(false)
  const pointerActiveRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    clearTimers()
    dialogOpenedRef.current = false
    pointerActiveRef.current = true

    haptics.impact('light')

    longPressTimerRef.current = window.setTimeout(() => {
      haptics.impact('medium')
      dialogOpenedRef.current = true
      setDialogOpen(true)
    }, 500)
  }, [clearTimers])

  const handlePointerUp = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearTimers()

    if (!dialogOpenedRef.current) {
      haptics.impact('light')
      setDialogOpen(true)
    }
  }, [clearTimers])

  // Compact variant - single line with icon + temp
  if (variant === 'compact') {
    return (
      <>
        <motion.div
          className="glass-card rounded-2xl theme-transition p-2.5 cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-foreground/70">{getWeatherIcon(condition, 18)}</span>
              <span className="text-sm font-medium text-foreground truncate">{getConditionText(condition)}</span>
            </div>
            <span className="text-sm font-mono font-semibold text-foreground shrink-0 ml-2">
              {Math.round(temperature)}°C
            </span>
          </div>
        </motion.div>
        <WeatherDetailDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    )
  }

  // Detailed variant - full info + forecast
  if (variant === 'detailed') {
    return (
      <>
        <motion.div
          className="glass-card glass-card-shimmer ambient-glow-card rounded-xl p-5 theme-transition cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="text-foreground/80 mb-2">
                {getWeatherIcon(condition, 40)}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-foreground/60 uppercase tracking-widest font-medium">{getConditionText(condition)}</p>
                <p className="text-5xl font-extralight text-foreground number-display tracking-tight">{Math.round(temperature)}°C</p>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-foreground/8">
            {humidity !== undefined && (
              <div className="flex items-center gap-1.5">
                <Drop size={14} weight="fill" className="text-foreground/40" />
                <span className="text-xs text-foreground/60 number-display">{humidity}%</span>
              </div>
            )}
            {windSpeed !== undefined && (
              <div className="flex items-center gap-1.5">
                <Wind size={14} weight="fill" className="text-foreground/40" />
                <span className="text-xs text-foreground/60 number-display">{windSpeed} km/h</span>
              </div>
            )}
            {pressure !== undefined && (
              <div className="flex items-center gap-1.5">
                <ThermometerSimple size={14} weight="fill" className="text-foreground/40" />
                <span className="text-xs text-foreground/60 number-display">{pressure} hPa</span>
              </div>
            )}
          </div>

          {forecast.length > 0 && (
            <div className="grid grid-cols-6 gap-1.5 mt-4 pt-4 border-t border-foreground/8">
              {forecast.slice(0, 6).map((day, idx) => (
                <div key={idx} className="text-center space-y-1.5 p-2 min-w-0">
                  <p className="text-[9px] text-foreground/50 font-medium uppercase tracking-wider truncate">
                    {getDayName(day.datetime)}
                  </p>
                  <div className="flex justify-center text-foreground/60">
                    {getWeatherIcon(day.condition, 18)}
                  </div>
                  <p className="text-xs font-medium text-foreground/90 number-display">{Math.round(day.temperature)}°</p>
                  {day.templow !== undefined && (
                    <p className="text-[10px] text-foreground/40 number-display">{Math.round(day.templow)}°</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </motion.div>
        <WeatherDetailDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    )
  }

  // Forecast only variant
  if (variant === 'forecast') {
    return (
      <>
        <motion.div
          className="glass-card glass-card-shimmer rounded-xl p-5 theme-transition cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <h4 className="text-xs font-semibold text-foreground/50 mb-3 uppercase tracking-widest">Vorhersage</h4>
          {forecastLoading ? (
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="text-center space-y-2">
                  <div className="skeleton-premium h-3 w-8 mx-auto" />
                  <div className="skeleton-premium h-5 w-5 mx-auto rounded-full" />
                  <div className="skeleton-premium h-3 w-6 mx-auto" />
                </div>
              ))}
            </div>
          ) : forecast.length > 0 ? (
            <div className="grid grid-cols-7 gap-2">
              {forecast.slice(0, 7).map((day, idx) => (
                <div key={idx} className="text-center space-y-1.5 p-2">
                  <p className="text-[10px] text-foreground/50 font-medium">
                    {getDayName(day.datetime)}
                  </p>
                  <div className="flex justify-center text-foreground/60">
                    {getWeatherIcon(day.condition, 20)}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground/90 number-display">{Math.round(day.temperature)}°</p>
                    {day.templow !== undefined && (
                      <p className="text-[10px] text-foreground/40 number-display">{Math.round(day.templow)}°</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground/40">Keine Vorhersage verfügbar</p>
          )}
        </motion.div>
        <WeatherDetailDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    )
  }

  const weatherW = widgetSize?.w ?? 2
  const weatherH = widgetSize?.h ?? 2
  const showExtraStats = weatherW >= 3 || weatherH >= 3
  const forecastDays = weatherW >= 4 ? 7 : 6

  // Standard variant (default)
  return (
    <>
      <motion.div
        className="glass-card glass-card-shimmer ambient-glow-card rounded-xl p-5 theme-transition cursor-pointer select-none touch-none h-full"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="text-foreground/80 mb-2">
              {getWeatherIcon(condition, weatherH >= 3 ? 48 : 40)}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-foreground/60 uppercase tracking-widest font-medium">{getConditionText(condition)}</p>
              <p className={`${weatherH >= 3 ? 'text-6xl' : 'text-5xl'} font-extralight text-foreground number-display tracking-tight`}>{Math.round(temperature)}°C</p>
            </div>
          </div>
        </div>

        {showExtraStats && (
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-foreground/8">
            {humidity !== undefined && (
              <div className="flex items-center gap-1.5">
                <Drop size={14} weight="fill" className="text-foreground/40" />
                <span className="text-xs text-foreground/60 number-display">{humidity}%</span>
              </div>
            )}
            {windSpeed !== undefined && (
              <div className="flex items-center gap-1.5">
                <Wind size={14} weight="fill" className="text-foreground/40" />
                <span className="text-xs text-foreground/60 number-display">{windSpeed} km/h</span>
              </div>
            )}
            {pressure !== undefined && (
              <div className="flex items-center gap-1.5">
                <ThermometerSimple size={14} weight="fill" className="text-foreground/40" />
                <span className="text-xs text-foreground/60 number-display">{pressure} hPa</span>
              </div>
            )}
          </div>
        )}

        {forecast.length > 0 && (
          <div className={`grid gap-1.5 mt-5 pt-5 border-t border-foreground/8`} style={{ gridTemplateColumns: `repeat(${forecastDays}, minmax(0, 1fr))` }}>
            {forecast.slice(0, forecastDays).map((day, idx) => (
              <div key={idx} className="text-center space-y-1.5 p-2 min-w-0">
                <p className="text-[9px] text-foreground/50 font-medium uppercase tracking-wider truncate">
                  {getDayName(day.datetime)}
                </p>
                <div className="flex justify-center text-foreground/60">
                  {getWeatherIcon(day.condition, 18)}
                </div>
                <p className="text-xs font-medium text-foreground/90 number-display">{Math.round(day.temperature)}°</p>
                {day.templow !== undefined && (
                  <p className="text-[10px] text-foreground/40 number-display">{Math.round(day.templow)}°</p>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>
      <WeatherDetailDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
