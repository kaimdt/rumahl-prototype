import { useEffect } from 'react'
import { useLocalStorage } from '@/lib/storage'

export const DEFAULT_SURFACE_APPEARANCE = { accentSurfaces: false, style: 'solid', opacity: 68, blur: 24, tint: '#8b5cf6', tintStrength: 10 }

export function normalizeSurfaceAppearance(value: unknown) {
  const stored = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const number = (key: string, fallback: number, min: number, max: number) => typeof stored[key] === 'number' && Number.isFinite(stored[key]) ? Math.max(min, Math.min(max, stored[key] as number)) : fallback
  return {
    accentSurfaces: stored.accentSurfaces === true,
    style: stored.style === 'glass' ? 'glass' : 'solid',
    opacity: number('opacity', 68, 20, 95), blur: number('blur', 24, 0, 60),
    tint: typeof stored.tint === 'string' && /^#[0-9a-f]{6}$/i.test(stored.tint) ? stored.tint : '#8b5cf6',
    tintStrength: number('tintStrength', 10, 0, 40),
  }
}

export function useSurfaceAppearance() {
  const [stored, save] = useLocalStorage('rumahl-surface-appearance', DEFAULT_SURFACE_APPEARANCE)
  const settings = normalizeSurfaceAppearance(stored)
  const { accentSurfaces, style, opacity, blur, tint, tintStrength } = settings
  useEffect(() => {
    const root = document.documentElement
    root.dataset.surfaceStyle = style
    root.dataset.accentSurfaces = String(accentSurfaces)
    root.style.setProperty('--user-glass-opacity', `${opacity}%`)
    root.style.setProperty('--user-glass-blur', `${blur}px`)
    root.style.setProperty('--user-glass-tint', tint)
    root.style.setProperty('--user-glass-tint-strength', `${tintStrength}%`)
  }, [accentSurfaces, style, opacity, blur, tint, tintStrength])
  return { settings, save, reset: () => save(DEFAULT_SURFACE_APPEARANCE) }
}
