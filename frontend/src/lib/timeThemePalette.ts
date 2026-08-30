import { storage } from '@/lib/storage'

export type TimeThemeId = 'day' | 'evening' | 'night'
export interface TimeThemeColors { background: string; accent: string }
export type TimeThemePalette = Record<TimeThemeId, TimeThemeColors>

export const DEFAULT_TIME_THEME_PALETTE: TimeThemePalette = {
  day: { background: '#eef1f5', accent: '#5577ee' },
  evening: { background: '#1d1b2c', accent: '#9b83f5' },
  night: { background: '#10131c', accent: '#45b7a9' },
}

const KEY = 'rumahl-time-theme-palette'
export function readTimeThemePalette(): TimeThemePalette {
  const stored = storage.get<Partial<TimeThemePalette>>(KEY)
  return {
    day: { ...DEFAULT_TIME_THEME_PALETTE.day, ...stored?.day },
    evening: { ...DEFAULT_TIME_THEME_PALETTE.evening, ...stored?.evening },
    night: { ...DEFAULT_TIME_THEME_PALETTE.night, ...stored?.night },
  }
}
export function writeTimeThemePalette(palette: TimeThemePalette) {
  storage.set(KEY, palette)
  window.dispatchEvent(new CustomEvent('rumahl:time-theme-palette-change'))
}
