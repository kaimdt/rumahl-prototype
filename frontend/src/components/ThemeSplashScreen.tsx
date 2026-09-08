/**
 * ThemeSplashScreen – Theme-aware splash/loading screen.
 *
 * Renders the rumahl OS boot splash in the design language of
 * `rumahl-os-splash.html`: a near-black canvas, the white rumahl "r"
 * mark with a breathing glow, a hairline loader and a muted label.
 *
 * Reads splash configuration from the active theme and renders:
 * - Custom splash logo image (if provided by the theme)
 * - Configurable exit animations (fade, scale, slide-up, slide-down)
 * - Configurable background color, brand text, tagline and duration
 *
 * The OS boot process can finish the splash early via
 * `window.finishRumahlSplash()`.
 */

import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import type { SplashConfig } from '@/contexts/ThemeContext'
import { RumahlMark } from '@/components/RumahlMark'

interface ThemeSplashScreenProps {
  onComplete: () => void
  duration?: number
}

/** Splash canvas color from rumahl-os-splash.html */
const SPLASH_BACKGROUND = '#050505'

/** Brand box size from the splash (clamped between 72px and 116px) */
const BRAND_SIZE = 'clamp(72px, 8.2vw, 116px)'

/**
 * Get the splash background color based on the splash config or the
 * default splash canvas (near-black).
 */
function resolveBackgroundColor(config: SplashConfig | null): string {
  if (config?.background_color) return config.background_color
  return SPLASH_BACKGROUND
}

/**
 * Determine the exit animation variant based on config. The default
 * ("fade") mirrors the splash HTML: brand glides up and blurs, the
 * canvas fades out shortly after.
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
      return { opacity: 0 }
  }
}

/**
 * Get exit transition timing based on animation type. The default fade
 * waits for the brand's own exit animation before the canvas disappears.
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
      return { duration: 0.55, delay: 0.18, ease: [0.16, 1, 0.3, 1] }
  }
}

export function ThemeSplashScreen({ onComplete, duration }: ThemeSplashScreenProps) {
  const { splashConfig } = useTheme()

  const [show, setShow] = useState(true)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const showRef = useRef(show)
  showRef.current = show
  const reducedMotion = useReducedMotion()

  const config = splashConfig
  // Default is shorter than the standalone splash HTML (5200ms) because the
  // web app shows the splash on every full page load; 3s lets the brand
  // animation play out without blocking the dashboard.
  const effectiveDuration = duration ?? config?.duration_ms ?? 3000
  const backgroundColor = useMemo(
    () => resolveBackgroundColor(config),
    [config]
  )
  const exitVariant = getExitVariant(config?.exit_animation || 'fade')
  const exitTransition = getExitTransition(config?.exit_animation || 'fade')
  const showProgress = config?.show_progress !== false
  const brandText = config?.brand_text || 'rumahl OS'
  const tagline = config?.tagline

  /**
   * Finish the splash: trigger the exit animations, then hand control
   * back to the app. Exposed as `window.finishRumahlSplash()` so the
   * real OS boot process can finish early.
   */
  const finishSplash = useCallback(() => {
    if (!showRef.current) return
    showRef.current = false
    setShow(false)
    window.setTimeout(() => onCompleteRef.current(), 420)
  }, [])

  useEffect(() => {
    window.finishRumahlSplash = finishSplash
    return () => {
      if (window.finishRumahlSplash === finishSplash) {
        delete window.finishRumahlSplash
      }
    }
  }, [finishSplash])

  useEffect(() => {
    const timer = setTimeout(() => finishSplash(), effectiveDuration)
    return () => clearTimeout(timer)
  }, [effectiveDuration])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="rumahl-splash"
          initial={{ opacity: 1 }}
          exit={exitVariant}
          transition={exitTransition}
          className="fixed inset-0 z-[9999] grid place-items-center overflow-hidden"
          style={{
            background: `radial-gradient(circle at 50% 45%, rgba(255,255,255,.035), transparent 28%), ${backgroundColor}`,
            isolation: 'isolate',
          }}
          aria-label="rumahl OS startet"
        >
          {/* Brand mark with breathing glow (splash HTML design) */}
          <motion.div
            className="relative"
            style={{ width: BRAND_SIZE, aspectRatio: '1' }}
            initial={reducedMotion ? false : { opacity: 0, y: 6, scale: 0.93, filter: 'blur(8px)' }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: -6, scale: 1, filter: 'blur(0px)' }}
            exit={reducedMotion ? { opacity: 0 } : {
              opacity: 0,
              y: -14,
              scale: 0.985,
              filter: 'blur(4px)',
              transition: { duration: 0.58, ease: [0.7, 0, 0.84, 0] },
            }}
            transition={{ duration: 1.05, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Breathing glow behind the mark */}
            {!reducedMotion && (
              <motion.div
                className="absolute rounded-full"
                style={{
                  inset: '-42%',
                  background: 'radial-gradient(circle, rgba(255,255,255,.09), rgba(255,255,255,0) 67%)',
                  filter: 'blur(10px)',
                }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: [0.12, 0.48, 0.12], scale: [0.94, 1.04, 0.94] }}
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.7 }}
              />
            )}

            {config?.logo_url ? (
              <motion.img
                src={config.logo_url}
                alt={brandText}
                className="relative h-full w-full object-contain"
                initial={reducedMotion ? false : { scale: 0.9 }}
                animate={reducedMotion ? undefined : { scale: [0.9, 1.018, 1] }}
                transition={{ duration: 1.15, times: [0, 0.7, 1], ease: [0.16, 1, 0.3, 1] }}
              />
            ) : (
              <motion.div
                className="relative h-full w-full"
                initial={reducedMotion ? false : { scale: 0.9 }}
                animate={reducedMotion ? undefined : { scale: [0.9, 1.018, 1] }}
                transition={{ duration: 1.15, times: [0, 0.7, 1], ease: [0.16, 1, 0.3, 1] }}
              >
                <RumahlMark
                  className="h-full w-full text-white"
                  style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,.28))' }}
                />
              </motion.div>
            )}
          </motion.div>

          {/* Status: hairline loader + muted label */}
          <motion.div
            className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-3.5"
            style={{ bottom: 'clamp(34px, 6vh, 68px)' }}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? undefined : {
              opacity: 0,
              y: 5,
              transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] },
            }}
            transition={{ duration: 0.7, delay: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {showProgress && (
              <div
                className="relative h-[2px] w-11 overflow-hidden rounded-full"
                style={{ background: 'rgba(255,255,255,.12)' }}
                aria-hidden="true"
              >
                {!reducedMotion && (
                  <motion.div
                    className="absolute h-full w-[42%] rounded-full"
                    style={{ background: 'rgba(255,255,255,.82)' }}
                    initial={false}
                    animate={{ x: ['-130%', '115%', '250%'] }}
                    transition={{ duration: 1.35, times: [0, 0.55, 1], repeat: Infinity, ease: [0.65, 0, 0.35, 1] }}
                  />
                )}
              </div>
            )}
            <div
              className="select-none text-[12px] font-medium tracking-[0.04em]"
              style={{ color: 'rgba(255,255,255,.42)' }}
            >
              {brandText}
            </div>
            {(tagline) && (
              <p
                className="text-[11px] font-light tracking-[0.08em]"
                style={{ color: 'rgba(255,255,255,.30)' }}
              >
                {tagline}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

declare global {
  interface Window {
    /** Finish the rumahl OS splash early (called by the boot process). */
    finishRumahlSplash?: () => void
  }
}
