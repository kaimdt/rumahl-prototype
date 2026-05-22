/**
 * ThemeSplashScreen – Theme-aware splash/loading screen.
 *
 * Reads splash configuration from the active theme and renders:
 * - Custom splash HTML template (if provided by the theme)
 * - Or a motion.dev-powered splash animation using theme colors
 * - Support for custom logo, brand text, progress bar, background
 * - Configurable exit animations (fade, scale, slide-up, slide-down)
 *
 * Falls back to the original SplashScreen when no theme splash config exists.
 */

import { motion, AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import type { SplashConfig } from '@/contexts/ThemeContext'

interface ThemeSplashScreenProps {
  onComplete: () => void
  duration?: number
}

/** Default status messages in German (if theme doesn't provide custom ones) */
const DEFAULT_STATUS_MESSAGES = [
  'IORA Core wird geladen...',
  'IORA Home verbindet...',
  'IORA Assist initialisiert...',
  'System bereit.',
]

/**
 * Get theme-aware gradient background based on the splash config or CSS variables.
 */
function resolveBackgroundColor(
  config: SplashConfig | null,
  cssVars: Record<string, string>
): string {
  if (config?.background_color) return config.background_color
  // Use theme's background color or fall back to dark
  return cssVars['background'] || 'oklch(0.08 0.02 250)'
}

/**
 * Resolve colors from theme CSS variables or use defaults.
 */
function resolveThemeColors(
  config: SplashConfig | null,
  cssVars: Record<string, string>
) {
  const accent = cssVars['accent'] || 'oklch(0.65 0.20 210)'
  const foreground = cssVars['foreground'] || 'oklch(0.92 0.01 250)'
  const mutedFg = cssVars['muted-foreground'] || 'oklch(0.55 0.02 250)'
  return { accent, foreground, mutedFg }
}

/**
 * Determine the exit animation variant based on config.
 */
function getExitVariant(exitAnimation: string) {
  switch (exitAnimation) {
    case 'scale':
      return { opacity: 0, scale: 0.92 }
    case 'slide-up':
      return { opacity: 0, y: -40 }
    case 'slide-down':
      return { opacity: 0, y: 40 }
    case 'custom':
      // For custom, use a subtle fade-scale for smoothness
      return { opacity: 0, scale: 1.02, filter: 'blur(8px)' }
    case 'fade':
    default:
      return { opacity: 0, scale: 1.02 }
  }
}

/**
 * Get exit transition timing based on animation type.
 */
function getExitTransition(exitAnimation: string): object {
  switch (exitAnimation) {
    case 'scale':
      return { duration: 0.55, ease: [0.16, 1, 0.3, 1] }
    case 'slide-up':
    case 'slide-down':
      return { type: 'spring' as const, stiffness: 300, damping: 30 }
    case 'custom':
      return { duration: 0.7, ease: [0.16, 1, 0.3, 1] }
    case 'fade':
    default:
      return { duration: 0.5, ease: [0.16, 1, 0.3, 1] }
  }
}

export function ThemeSplashScreen({ onComplete, duration }: ThemeSplashScreenProps) {
  const {
    splashConfig,
    activeCssVariables,
    themeResponse,
  } = useTheme()

  const [show, setShow] = useState(true)
  const [progress, setProgress] = useState(0)
  const [statusIndex, setStatusIndex] = useState(0)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const config = splashConfig
  const effectiveDuration = duration ?? config?.duration_ms ?? 2200
  const statusMessages = DEFAULT_STATUS_MESSAGES
  const stepInterval = useMemo(
    () => effectiveDuration / statusMessages.length,
    [effectiveDuration]
  )
  const colors = useMemo(
    () => resolveThemeColors(config, activeCssVariables),
    [config, activeCssVariables]
  )
  const backgroundColor = useMemo(
    () => resolveBackgroundColor(config, activeCssVariables),
    [config, activeCssVariables]
  )
  const exitVariant = getExitVariant(config?.exit_animation || 'fade')
  const exitTransition = getExitTransition(config?.exit_animation || 'fade')
  const showProgress = config?.show_progress !== false
  const brandText = config?.brand_text || 'IORA'
  const tagline = config?.tagline

  useEffect(() => {
    // Smooth eased progress
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval)
          return 100
        }
        const remaining = 100 - prev
        return prev + Math.max(0.5, remaining * 0.06)
      })
    }, effectiveDuration / 80)

    // Cycle status messages
    const statusTimer = setInterval(() => {
      setStatusIndex(prev => Math.min(prev + 1, statusMessages.length - 1))
    }, stepInterval)

    const timer = setTimeout(() => {
      setProgress(100)
      setShow(false)
      setTimeout(() => onCompleteRef.current(), 500)
    }, effectiveDuration)

    return () => {
      clearTimeout(timer)
      clearInterval(progressInterval)
      clearInterval(statusTimer)
    }
  }, [effectiveDuration, stepInterval])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={exitVariant}
          transition={exitTransition}
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          style={{ background: backgroundColor }}
        >
          {/* Ambient background gradients using theme accent */}
          <div className="absolute inset-0 pointer-events-none">
            <motion.div
              className="absolute w-[600px] h-[600px] rounded-full"
              style={{
                background: `radial-gradient(circle, ${colors.accent}22 0%, transparent 70%)`,
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
                background: `radial-gradient(circle, ${colors.accent}15 0%, transparent 70%)`,
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
            {/* Logo mark – theme-aware */}
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
              {/* Logo image or orbital rings */}
              {config?.logo_url ? (
                <motion.img
                  src={config.logo_url}
                  alt={brandText}
                  className="w-20 h-20 mb-8 object-contain"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                />
              ) : (
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
                      border: `1px solid ${colors.accent}33`,
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
                      border: `1px solid ${colors.accent}25`,
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
                      background: colors.accent,
                      top: 0,
                      left: '50%',
                      marginLeft: '-3px',
                      boxShadow: `0 0 12px 2px ${colors.accent}88`,
                    }}
                  />
                  {/* Center core */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      className="w-3 h-3 rounded-full"
                      style={{
                        background: colors.accent,
                        boxShadow: `0 0 20px 4px ${colors.accent}66`,
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
              )}

              {/* Brand text */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-2"
              >
                <h1
                  className="text-[1.75rem] font-extralight tracking-[0.3em] uppercase"
                  style={{ color: colors.foreground }}
                >
                  {brandText}
                </h1>
                {tagline && (
                  <p
                    className="text-[10px] font-medium tracking-[0.5em] uppercase"
                    style={{ color: colors.mutedFg }}
                  >
                    {tagline}
                  </p>
                )}
              </motion.div>
            </motion.div>

            {/* Progress section */}
            {showProgress && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="w-72 mx-auto space-y-4"
              >
                {/* Progress track */}
                <div
                  className="h-[2px] rounded-full overflow-hidden"
                  style={{ background: `${colors.foreground}15` }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${colors.accent}, ${colors.accent}cc)`,
                      boxShadow: `0 0 12px ${colors.accent}88`,
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
                    style={{ color: colors.mutedFg }}
                  >
                    {statusMessages[statusIndex]}
                  </motion.p>
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
