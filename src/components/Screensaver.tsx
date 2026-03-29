import { useState, useEffect, useMemo } from 'react'
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

  const onIdle = () => {
    if (enabled) {
      setIsActive(true)
    }
  }

  const onActive = () => {
    setIsActive(false)
  }

  useIdleTimer({
    timeout,
    onIdle,
    onActive,
    debounce: 500,
  })

  const hours = currentTime.getHours().toString().padStart(2, '0')
  const minutes = currentTime.getMinutes().toString().padStart(2, '0')
  const seconds = currentTime.getSeconds().toString().padStart(2, '0')
  const date = currentTime.toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black cursor-pointer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          onClick={onActive}
          onTouchStart={onActive}
          onMouseMove={onActive}
          onKeyDown={onActive}
        >
          <div className="text-center select-none">
            {/* Clock */}
            <motion.div
              className="font-light tracking-tight"
              style={{
                fontSize: 'clamp(4rem, 20vw, 12rem)',
                lineHeight: 1,
              }}
              animate={{
                opacity: [0.95, 1, 0.95],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <span className="text-white/90">
                {hours}
                <span className="text-white/60 mx-2">:</span>
                {minutes}
              </span>
              <motion.span
                className="text-white/40 text-[0.5em] ml-4"
                animate={{
                  opacity: [0.3, 0.6, 0.3],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                {seconds}
              </motion.span>
            </motion.div>

            {/* Date */}
            <motion.div
              className="mt-8 text-white/60 font-light"
              style={{
                fontSize: 'clamp(1rem, 3vw, 2rem)',
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 0.8, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              {date}
            </motion.div>

            {/* Hint text */}
            <motion.div
              className="mt-12 text-white/30 text-sm tracking-wide"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              transition={{ delay: 2, duration: 1 }}
            >
              Tippen oder Bewegen zum Aufwecken
            </motion.div>
          </div>

          {/* Ambient animation */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)',
            }}
            animate={{
              scale: [1, 1.1, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
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
