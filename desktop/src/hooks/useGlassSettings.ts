import { useState, useEffect, useCallback, useMemo } from 'react'

interface GlassSettings {
  enabled: boolean
  blurIntensity: number // 0-60 in px
  cardRadius: number // 8-28 in px
  borderAlpha: number // 0-0.3
}

const DEFAULT_SETTINGS: GlassSettings = {
  enabled: true,
  blurIntensity: 40,
  cardRadius: 12,
  borderAlpha: 0.12,
}

export function useGlassSettings() {
  const [settings, setSettings] = useState<GlassSettings>(() => {
    const stored = localStorage.getItem('glass-settings')
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS
  })

  useEffect(() => {
    localStorage.setItem('glass-settings', JSON.stringify(settings))
    applyGlassSettings(settings)
  }, [settings])

  // Apply on mount
  useEffect(() => {
    applyGlassSettings(settings)
  }, [])

  const setBlurIntensity = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, blurIntensity: value }))
  }, [])

  const setEnabled = useCallback((value: boolean) => {
    setSettings(prev => ({ ...prev, enabled: value }))
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
    cardRadius: settings.cardRadius,
    borderAlpha: settings.borderAlpha,
    setEnabled,
    setBlurIntensity,
    setCardRadius,
    setBorderAlpha,
  }), [
    settings.enabled,
    settings.blurIntensity,
    settings.cardRadius,
    settings.borderAlpha,
    setEnabled,
    setBlurIntensity,
    setCardRadius,
    setBorderAlpha,
  ])
}

function applyGlassSettings(settings: GlassSettings) {
  const { enabled, blurIntensity, cardRadius, borderAlpha } = settings

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
}
