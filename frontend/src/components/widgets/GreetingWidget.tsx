import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { WeatherEntity, ThemeMode } from '@/lib/types'
import { CloudRain, CloudSun, Sun, MoonStars } from '@phosphor-icons/react'

interface GreetingWidgetProps {
  userName?: string
  weatherEntity?: WeatherEntity
  theme?: ThemeMode
  config?: Record<string, unknown>
}

function getGreeting(t: TFunction) {
  const hour = new Date().getHours()
  
  if (hour >= 5 && hour < 12) return t('dashboard.greeting_morning')
  if (hour >= 12 && hour < 18) return t('dashboard.greeting_afternoon')
  if (hour >= 18 && hour < 22) return t('dashboard.greeting_evening')
  return t('dashboard.greeting_night')
}

function getTimeSpecificMessage(t: TFunction, theme?: ThemeMode, location?: string) {
  const hour = new Date().getHours()
  
  if (hour >= 5 && hour < 12) {
    return t('dashboard.message_morning', { location: location || '' })
  } else if (hour >= 12 && hour < 18) {
    return t('dashboard.message_afternoon')
  } else if (hour >= 18 && hour < 22) {
    return t('dashboard.message_evening')
  } else if (theme === 'sleep') {
    return t('dashboard.message_sleep')
  } else {
    return t('dashboard.message_night')
  }
}

export function GreetingWidget({ userName = 'Kai', weatherEntity, theme, config }: GreetingWidgetProps) {
  const { t } = useTranslation()
  const greeting = getGreeting(t)
  const temperature = weatherEntity?.attributes.temperature || 20
  const location = weatherEntity?.attributes.friendly_name || 'Kissing'
  const hour = new Date().getHours()
  const showWeather = (config?.showWeather ?? true) as boolean
  const showMessage = (config?.showMessage ?? true) as boolean
  
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
    <motion.div
      className="glass-card ambient-glow-card p-6 sm:p-8 rounded-3xl theme-transition relative overflow-hidden"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Ambient radial glow behind content */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 10% 40%, oklch(from var(--accent) l c h / 0.06) 0%, transparent 50%), radial-gradient(ellipse at 90% 80%, oklch(from var(--accent) l c h / 0.04) 0%, transparent 50%)`,
        }}
      />

      <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
        <div className="space-y-4 flex-1">
          <div className="flex items-center gap-4">
            <motion.div
              className="hidden sm:block"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5, type: 'spring', stiffness: 200 }}
            >
              {getThemeIcon()}
            </motion.div>
            <div>
              <motion.h1
                className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight text-gradient-greeting"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                {greeting}, {userName}
              </motion.h1>
              {showWeather && weatherEntity && (
                <motion.p
                  className="text-sm text-muted-foreground mt-2 font-mono number-display"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                >
                  {Math.round(temperature)}°C in {location}
                </motion.p>
              )}
            </div>
          </div>
          {showMessage && (
            <motion.p
              className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-xl"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              {getTimeSpecificMessage(t, theme, location)}
            </motion.p>
          )}
        </div>
        <motion.div
          className="sm:hidden flex justify-end"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5, type: 'spring', stiffness: 200 }}
        >
          {getThemeIcon()}
        </motion.div>
      </div>
    </motion.div>
  )
}
