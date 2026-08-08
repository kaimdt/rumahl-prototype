import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { getPalette } from 'colorthief'
import { useCurrentBackground } from '@/contexts/CurrentBackgroundContext'
import { useTheme } from '@/contexts/ThemeContext'

interface AccentColorSettings {
  mode: 'auto' | 'static'
  staticColor: string
}

const DEFAULT_ACCENT = '#3b82f6'

/** Theme-appropriate fallback accents (used when no image is available). */
const THEME_DEFAULT_ACCENTS: Record<string, string> = {
  day: '#3b82f6',
  light: '#2f7bf6',
  'day-classic': '#4f8ff7',
  evening: '#e0863d',
  night: '#5b8df5',
  sleep: '#6b8cff',
}

/** Max chroma per theme group — keeps accents rich but never neon-garish. */
function getMaxChroma(currentTheme: string): number {
  switch (currentTheme) {
    case 'day':
    case 'light':
      return 0.24
    case 'evening':
    case 'night':
    case 'sleep':
    case 'day-classic':
      return 0.30
    default:
      return 0.28
  }
}

export function useAccentColor() {
  const { currentImageUrl } = useCurrentBackground()
  const { theme } = useTheme()
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT)
  const [extractedPalette, setExtractedPalette] = useState<string[]>([])
  const [settings, setSettings] = useState<AccentColorSettings>(() => {
    try {
      const stored = localStorage.getItem('accent-color-settings')
      return stored ? JSON.parse(stored) : { mode: 'auto', staticColor: DEFAULT_ACCENT }
    } catch (err) {
      console.warn('useAccentColor: failed to parse stored settings, using defaults', err)
      return { mode: 'auto', staticColor: DEFAULT_ACCENT }
    }
  })

  // Counter to discard stale async extractions
  const extractionIdRef = useRef(0)
  // Track the last URL we extracted from to avoid duplicate work
  const lastExtractedUrlRef = useRef<string | null>(null)

  useEffect(() => {
    localStorage.setItem('accent-color-settings', JSON.stringify(settings))
  }, [settings])

  // Core effect: auto-extract accent when background image changes
  useEffect(() => {
    if (settings.mode === 'static') {
      updateCSSVariable(settings.staticColor, theme)
      setAccentColor(settings.staticColor)
      return
    }

    // Auto mode — nothing to do if no image: fall back to a theme-appropriate accent.
    if (!currentImageUrl) {
      const fallback = THEME_DEFAULT_ACCENTS[theme] || DEFAULT_ACCENT
      setAccentColor(fallback)
      setExtractedPalette([])
      updateCSSVariable(fallback, theme)
      return
    }

    // Gradient background: use the hex color directly
    if (currentImageUrl.startsWith('gradient:')) {
      const color = currentImageUrl.replace('gradient:', '')
      setAccentColor(color)
      setExtractedPalette([color])
      updateCSSVariable(color, theme)
      return
    }

    // Skip if we already extracted from this URL
    if (currentImageUrl === lastExtractedUrlRef.current) return

    // Increment extraction counter to invalidate any in-flight extractions
    const id = ++extractionIdRef.current
    lastExtractedUrlRef.current = currentImageUrl

    extractColorFromImage(currentImageUrl, id)
  }, [currentImageUrl, settings.mode, settings.staticColor, theme])

  const extractColorFromImage = async (imageUrl: string, requestId: number) => {
    try {
      const img = new Image()
      img.crossOrigin = 'Anonymous'

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Image load failed'))
        img.src = imageUrl
      })

      // Discard if a newer extraction has started
      if (requestId !== extractionIdRef.current) return

      const palette = await getPalette(img, { colorCount: 8 })
      if (!palette || palette.length === 0) {
        const fallback = THEME_DEFAULT_ACCENTS[theme] || DEFAULT_ACCENT
        setAccentColor(fallback)
        setExtractedPalette([])
        updateCSSVariable(fallback, theme)
        return
      }

      // Score colors by vibrancy + harmony: prefer saturated, mid-lightness
      // colors that sit comfortably within the theme's chroma budget.
      const maxChroma = getMaxChroma(theme)
      const paletteWithScore = palette.map((color) => {
        const { r, g, b } = color.rgb()
        const oklch = rgbToOklch(r, g, b)
        const lightnessPenalty = Math.abs(oklch.l - 0.52) * 1.6
        const grayPenalty = oklch.c < 0.08 ? (0.08 - oklch.c) * 6 : 0
        // Colors beyond the theme's chroma budget lose points instead of winning
        // by pure saturation — this keeps extracted accents harmonious.
        const chromaPenalty = oklch.c > maxChroma ? (oklch.c - maxChroma) * 3 : 0
        const score = oklch.c * 2.4 - lightnessPenalty - grayPenalty - chromaPenalty
        return { hex: color.hex(), score, oklch }
      })
      paletteWithScore.sort((a, b) => b.score - a.score)

      const allColors = paletteWithScore.map(c => c.hex)
      setExtractedPalette(allColors)
      const hexColor = allColors[0]
      setAccentColor(hexColor)
      updateCSSVariable(hexColor, theme)
    } catch (error) {
      // Discard stale errors
      if (requestId !== extractionIdRef.current) return
      console.warn('[AccentColor] Extraction failed:', error)
      const fallback = THEME_DEFAULT_ACCENTS[theme] || DEFAULT_ACCENT
      setAccentColor(fallback)
      setExtractedPalette([])
      updateCSSVariable(fallback, theme)
    }
  }

  const updateCSSVariable = (color: string, currentTheme: string) => {
    const rgb = hexToRgb(color)
    if (!rgb) return
    const oklch = rgbToOklch(rgb.r, rgb.g, rgb.b)

    let minLightness: number
    let maxLightness: number

    switch (currentTheme) {
      case 'sleep':
        minLightness = 0.40
        maxLightness = 0.72
        break
      case 'night':
      case 'evening':
      case 'day-classic':
        minLightness = 0.44
        maxLightness = 0.82
        break
      case 'day':
      case 'light':
        minLightness = 0.48
        maxLightness = 0.88
        break
      default:
        minLightness = 0.44
        maxLightness = 0.88
    }

    const maxChroma = getMaxChroma(currentTheme)
    const l = parseFloat(Math.max(minLightness, Math.min(maxLightness, oklch.l)).toFixed(2))
    const c = parseFloat(Math.max(0.10, Math.min(maxChroma, oklch.c)).toFixed(2))
    const h = parseFloat(oklch.h.toFixed(1))

    document.documentElement.style.setProperty('--accent', `oklch(${l} ${c} ${h})`)
    document.documentElement.style.setProperty('--ring', `oklch(${l} ${c} ${h})`)
    // rgb triplet used by rgba(var(--accent-rgb)) consumers (widget glows, neon styles)
    document.documentElement.style.setProperty('--accent-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`)
  }

  const setMode = useCallback((mode: 'auto' | 'static') => {
    setSettings(prev => ({ ...prev, mode }))
    // Clear the last extracted URL when switching to auto
    // so it re-extracts immediately
    if (mode === 'auto') {
      lastExtractedUrlRef.current = null
    }
  }, [])

  const setStaticColor = useCallback((color: string) => {
    setSettings(prev => ({ ...prev, staticColor: color }))
  }, [])

  /** Select a color from the palette. This switches to static mode
   *  because the user explicitly wants this color. Use resetToAuto()
   *  to go back to dynamic extraction. */
  const selectFromPalette = useCallback((color: string) => {
    setAccentColor(color)
    updateCSSVariable(color, theme)
    setSettings(prev => ({ ...prev, mode: 'static', staticColor: color }))
  }, [theme])

  /** Reset to full auto mode — accent will re-extract from current background */
  const resetToAuto = useCallback(() => {
    lastExtractedUrlRef.current = null
    setSettings(prev => ({ ...prev, mode: 'auto' }))
    // Force re-extraction by clearing the tracked URL
    if (currentImageUrl) {
      lastExtractedUrlRef.current = null
      const id = ++extractionIdRef.current
      if (currentImageUrl.startsWith('gradient:')) {
        const color = currentImageUrl.replace('gradient:', '')
        setAccentColor(color)
        setExtractedPalette([color])
        updateCSSVariable(color, theme)
      } else {
        extractColorFromImage(currentImageUrl, id)
      }
    }
  }, [currentImageUrl, theme])

  return useMemo(() => ({
    accentColor,
    extractedPalette,
    mode: settings.mode,
    staticColor: settings.staticColor,
    setMode,
    setStaticColor,
    selectFromPalette,
    resetToAuto,
  }), [accentColor, extractedPalette, settings.mode, settings.staticColor, setMode, setStaticColor, selectFromPalette, resetToAuto])
}

// --- Helpers ---

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null
}

function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255
  const rL = rgbToLinear(rNorm), gL = rgbToLinear(gNorm), bL = rgbToLinear(bNorm)

  const x = 0.4124564 * rL + 0.3575761 * gL + 0.1804375 * bL
  const y = 0.2126729 * rL + 0.7151522 * gL + 0.0721750 * bL
  const z = 0.0193339 * rL + 0.1191920 * gL + 0.9503041 * bL

  const l_ = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z)
  const m_ = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z)
  const s_ = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z)

  const l = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

  const c = Math.sqrt(a * a + bb * bb)
  let h = Math.atan2(bb, a) * 180 / Math.PI
  if (h < 0) h += 360

  return { l: Math.round(l * 100) / 100, c: Math.round(c * 100) / 100, h: Math.round(h * 100) / 100 }
}

function rgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
