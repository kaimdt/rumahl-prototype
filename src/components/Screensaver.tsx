import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useIdleTimer } from 'react-idle-timer'

interface ScreensaverProps {
  timeout?: number // in milliseconds, default 5 minutes
  enabled?: boolean
}

export function Screensaver({ timeout = 300000, enabled = true }: ScreensaverProps) {
  const [isActive, setIsActive] = useState(false)
  const [currentTime, setCurrentTime] = useState(new Date())

  // Update time every second when screensaver is active
  useEffect(() => {
    if (!isActive) return

    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [isActive])

  const onIdle = useCallback(() => {
    if (enabled) {
      setIsActive(true)
    }
  }, [enabled])

  const onActive = useCallback(() => {
    setIsActive(false)
  }, [])

  useIdleTimer({
    timeout,
    onIdle,
    onActive,
    debounce: 500,
  })

  const hours = currentTime.getHours().toString().padStart(2, '0')
  const minutes = currentTime.getMinutes().toString().padStart(2, '0')
  const seconds = currentTime.getSeconds()
  const date = currentTime.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Seconds as a subtle progress arc (0-59 mapped to 0-360)
  const secondsDeg = (seconds / 60) * 360

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center cursor-pointer overflow-hidden"
          style={{ background: 'oklch(0.02 0.01 250)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={onActive}
          onTouchStart={onActive}
          onMouseMove={onActive}
          onKeyDown={onActive}
        >
          {/* Floating ambient orbs */}
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              className="absolute w-[500px] h-[500px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.25 0.12 250 / 0.12) 0%, transparent 70%)',
                top: '15%',
                left: '30%',
              }}
              animate={{
                x: [0, 60, -30, 0],
                y: [0, -40, 30, 0],
                scale: [1, 1.15, 0.95, 1],
              }}
              transition={{
                duration: 25,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <motion.div
              className="absolute w-[400px] h-[400px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.30 0.15 210 / 0.08) 0%, transparent 70%)',
                bottom: '20%',
                right: '25%',
              }}
              animate={{
                x: [0, -50, 40, 0],
                y: [0, 30, -50, 0],
                scale: [1.1, 1, 1.2, 1.1],
              }}
              transition={{
                duration: 30,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 3,
              }}
            />
            <motion.div
              className="absolute w-[300px] h-[300px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.20 0.10 280 / 0.06) 0%, transparent 70%)',
                top: '50%',
                left: '60%',
              }}
              animate={{
                x: [0, 40, -20, 0],
                y: [0, -60, 20, 0],
              }}
              transition={{
                duration: 20,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 6,
              }}
            />
          </div>

          <div className="text-center select-none relative">
            {/* Seconds ring indicator */}
            <div className="relative inline-block mb-2">
              <svg
                width="280"
                height="180"
                viewBox="0 0 280 180"
                className="absolute -top-6 left-1/2 -translate-x-1/2 pointer-events-none opacity-[0.15]"
              >
                <motion.circle
                  cx="140"
                  cy="90"
                  r="85"
                  fill="none"
                  stroke="oklch(0.65 0.20 210)"
                  strokeWidth="0.5"
                  strokeDasharray={`${(secondsDeg / 360) * 534} 534`}
                  strokeLinecap="round"
                  transform="rotate(-90 140 90)"
                  style={{ filter: 'drop-shadow(0 0 6px oklch(0.65 0.20 210 / 0.3))' }}
                />
              </svg>

              {/* Clock display */}
              <motion.div
                className="font-extralight tabular-nums"
                style={{
                  fontSize: 'clamp(4.5rem, 18vw, 11rem)',
                  lineHeight: 1,
                  letterSpacing: '-0.02em',
                }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                <span style={{ color: 'oklch(0.92 0.005 250)' }}>
                  {hours}
                </span>
                <motion.span
                  style={{ color: 'oklch(0.50 0.02 250)' }}
                  className="mx-1"
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  :
                </motion.span>
                <span style={{ color: 'oklch(0.92 0.005 250)' }}>
                  {minutes}
                </span>
              </motion.div>
            </div>

            {/* Date */}
            <motion.div
              className="mt-4 font-light tracking-wider"
              style={{
                fontSize: 'clamp(0.85rem, 2.5vw, 1.5rem)',
                color: 'oklch(0.50 0.02 250)',
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 0.7, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {date}
            </motion.div>

            {/* Wake hint - appears after a delay */}
            <motion.div
              className="mt-16 text-sm tracking-[0.2em] uppercase font-light"
              style={{ color: 'oklch(0.30 0.01 250)' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ delay: 3, duration: 1.5 }}
            >
              Tippen zum Aufwecken
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Screensaver settings hook
export function useScreensaverSettings() {
  const [enabled, setEnabled] = useState(() => {
    const stored = localStorage.getItem('screensaver-enabled')
    return stored ? JSON.parse(stored) : true
  })

  const [timeout, setTimeout] = useState(() => {
    const stored = localStorage.getItem('screensaver-timeout')
    return stored ? parseInt(stored) : 300000 // 5 minutes default
  })

  useEffect(() => {
    localStorage.setItem('screensaver-enabled', JSON.stringify(enabled))
  }, [enabled])

  useEffect(() => {
    localStorage.setItem('screensaver-timeout', timeout.toString())
  }, [timeout])

  return useMemo(() => ({
    enabled,
    setEnabled,
    timeout,
    setTimeout,
  }), [enabled, setEnabled, timeout, setTimeout])
}
