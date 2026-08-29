import { useCallback, useEffect } from 'react'
import { useLocalStorage } from '@/lib/storage'

/** UI scale presets — a fixed percentage, or `auto` (resolution-based). */
export type UiScalePreset = 'auto' | '100' | '125' | '150'

const PERCENT_PRESETS: Record<Exclude<UiScalePreset, 'auto'>, number> = {
  '100': 1.0,
  '125': 1.25,
  '150': 1.5,
}

function isUiScalePreset(value: unknown): value is UiScalePreset {
  return value === 'auto' || value === '100' || value === '125' || value === '150'
}

/** Resolution-based default: 1080p renders a touch smaller, 1440p/4K a touch larger. */
function autoScale(): number {
  const w = window.screen.width || 1920
  const h = window.screen.height || 1080
  const smallest = Math.min(w, h)
  if (smallest <= 1080) return 1.0
  if (smallest <= 1440) return 1.12
  return 1.25
}

/**
 * useUiScale — global UI scale multiplier applied to the root font size, so
 * all rem-based Tailwind utilities (text, spacing, radii) scale together.
 * Presets are 100% / 125% / 150%; `auto` adapts to the monitor resolution.
 */
export function useUiScale() {
  const [preset, setPreset] = useLocalStorage<UiScalePreset>('rumahl-ui-scale', 'auto')
  const normalizedPreset = isUiScalePreset(preset) ? preset : 'auto'

  const apply = useCallback((value: UiScalePreset) => {
    // Older settings and partially initialised storage may yield an invalid
    // preset at startup. Never write `undefined` into the CSS variable: that
    // invalidates every typography calc() using --ui-scale and makes unrelated
    // app text collapse to the browser's inherited 16px default.
    const scale = value === 'auto' ? autoScale() : PERCENT_PRESETS[value] ?? autoScale()
    document.documentElement.style.setProperty('--ui-scale', String(scale))
  }, [])

  useEffect(() => {
    apply(normalizedPreset)
    if (normalizedPreset !== 'auto') return
    const onResize = () => apply('auto')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [normalizedPreset, apply])

  return { preset: normalizedPreset, setPreset }
}
