import { useEffect, useState } from 'react'

export interface DeviceCapabilities {
  /** Coarse pointer (touch) or any touch points available. */
  isTouch: boolean
  isCoarsePointer: boolean
  /** Fine pointer that can hover (mouse/trackpad). */
  hasHover: boolean
  isPhone: boolean
  isTablet: boolean
  isDesktop: boolean
  width: number
  height: number
}

function readCapabilities(): DeviceCapabilities {
  const mq = (q: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false)
  const isCoarsePointer = mq('(pointer: coarse)')
  const hasHover = mq('(hover: hover)')
  const width = window.innerWidth
  const height = window.innerHeight
  const maxTouch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0
  return {
    isTouch: isCoarsePointer || maxTouch > 0,
    isCoarsePointer,
    hasHover,
    isPhone: width < 640,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
    width,
    height,
  }
}

/**
 * useDeviceCapabilities — detects touch/hover and screen-size class so the UI
 * can adapt to smartphones, tablets and touch PCs. It also mirrors the result
 * onto <html> attributes (`data-touch`, `data-coarse-pointer`, `data-phone`,
 * `data-tablet`, `data-desktop`) for CSS targeting.
 */
export function useDeviceCapabilities(): DeviceCapabilities {
  const [caps, setCaps] = useState<DeviceCapabilities>(() => readCapabilities())

  useEffect(() => {
    const apply = () => {
      const c = readCapabilities()
      setCaps(c)
      const root = document.documentElement
      root.toggleAttribute('data-touch', c.isTouch)
      root.toggleAttribute('data-coarse-pointer', c.isCoarsePointer)
      root.toggleAttribute('data-phone', c.isPhone)
      root.toggleAttribute('data-tablet', c.isTablet)
      root.toggleAttribute('data-desktop', c.isDesktop)
    }
    apply()
    window.addEventListener('resize', apply)
    const coarse = window.matchMedia?.('(pointer: coarse)')
    coarse?.addEventListener?.('change', apply)
    return () => {
      window.removeEventListener('resize', apply)
      coarse?.removeEventListener?.('change', apply)
    }
  }, [])

  return caps
}
