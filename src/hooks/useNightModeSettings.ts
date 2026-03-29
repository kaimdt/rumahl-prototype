import { useState, useEffect, useCallback, useMemo } from 'react'

interface NightModeSettings {
  blueLightReduction: number // 0-100 percentage
  autoBrightness: boolean
  nightFilterEnabled: boolean
  overlayStrength: number
}

const DEFAULT_SETTINGS: NightModeSettings = {
  blueLightReduction: 50,
  autoBrightness: true,
  nightFilterEnabled: true,
  overlayStrength: 35,
}

export function useNightModeSettings() {
  const [settings, setSettings] = useState<NightModeSettings>(() => {
    const stored = localStorage.getItem('night-mode-settings')
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS
  })

  useEffect(() => {
    localStorage.setItem('night-mode-settings', JSON.stringify(settings))
    applyNightModeSettings(settings)
  }, [settings])

  const setBlueLightReduction = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, blueLightReduction: value }))
  }, [])

  const setAutoBrightness = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, autoBrightness: enabled }))
  }, [])

  const setNightFilterEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, nightFilterEnabled: enabled }))
  }, [])

  const setOverlayStrength = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, overlayStrength: Math.max(0, Math.min(100, value)) }))
  }, [])

  return useMemo(() => ({
    blueLightReduction: settings.blueLightReduction,
    autoBrightness: settings.autoBrightness,
    nightFilterEnabled: settings.nightFilterEnabled,
    overlayStrength: settings.overlayStrength,
    setBlueLightReduction,
    setAutoBrightness,
    setNightFilterEnabled,
    setOverlayStrength,
  }), [settings.blueLightReduction, settings.autoBrightness, settings.nightFilterEnabled, settings.overlayStrength, setBlueLightReduction, setAutoBrightness, setNightFilterEnabled, setOverlayStrength])
}

function applyNightModeSettings(settings: NightModeSettings) {
  const { blueLightReduction, nightFilterEnabled } = settings

  if (!nightFilterEnabled) {
    // Identity values — filter property still applied but has no visual effect
    document.documentElement.style.setProperty('--night-filter-sepia', 'sepia(0)')
    document.documentElement.style.setProperty('--night-filter-saturate', 'saturate(1)')
    document.documentElement.style.setProperty('--night-filter-brightness', 'brightness(1)')
    return
  }

  // Calculate sepia and saturation based on blue light reduction percentage
  const sepiaValue = (blueLightReduction / 100) * 0.3 // Max 0.3
  const saturationValue = 1 - ((blueLightReduction / 100) * 0.2) // Min 0.8

  document.documentElement.style.setProperty(
    '--night-filter-sepia',
    `sepia(${sepiaValue})`
  )
  document.documentElement.style.setProperty(
    '--night-filter-saturate',
    `saturate(${saturationValue})`
  )

  // Brightness adjustment based on settings
  const brightnessValue = settings.autoBrightness
    ? 0.92 - ((blueLightReduction / 100) * 0.17) // Range: 0.92 to 0.75
    : 0.92

  document.documentElement.style.setProperty(
    '--night-filter-brightness',
    `brightness(${brightnessValue})`
  )
}
