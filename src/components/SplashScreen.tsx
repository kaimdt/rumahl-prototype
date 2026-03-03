import { motion, AnimatePresence } from 'framer-motion'
import { House, Sparkle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

interface SplashScreenProps {
  onComplete: () => void
  duration?: number
}

export function SplashScreen({ onComplete, duration = 2000 }: SplashScreenProps) {
  const [show, setShow] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false)
      setTimeout(onComplete, 500) // Wait for exit animation
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onComplete])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-50 bg-gradient-to-br from-background via-background to-accent/10 flex items-center justify-center"
        >
          <div className="text-center space-y-8">
            {/* Logo animation */}
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 20,
                delay: 0.2,
              }}
            >
              <motion.div
                animate={{
                  rotate: [0, 360],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'linear',
                }}
                className="relative mx-auto w-24 h-24"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-accent/30 to-accent/10 rounded-full blur-2xl" />
                <div className="relative glass-card rounded-full p-6 border-2 border-accent/20">
                  <House size={48} weight="fill" className="text-accent" />
                </div>
              </motion.div>
            </motion.div>

            {/* Title */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              <h1 className="text-4xl font-bold text-foreground tracking-tight">
                MDT HOME
              </h1>
              <p className="text-sm text-foreground/60 mt-2">
                Smart Home Dashboard
              </p>
            </motion.div>

            {/* Loading indicator */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center justify-center gap-2"
            >
              <motion.div
                animate={{
                  rotate: 360,
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  ease: 'linear',
                }}
              >
                <Sparkle size={20} weight="fill" className="text-accent" />
              </motion.div>
              <span className="text-sm text-foreground/60">Wird geladen...</span>
            </motion.div>

            {/* Progress bar */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: duration / 1000, ease: 'easeInOut' }}
              className="w-64 h-1 bg-foreground/10 rounded-full overflow-hidden mx-auto"
              style={{ transformOrigin: 'left' }}
            >
              <div className="h-full bg-gradient-to-r from-accent via-accent/80 to-accent rounded-full" />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
