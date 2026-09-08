import type { Transition } from 'motion/react'

/**
 * OS-wide motion vocabulary — every entrance, exit and spring in the shell
 * draws from these presets so the whole system moves with one rhythm.
 *
 * Tune a preset here and every surface (windows, dock, menus, lock screen)
 * inherits the change — that is what makes the OS feel "one instrument".
 */

/** Standard OS panel/curve: snappy deceleration, no bounce. */
export const EASE_OS: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** Softer settle for large/hero entrances (login, dock, splash). */
export const EASE_SOFT: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** Micro-interactions: hover, press, tooltips. */
export const DUR_FAST = 0.15
/** Small panels and menu popovers. */
export const DUR_BASE = 0.2
/** Page transitions, top bar slide. */
export const DUR_PAGE = 0.26
/** Hero entrances (dock, login card). */
export const DUR_SLOW = 0.5

/** Standard entrance for windows, panels and popovers. */
export const MOTION_PANEL: Transition = { duration: DUR_BASE, ease: EASE_OS }

/** Softer, slightly slower entrance for large surfaces. */
export const MOTION_HERO: Transition = { duration: DUR_SLOW, ease: EASE_SOFT }

/** Dock items: springy but damped — rises and settles without wobble. */
export const SPRING_SOFT = { type: 'spring', stiffness: 320, damping: 26, mass: 0.9 }
