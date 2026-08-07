/**
 * PageTransitionWrapper – Animated page transitions via motion.dev.
 *
 * Wraps page content with AnimatePresence to animate page changes.
 * Reads transition configuration from the active theme:
 * - transition_type: "fade", "slide", "scale", "flip", "custom"
 * - duration_secs: transition length
 * - spring: physics config (stiffness, damping, mass)
 *
 * Usage:
 * ```tsx
 * <PageTransitionWrapper pageKey={currentPageId}>
 *   <YourPageContent />
 * </PageTransitionWrapper>
 * ```
 */

import { motion, AnimatePresence, useReducedMotion, type Transition } from 'motion/react'
import { useTheme } from '@/contexts/ThemeContext'
import type { PageTransitionConfig, SpringConfig } from '@/contexts/ThemeContext'
import { useMemo } from 'react'

export interface PageTransitionWrapperProps {
  /** Unique key that changes when the page changes */
  pageKey: string
  /** Page content to animate */
  children: React.ReactNode
  /** Override transition config (won't use theme config) */
  transitionOverride?: Partial<PageTransitionConfig>
  /** Additional class name for the motion wrapper */
  className?: string
  /** Whether the component should wait for exit animation before entering */
  waitForExit?: boolean
}

/**
 * Build motion transition object from theme config.
 */
function buildTransition(config: PageTransitionConfig | null): Transition {
  if (config?.spring) {
    return {
      type: 'spring',
      stiffness: config.spring.stiffness,
      damping: config.spring.damping,
      mass: config.spring.mass,
      duration: config.duration_secs,
    }
  }
  return {
    duration: config?.duration_secs || 0.35,
    ease: [0.16, 1, 0.3, 1],
  }
}

/**
 * Get enter/exit animation variants based on transition type.
 */
function getVariants(type: string) {
  switch (type) {
    case 'slide':
      return {
        enter: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -20 },
        initial: { opacity: 0, x: 20 },
      }
    case 'scale':
      return {
        enter: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
        initial: { opacity: 0, scale: 0.95 },
      }
    case 'flip':
      return {
        enter: { opacity: 1, rotateY: 0 },
        exit: { opacity: 0, rotateY: -90 },
        initial: { opacity: 0, rotateY: 90 },
      }
    case 'custom':
      // Custom transition — theme defines custom animation via CSS
      return {
        enter: { opacity: 1 },
        exit: { opacity: 0 },
        initial: { opacity: 0 },
      }
    case 'fade':
    default:
      return {
        enter: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 8 },
        initial: { opacity: 0, y: 12 },
      }
  }
}

export function PageTransitionWrapper({
  pageKey,
  children,
  transitionOverride,
  className,
  waitForExit = true,
}: PageTransitionWrapperProps) {
  const { pageTransitionConfig } = useTheme()
  const reduceMotion = useReducedMotion()

  const config = transitionOverride 
    ? { ...pageTransitionConfig, ...transitionOverride } as PageTransitionConfig
    : pageTransitionConfig

  const transitionType = config?.transition_type || 'fade'
  const transition = useMemo(() => buildTransition(config), [config])
  const variants = useMemo(() => getVariants(transitionType), [transitionType])

  // If page transitions are disabled, render children directly
  if (reduceMotion || (config && !config.enabled)) {
    return <>{children}</>
  }

  const mode = waitForExit ? 'wait' as const : 'sync' as const

  return (
    <AnimatePresence mode={mode}>
      <motion.div
        key={pageKey}
        initial={variants.initial}
        animate={variants.enter}
        exit={variants.exit}
        transition={transition}
        className={className}
        style={
          transitionType === 'custom' && config?.custom_name
            ? { animationName: config.custom_name } as React.CSSProperties
            : undefined
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * Staggered widget entrance animation using motion.dev.
 * Replaces the CSS-based widget-animate-in with motion spring animations.
 */
export interface WidgetEntranceProps {
  children: React.ReactNode
  /** Index for stagger delay calculation */
  index?: number
  /** Override stagger delay */
  delay?: number
}

export function WidgetEntrance({ children, index = 0, delay }: WidgetEntranceProps) {
  const { widgetAnimationConfig } = useTheme()

  const config = widgetAnimationConfig
  const staggerSeconds = delay ?? (config?.stagger_secs ?? 0.03) * index
  const duration = config?.duration_secs ?? 0.4
  const style = config?.style || 'fade-up'

  const getVariant = () => {
    switch (style) {
      case 'scale-in':
        return { initial: { opacity: 0, scale: 0.9 }, animate: { opacity: 1, scale: 1 } }
      case 'slide-left':
        return { initial: { opacity: 0, x: 30 }, animate: { opacity: 1, x: 0 } }
      case 'slide-right':
        return { initial: { opacity: 0, x: -30 }, animate: { opacity: 1, x: 0 } }
      case 'fade-up':
      default:
        return { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }
    }
  }

  const variant = getVariant()
  const transition: Transition = config?.spring
    ? { type: 'spring', stiffness: config.spring.stiffness, damping: config.spring.damping, mass: config.spring.mass, duration }
    : { duration, ease: [0.16, 1, 0.3, 1], delay: staggerSeconds }

  return (
    <motion.div
      initial={variant.initial}
      animate={variant.animate}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}
