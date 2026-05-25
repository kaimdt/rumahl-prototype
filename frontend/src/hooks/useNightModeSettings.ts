import { useState, useEffect, useCallback, useMemo, useRef } from 'react'

/**
 * NightMode v2 — unified blue-light, warmth and dimming system.
 *
 * Persisted key: `night-mode-settings` (backward-compatible — extra fields
 * are merged from defaults if missing in stored payload).
 *
 * Activation rules:
 *   - `nightFilterEnabled = false`        → never active
 *   - `scheduleEnabled = true`            → active only inside [startTime, endTime]
 *                                           (wraps around midnight)
 *   - `scheduleEnabled = false`           → manual: active whenever `nightFilterEnabled`
 *
 * When active the hook:
 *   - sets `body[data-night-active="true"]`
 *   - writes CSS vars `--night-filter-sepia/saturate/brightness/hue`
 *   - exposes `--night-overlay-color` + `--night-overlay-opacity` for the
 *     App-level overlay
 *
 * `applyAlways = false` (default) → the overlay/filter is opt-in from App
 * code via `body[data-night-scope]`. With `applyAlways = true` the overlay
 * applies regardless of theme — useful for users who want a warm screen at
 * night even on a light theme.
 */

interface NightModeSettings {
  nightFilterEnabled: boolean
  /** blue light reduction 0–100 (drives sepia + saturation desaturation) */
  blueLightReduction: number
  autoBrightness: boolean
  /** strength of the warm color overlay 0–100 */
  overlayStrength: number
  /** color temperature in Kelvin, lower = warmer (1500–6500, neutral 6500) */
  colorTemperature: number
  /** schedule activation between startTime…endTime (HH:MM) */
  scheduleEnabled: boolean
  startTime: string
  endTime: string
  /** apply filter regardless of current theme */
  applyAlways: boolean
}

const DEFAULT_SETTINGS: NightModeSettings = {
  nightFilterEnabled: true,
  blueLightReduction: 50,
  autoBrightness: true,
  overlayStrength: 35,
  colorTemperature: 3400,
  scheduleEnabled: false,
  startTime: '21:00',
  endTime: '07:00',
  applyAlways: false,
}

const STORAGE_KEY = 'night-mode-settings'

// ─── Helpers ────────────────────────────────────────────────────────────

function parseHHMM(value: string): number {
  const [hRaw, mRaw] = value.split(':')
  const h = Number(hRaw)
  const m = Number(mRaw)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m))
}

function isWithinSchedule(start: string, end: string, now = new Date()): boolean {
  const s = parseHHMM(start)
  const e = parseHHMM(end)
  const t = now.getHours() * 60 + now.getMinutes()
  if (s === e) return false
  return s < e ? t >= s && t < e : t >= s || t < e // wraps midnight
}

/**
 * Convert a color temperature in Kelvin to an approximate sRGB color
 * (Tanner Helland approximation, clamped to our warm range).
 */
function kelvinToRgb(kelvin: number): { r: number; g: number; b: number } {
  const k = Math.max(1000, Math.min(10000, kelvin)) / 100
  let r: number
  let g: number
  let b: number

  if (k <= 66) r = 255
  else r = 329.698727446 * Math.pow(k - 60, -0.1332047592)

  if (k <= 66) g = 99.4708025861 * Math.log(k) - 161.1195681661
  else g = 288.1221695283 * Math.pow(k - 60, -0.0755148492)

  if (k >= 66) b = 255
  else if (k <= 19) b = 0
  else b = 138.5177312231 * Math.log(k - 10) - 305.0447927307

  return {
    r: Math.round(Math.max(0, Math.min(255, r))),
    g: Math.round(Math.max(0, Math.min(255, g))),
    b: Math.round(Math.max(0, Math.min(255, b))),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

// ─── Hook ──────────────────────────────────────────────────────────────

export function useNightModeSettings() {
  const [settings, setSettings] = useState<NightModeSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored
        ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
        : DEFAULT_SETTINGS
    } catch (err) {
      console.warn('useNightModeSettings: failed to parse stored settings, using defaults', err)
      return DEFAULT_SETTINGS
    }
  })

  // Tick once a minute so consumers re-render at the schedule boundary even
  // if the settings object hasn't changed.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!settings.scheduleEnabled || !settings.nightFilterEnabled) return
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [settings.scheduleEnabled, settings.nightFilterEnabled])

  const isScheduleActive = useMemo(() => {
    if (!settings.scheduleEnabled) return true
    return isWithinSchedule(settings.startTime, settings.endTime, new Date(now))
  }, [settings.scheduleEnabled, settings.startTime, settings.endTime, now])

  const isActive = settings.nightFilterEnabled && isScheduleActive

  const prevActiveRef = useRef<boolean | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (err) {
      console.warn('useNightModeSettings: failed to persist settings', err)
    }
    applyNightModeCss(settings, isActive)
    prevActiveRef.current = isActive
  }, [settings, isActive])

  // ─── Setters ──────────────────────────────────────────────────────────
  const setBlueLightReduction = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, blueLightReduction: clamp(value, 0, 100) }))
  }, [])
  const setAutoBrightness = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, autoBrightness: enabled }))
  }, [])
  const setNightFilterEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, nightFilterEnabled: enabled }))
  }, [])
  const setOverlayStrength = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, overlayStrength: clamp(value, 0, 100) }))
  }, [])
  const setColorTemperature = useCallback((value: number) => {
    setSettings(prev => ({ ...prev, colorTemperature: clamp(value, 1500, 6500) }))
  }, [])
  const setScheduleEnabled = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, scheduleEnabled: enabled }))
  }, [])
  const setStartTime = useCallback((value: string) => {
    setSettings(prev => ({ ...prev, startTime: value }))
  }, [])
  const setEndTime = useCallback((value: string) => {
    setSettings(prev => ({ ...prev, endTime: value }))
  }, [])
  const setApplyAlways = useCallback((enabled: boolean) => {
    setSettings(prev => ({ ...prev, applyAlways: enabled }))
  }, [])

  return useMemo(() => ({
    // raw values
    nightFilterEnabled: settings.nightFilterEnabled,
    blueLightReduction: settings.blueLightReduction,
    autoBrightness: settings.autoBrightness,
    overlayStrength: settings.overlayStrength,
    colorTemperature: settings.colorTemperature,
    scheduleEnabled: settings.scheduleEnabled,
    startTime: settings.startTime,
    endTime: settings.endTime,
    applyAlways: settings.applyAlways,
    // derived
    isActive,
    isScheduleActive,
    // setters
    setNightFilterEnabled,
    setBlueLightReduction,
    setAutoBrightness,
    setOverlayStrength,
    setColorTemperature,
    setScheduleEnabled,
    setStartTime,
    setEndTime,
    setApplyAlways,
  }), [
    settings,
    isActive,
    isScheduleActive,
    setNightFilterEnabled,
    setBlueLightReduction,
    setAutoBrightness,
    setOverlayStrength,
    setColorTemperature,
    setScheduleEnabled,
    setStartTime,
    setEndTime,
    setApplyAlways,
  ])
}

// ─── DOM application ────────────────────────────────────────────────────

function applyNightModeCss(settings: NightModeSettings, isActive: boolean) {
  const root = document.documentElement
  const body = document.body
  if (!root || !body) return

  // Warmth strength combines temperature distance from 6500 K and blue light slider.
  const tempBelow = Math.max(0, 6500 - settings.colorTemperature) // 0…5000
  const warmthFromTemp = Math.min(1, tempBelow / 5000)
  const warmthFromBlue = settings.blueLightReduction / 100
  const warmth = Math.max(warmthFromTemp, warmthFromBlue * 0.8)

  if (!isActive) {
    root.style.setProperty('--night-filter-sepia', 'sepia(0)')
    root.style.setProperty('--night-filter-saturate', 'saturate(1)')
    root.style.setProperty('--night-filter-brightness', 'brightness(1)')
    root.style.setProperty('--night-filter-hue', 'hue-rotate(0deg)')
    root.style.setProperty('--night-overlay-color', 'rgba(0,0,0,0)')
    root.style.setProperty('--night-overlay-opacity', '0')
    body.removeAttribute('data-night-active')
    body.removeAttribute('data-night-scope')
    return
  }

  const sepia = warmth * 0.35
  const saturate = 1 - warmth * 0.18
  const brightness = settings.autoBrightness ? 0.96 - warmth * 0.18 : 1
  const hue = -warmth * 6

  root.style.setProperty('--night-filter-sepia', `sepia(${sepia.toFixed(3)})`)
  root.style.setProperty('--night-filter-saturate', `saturate(${saturate.toFixed(3)})`)
  root.style.setProperty('--night-filter-brightness', `brightness(${brightness.toFixed(3)})`)
  root.style.setProperty('--night-filter-hue', `hue-rotate(${hue.toFixed(2)}deg)`)

  const { r, g, b } = kelvinToRgb(settings.colorTemperature)
  const overlayR = Math.round(r * 0.55)
  const overlayG = Math.round(g * 0.35)
  const overlayB = Math.round(b * 0.20)
  const overlayOpacity = (settings.overlayStrength / 100) * 0.55
  root.style.setProperty('--night-overlay-color', `rgba(${overlayR}, ${overlayG}, ${overlayB}, 1)`)
  root.style.setProperty('--night-overlay-opacity', overlayOpacity.toFixed(3))

  body.setAttribute('data-night-active', 'true')
  body.setAttribute('data-night-scope', settings.applyAlways ? 'global' : 'theme')
}
