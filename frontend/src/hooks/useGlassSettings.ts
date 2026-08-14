import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { storage } from '@/lib/storage'

interface GlassSettings {
  enabled: boolean
  blurIntensity: number // 0-60 in px
  /** Surface transparency multiplier (1 = theme default, <1 clearer, >1 more opaque). */
  transparency: number // 0.5-1.5
  cardRadius: number // 8-28 in px
  borderAlpha: number // 0-0.3
}

const DEFAULT_SETTINGS: GlassSettings = {
  enabled: true,
  blurIntensity: 40,
  transparency: 1,
  cardRadius: 12,
  borderAlpha: 0.12,
}

/** Glass surface variables whose fill alpha is scaled by the transparency
 *  setting. Each is a plain `oklch(L C H / A)` custom property. */
const SURFACE_VARIABLES = ['--ora-glass-bg', '--ora-glass-hover', '--glass-bg', '--glass-bg-end']

/**
 * Scales the alpha channel of a glass surface variable by a multiplier.
 * It first removes any previous inline override so the current theme's base
 * value is re-read (never double-scaling across theme changes), then writes
 * back the adjusted color.
 */
function scaleSurfaceAlpha(variable: string, multiplier: number) {
  const el = document.documentElement
  el.style.removeProperty(variable)
  // Multiplier 1 = theme default: keep the stylesheet rule (theme-relative,
  // re-evaluated live on theme switches). Writing an inline value here would
  // freeze the current theme's color and break the next theme switch.
  if (Math.abs(multiplier - 1) < 0.001) return

  const raw = getComputedStyle(el).getPropertyValue(variable).trim()
  if (!raw) return

  const clamp = (value: number) => Math.max(0.04, Math.min(0.98, value))

  if (/\/\s*[\d.]+\s*\)\s*$/.test(raw)) {
    const baseAlpha = parseFloat(raw.match(/\/\s*([\d.]+)\s*\)\s*$/)?.[1] || '1')
    const nextAlpha = clamp(baseAlpha * multiplier)
    el.style.setProperty(variable, raw.replace(/\/\s*[\d.]+\s*\)\s*$/, ` / ${nextAlpha.toFixed(3)})`))
  } else {
    // No explicit alpha channel → treat as opaque and append the scaled alpha.
    el.style.setProperty(variable, raw.replace(/\)\s*$/, ` / ${clamp(0.74 * multiplier).toFixed(3)})`))
  }
}

export function useGlassSettings() {
  const { theme } = useTheme()
  const [settings, setSettings] = useState<GlassSettings>(() => {
    const stored = storage.get<GlassSettings>('glass-settings', DEFAULT_SETTINGS)
    const valid = stored && typeof stored === 'object' && !Array.isArray(stored) && typeof (stored as GlassSettings).enabled === 'boolean'
    return valid ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS
  })

  useEffect(() => {
    storage.set('glass-settings', settings)
    // Defer to the next animation frame: theme-driven CSS variables (the
    // `data-theme` attribute / custom-theme vars are applied by ThemeProvider
    // effects in the same commit, which run AFTER this component's effects).
    // Reading computed styles earlier would pin the previous theme's colors
    // as inline overrides — e.g. a light `--ora-glass-bg` stuck in a dark
    // theme after the auto day→night switch (L 0.96 glass on a dark UI).
    const raf = requestAnimationFrame(() => applyGlassSettings(settings))
    return () => cancelAnimationFrame(raf)
  }, [settings, theme])

  // Re-read when the backend sync finishes (admin global defaults may have
  // been applied as fallback for keys the user hasn't customized).
  useEffect(() => {
    const onSynced = () => {
      const stored = storage.get<GlassSettings>('glass-settings', DEFAULT_SETTINGS)
      if (stored && typeof stored === 'object' && !Array.isArray(stored) && typeof (stored as GlassSettings).enabled === 'boolean') {
        setSettings({ ...DEFAULT_SETTINGS, ...stored })
      }
    }
    window.addEventListener('iora:settings-synced', onSynced)
    return () => window.removeEventListener('iora:settings-synced', onSynced)
  }, [])

  const setBlurIntensity = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, blurIntensity: value }))
  }, [])

  const setEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, enabled: value }))
  }, [])

  const setTransparency = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, transparency: value }))
  }, [])

  const setCardRadius = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, cardRadius: value }))
  }, [])

  const setBorderAlpha = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, borderAlpha: value }))
  }, [])

  return useMemo(() => ({
    enabled: settings.enabled,
    blurIntensity: settings.blurIntensity,
    transparency: settings.transparency,
    cardRadius: settings.cardRadius,
    borderAlpha: settings.borderAlpha,
    setEnabled,
    setBlurIntensity,
    setTransparency,
    setCardRadius,
    setBorderAlpha,
  }), [
    settings.enabled,
    settings.blurIntensity,
    settings.transparency,
    settings.cardRadius,
    settings.borderAlpha,
    setEnabled,
    setBlurIntensity,
    setTransparency,
    setCardRadius,
    setBorderAlpha,
  ])
}

function applyGlassSettings(settings: GlassSettings) {
  const { enabled, blurIntensity, transparency, cardRadius, borderAlpha } = settings

  document.documentElement.setAttribute('data-glass', enabled ? 'on' : 'off')

  const clampedBorderAlpha = Math.max(0, Math.min(0.3, borderAlpha))
  const radiusRem = `${Math.max(8, Math.min(28, cardRadius)) / 16}rem`
  document.documentElement.style.setProperty('--radius', radiusRem)
  document.documentElement.style.setProperty(
    '--glass-border-color',
    `oklch(from var(--foreground) l c h / ${clampedBorderAlpha})`
  )

  if (!enabled) {
    document.documentElement.style.setProperty('--glass-backdrop-blur', 'blur(0px)')
    document.documentElement.style.setProperty('--glass-header-blur', 'blur(0px)')
    document.documentElement.style.setProperty('--glass-toast-blur', 'blur(0px)')
    return
  }

  // Each variable must be a single complete CSS function to avoid
  // Lightning CSS stripping spaces between adjacent functions
  document.documentElement.style.setProperty(
    '--glass-backdrop-blur',
    `blur(${blurIntensity}px)`
  )
  // Scale header blur proportionally (default ratio: 30/40 = 0.75)
  const headerBlur = Math.round(blurIntensity * 0.75)
  document.documentElement.style.setProperty(
    '--glass-header-blur',
    `blur(${headerBlur}px)`
  )
  // Scale toast blur proportionally (default ratio: 20/40 = 0.5)
  const toastBlur = Math.round(blurIntensity * 0.5)
  document.documentElement.style.setProperty(
    '--glass-toast-blur',
    `blur(${toastBlur}px)`
  )

  // Surface transparency: scale the glass fill alpha (theme-relative).
  for (const variable of SURFACE_VARIABLES) {
    scaleSurfaceAlpha(variable, transparency)
  }
}
