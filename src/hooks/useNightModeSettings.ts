import { useState, useEffect } from 'react'

interface NightModeSettings {
  blueLightReduction: number // 0-100 percentage
  autoBrightness: boolean
}

const DEFAULT_SETTINGS: NightModeSettings = {
  blueLightReduction: 50,
  autoBrightness: true,
}

export function useNightModeSettings() {
  const [settings, setSettings] = useState<NightModeSettings>(() => {
    const stored = localStorage.getItem('night-mode-settings')
    return stored ? JSON.parse(stored) : DEFAULT_SETTINGS
  })

  useEffect(() => {
    localStorage.setItem('night-mode-settings', JSON.stringify(settings))
    applyNightModeSettings(settings)
  }, [settings])

  const setBlueLightReduction = (value: number) => {
    setSettings(prev => ({ ...prev, blueLightReduction: value }))
  }

  const setAutoBrightness = (enabled: boolean) => {
    setSettings(prev => ({ ...prev, autoBrightness: enabled }))
  }

  return {
    blueLightReduction: settings.blueLightReduction,
    autoBrightness: settings.autoBrightness,
    setBlueLightReduction,
    setAutoBrightness,
  }
}

function applyNightModeSettings(settings: NightModeSettings) {
  const { blueLightReduction } = settings

  // Calculate sepia and saturation based on blue light reduction percentage
  const sepiaValue = (blueLightReduction / 100) * 0.3 // Max 0.3
  const saturationValue = 1 - ((blueLightReduction / 100) * 0.2) // Min 0.8

  // Update CSS variables for night mode
  document.documentElement.style.setProperty(
    '--night-filter',
    `sepia(${sepiaValue}) saturate(${saturationValue})`
  )

  // Brightness adjustment based on settings
  const brightnessValue = settings.autoBrightness
    ? 0.92 - ((blueLightReduction / 100) * 0.17) // Range: 0.92 to 0.75
    : 0.92

  document.documentElement.style.setProperty(
    '--night-brightness',
    brightnessValue.toString()
  )
}
