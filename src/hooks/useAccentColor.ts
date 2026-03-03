import { useState, useEffect } from 'react'
import * as ColorThiefModule from 'colorthief'
import { useConfiguration } from '@/contexts/ConfigurationContext'

// Handle both default and named export
const ColorThief = (ColorThiefModule as any).default || ColorThiefModule

interface AccentColorSettings {
  mode: 'auto' | 'static'
  staticColor: string
}

const DEFAULT_ACCENT = '#3b82f6' // Default blue accent

export function useAccentColor() {
  const { background } = useConfiguration()
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT)
  const [settings, setSettings] = useState<AccentColorSettings>(() => {
    const stored = localStorage.getItem('accent-color-settings')
    return stored ? JSON.parse(stored) : { mode: 'auto', staticColor: DEFAULT_ACCENT }
  })

  useEffect(() => {
    localStorage.setItem('accent-color-settings', JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (settings.mode === 'static') {
      setAccentColor(settings.staticColor)
      updateCSSVariable(settings.staticColor)
      return
    }

    // Auto mode - extract from background
    if (!background || !background.is_active) {
      setAccentColor(DEFAULT_ACCENT)
      updateCSSVariable(DEFAULT_ACCENT)
      return
    }

    const config = typeof background.config === 'string'
      ? JSON.parse(background.config)
      : background.config

    if (background.background_type === 'static' && config.url) {
      extractColorFromImage(config.url)
    } else if (background.background_type === 'slideshow' && config.urls && config.urls.length > 0) {
      // Extract from first image in slideshow
      extractColorFromImage(config.urls[0])
    } else if (background.background_type === 'gradient' && config.colors && config.colors.length > 0) {
      // Use first gradient color
      const color = config.colors[0]
      setAccentColor(color)
      updateCSSVariable(color)
    } else {
      setAccentColor(DEFAULT_ACCENT)
      updateCSSVariable(DEFAULT_ACCENT)
    }
  }, [background, settings.mode, settings.staticColor])

  const extractColorFromImage = async (imageUrl: string) => {
    try {
      const colorThief = new ColorThief()
      const img = new Image()
      img.crossOrigin = 'Anonymous'

      img.onload = () => {
        try {
          const palette = colorThief.getPalette(img, 5)
          if (palette && palette.length > 0) {
            // Find the most vibrant color
            let mostVibrant = palette[0]
            let maxSaturation = 0

            palette.forEach((color) => {
              const [r, g, b] = color
              const saturation = calculateSaturation(r, g, b)
              if (saturation > maxSaturation) {
                maxSaturation = saturation
                mostVibrant = color
              }
            })

            const [r, g, b] = mostVibrant
            const hexColor = rgbToHex(r, g, b)
            setAccentColor(hexColor)
            updateCSSVariable(hexColor)
          }
        } catch (error) {
          console.error('Failed to extract color:', error)
          setAccentColor(DEFAULT_ACCENT)
          updateCSSVariable(DEFAULT_ACCENT)
        }
      }

      img.onerror = () => {
        console.error('Failed to load image for color extraction')
        setAccentColor(DEFAULT_ACCENT)
        updateCSSVariable(DEFAULT_ACCENT)
      }

      img.src = imageUrl
    } catch (error) {
      console.error('Failed to extract color from image:', error)
      setAccentColor(DEFAULT_ACCENT)
      updateCSSVariable(DEFAULT_ACCENT)
    }
  }

  const updateCSSVariable = (color: string) => {
    // The CSS already uses --accent as an oklch value
    // We need to convert hex to oklch for proper integration
    const rgb = hexToRgb(color)
    if (rgb) {
      const oklch = rgbToOklch(rgb.r, rgb.g, rgb.b)
      document.documentElement.style.setProperty('--accent', `oklch(${oklch.l} ${oklch.c} ${oklch.h})`)
      document.documentElement.style.setProperty('--ring', `oklch(${oklch.l} ${oklch.c} ${oklch.h})`)
    }
  }

  const setMode = (mode: 'auto' | 'static') => {
    setSettings(prev => ({ ...prev, mode }))
  }

  const setStaticColor = (color: string) => {
    setSettings(prev => ({ ...prev, staticColor: color }))
  }

  return {
    accentColor,
    mode: settings.mode,
    staticColor: settings.staticColor,
    setMode,
    setStaticColor,
  }
}

// Helper functions
function calculateSaturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  return max === 0 ? 0 : delta / max
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

// Convert RGB to OKLCH color space
function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  // Normalize RGB values to 0-1
  const rNorm = r / 255
  const gNorm = g / 255
  const bNorm = b / 255

  // Convert to linear RGB
  const rLinear = rgbToLinear(rNorm)
  const gLinear = rgbToLinear(gNorm)
  const bLinear = rgbToLinear(bNorm)

  // Convert to XYZ
  const x = 0.4124564 * rLinear + 0.3575761 * gLinear + 0.1804375 * bLinear
  const y = 0.2126729 * rLinear + 0.7151522 * gLinear + 0.0721750 * bLinear
  const z = 0.0193339 * rLinear + 0.1191920 * gLinear + 0.9503041 * bLinear

  // Convert to OKLab
  const l_ = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z)
  const m_ = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z)
  const s_ = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z)

  const l = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

  // Convert to LCH
  const c = Math.sqrt(a * a + b_ * b_)
  let h = Math.atan2(b_, a) * 180 / Math.PI
  if (h < 0) h += 360

  return {
    l: Math.round(l * 100) / 100,
    c: Math.round(c * 100) / 100,
    h: Math.round(h * 100) / 100
  }
}

function rgbToLinear(val: number): number {
  return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
}
