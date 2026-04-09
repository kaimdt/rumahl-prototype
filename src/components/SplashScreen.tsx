import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState, useMemo } from 'react'

interface SplashScreenProps {
  onComplete: () => void
  duration?: number
}

const STATUS_MESSAGES = [
  'IORA Core wird geladen...',
  'IORA Home verbindet...',
  'IORA Assist initialisiert...',
  'System bereit.',
]

export function SplashScreen({ onComplete, duration = 2200 }: SplashScreenProps) {
  const [show, setShow] = useState(true)
  const [progress, setProgress] = useState(0)
  const [statusIndex, setStatusIndex] = useState(0)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const stepInterval = useMemo(() => duration / STATUS_MESSAGES.length, [duration])

  useEffect(() => {
    // Smooth eased progress
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval)
          return 100
        }
        // Ease-out curve for natural loading feel
        const remaining = 100 - prev
        return prev + Math.max(0.5, remaining * 0.06)
      })
    }, duration / 80)

    // Cycle status messages
    const statusTimer = setInterval(() => {
      setStatusIndex(prev => Math.min(prev + 1, STATUS_MESSAGES.length - 1))
    }, stepInterval)

    const timer = setTimeout(() => {
      setProgress(100)
      setShow(false)
      setTimeout(() => onCompleteRef.current(), 500)
    }, duration)

    return () => {
      clearTimeout(timer)
      clearInterval(progressInterval)
      clearInterval(statusTimer)
    }
  }, [duration, stepInterval])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          style={{ background: 'oklch(0.08 0.02 250)' }}
        >
          {/* Ambient background gradients */}
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              className="absolute w-[600px] h-[600px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.35 0.15 250 / 0.15) 0%, transparent 70%)',
                top: '20%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
              animate={{
                scale: [1, 1.15, 1],
                opacity: [0.5, 0.8, 0.5],
              }}
              transition={{
                duration: 6,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            />
            <motion.div
              className="absolute w-[400px] h-[400px] rounded-full"
              style={{
                background: 'radial-gradient(circle, oklch(0.40 0.18 210 / 0.1) 0%, transparent 70%)',
                bottom: '15%',
                right: '20%',
              }}
              animate={{
                scale: [1.1, 1, 1.1],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 8,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 1,
              }}
            />
          </div>

          <div className="relative text-center space-y-16">
            {/* Logo mark */}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 20,
                delay: 0.1,
              }}
              className="flex flex-col items-center"
            >
              {/* Orbital rings */}
              <motion.div
                className="relative w-24 h-24 mb-8"
                initial={{ rotate: 0 }}
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              >
                {/* Outer orbit */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    border: '1px solid oklch(0.65 0.20 210 / 0.2)',
                  }}
                  animate={{
                    scale: [1, 1.08, 1],
                    opacity: [0.3, 0.6, 0.3],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
                {/* Inner orbit */}
                <motion.div
                  className="absolute rounded-full"
                  style={{
                    inset: '20%',
                    border: '1px solid oklch(0.65 0.20 210 / 0.15)',
                  }}
                  animate={{
                    scale: [1.05, 1, 1.05],
                    opacity: [0.2, 0.5, 0.2],
                  }}
                  transition={{
                    duration: 2.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: 0.3,
                  }}
                />
                {/* Orbiting dot */}
                <motion.div
                  className="absolute w-1.5 h-1.5 rounded-full"
                  style={{
                    background: 'oklch(0.65 0.20 210)',
                    top: 0,
                    left: '50%',
                    marginLeft: '-3px',
                    boxShadow: '0 0 12px 2px oklch(0.65 0.20 210 / 0.5)',
                  }}
                />
                {/* Center core */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <motion.div
                    className="w-3 h-3 rounded-full"
                    style={{
                      background: 'oklch(0.65 0.20 210)',
                      boxShadow: '0 0 20px 4px oklch(0.65 0.20 210 / 0.4)',
                    }}
                    animate={{
                      scale: [1, 1.3, 1],
                      opacity: [0.8, 1, 0.8],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                </div>
              </motion.div>

              {/* Brand text */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-2"
              >
                <h1
                  className="text-[1.75rem] font-extralight tracking-[0.3em] uppercase"
                  style={{ color: 'oklch(0.92 0.01 250)' }}
                >
                  IORA
                </h1>
                <p
                  className="text-[10px] font-medium tracking-[0.5em] uppercase"
                  style={{ color: 'oklch(0.55 0.02 250)' }}
                >
                  Interface for Optimized Residential Autonomy
                </p>
              </motion.div>
            </motion.div>

            {/* Progress section */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="w-72 mx-auto space-y-4"
            >
              {/* Progress track */}
              <div
                className="h-[2px] rounded-full overflow-hidden"
                style={{ background: 'oklch(0.25 0.02 250)' }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: 'linear-gradient(90deg, oklch(0.65 0.20 210), oklch(0.70 0.16 230))',
                    boxShadow: '0 0 12px oklch(0.65 0.20 210 / 0.5)',
                  }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.3 }}
                />
              </div>

              {/* Status text */}
              <AnimatePresence mode="wait">
                <motion.p
                  key={statusIndex}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 0.6, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="text-xs font-light tracking-wider"
                  style={{ color: 'oklch(0.55 0.02 250)' }}
                >
                  {STATUS_MESSAGES[statusIndex]}
                </motion.p>
              </AnimatePresence>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
