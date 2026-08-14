import { useCallback, useEffect } from 'react'
import { useLocalStorage } from '@/lib/storage'

export type UiScalePreset = 'auto' | 'compact' | 'normal' | 'large'

const PRESETS: Record<Exclude<UiScalePreset, 'auto'>, number> = {
  compact: 0.88,
  normal: 1.0,
  large: 1.12,
}

/** Resolution-based default: 1080p renders a touch smaller, 4K a touch larger. */
function autoScale(): number {
  const w = window.screen.width || 1920
  const h = window.screen.height || 1080
  const smallest = Math.min(w, h)
  if (smallest <= 1080) return 0.9
  if (smallest <= 1440) return 1.0
  return 1.12
}

/**
 * useUiScale — global UI scale multiplier applied to the root font size, so
 * all rem-based Tailwind utilities (text, spacing, radii) scale together.
 * `auto` adapts to the monitor resolution and reacts to window resizes.
 */
export function useUiScale() {
  const [preset, setPreset] = useLocalStorage<UiScalePreset>('iora-ui-scale', 'auto')

  const apply = useCallback((value: UiScalePreset) => {
    const scale = value === 'auto' ? autoScale() : PRESETS[value]
    document.documentElement.style.setProperty('--ui-scale', String(scale))
  }, [])

  useEffect(() => {
    apply(preset)
    if (preset !== 'auto') return
    const onResize = () => apply('auto')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [preset, apply])

  return { preset, setPreset }
}
