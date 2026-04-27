import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

interface DigitalClockProps {
  showSeconds?: boolean
  show24Hour?: boolean
  showDate?: boolean
}

export function DigitalClock({
  showSeconds = true,
  show24Hour = true,
  showDate = true
}: DigitalClockProps) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatTime = () => {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      ...(showSeconds && { second: '2-digit' }),
      hour12: !show24Hour,
    }
    return time.toLocaleTimeString('de-DE', options)
  }

  const formatDate = () => {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }
    return time.toLocaleDateString('de-DE', options)
  }

  const getTimeOfDay = () => {
    const hour = time.getHours()
    if (hour >= 5 && hour < 12) return 'Morgen'
    if (hour >= 12 && hour < 18) return 'Tag'
    if (hour >= 18 && hour < 22) return 'Abend'
    return 'Nacht'
  }

  return (
    <motion.div
      className="glass-card rounded-2xl p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="text-center space-y-3 overflow-hidden">
        {/* Time display */}
        <motion.div
          className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(2rem,7vw,3.75rem)] leading-none font-light tabular-nums tracking-tight text-foreground"
          animate={{ opacity: [0.9, 1, 0.9] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {formatTime()}
        </motion.div>

        {/* Date display */}
        {showDate && (
          <div className="space-y-1">
            <p className="text-sm text-foreground/60 capitalize">
              {formatDate()}
            </p>
            <p className="text-xs text-foreground/40">
              Guten {getTimeOfDay()}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  )
}
