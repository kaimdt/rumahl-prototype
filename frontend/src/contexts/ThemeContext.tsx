import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useLocalStorage } from '@/lib/storage'
import { authFetch } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import type { ThemeMode } from '@/lib/types'

// ─── Type definitions ──────────────────────────────────────────────

export interface ThemeFont {
  name: string
  family: string
  url: string
  weights?: string
  subsets?: string
  is_primary?: boolean
  is_heading?: boolean
  is_monospace?: boolean
}

export interface ThemeIconConfig {
  font_name: string
  font_url: string
  class_prefix: string
  icon_map: Record<string, string>
}

export interface ThemeDefinition {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  preview_image?: string
  parent_theme?: string
  css_variables: Record<string, string>
  fonts?: ThemeFont[]
  icon_font?: ThemeIconConfig
  additional_css?: string
  css_url?: string
  system: boolean
  order: number
}

export interface InstalledTheme {
  id: string
  name: string
  version: string
  developer: string
  description: string
  icon?: string
  preview_image?: string
  parent_theme?: string
  system: boolean
  enabled: boolean
  installed_at: string
  source: string
  css_variables?: string
  additional_css?: string
  css_url?: string
  fonts_json?: string
  icon_font_json?: string
}

// ─── Theme Capabilities Types ──────────────────────────────────

export interface ThemeDesignMode {
  id: string
  name: string
  icon?: string
  time_start?: string
  time_end?: string
  css_variables: Record<string, string>
}

export interface TimeRange {
  start: string
  end: string
}

export interface ThemeAutoBehavior {
  mode: 'time' | 'sun' | 'custom' | 'disabled'
  time_ranges: Record<string, TimeRange>
  default_mode?: string
}

export interface AccentPreset {
  name: string
  color: string
}

export interface ThemeAccentControl {
  mode: 'user' | 'force' | 'presets'
  forced_color?: string
  presets?: AccentPreset[]
}

export interface ThemeGlassControl {
  mode: 'user' | 'force_on' | 'force_off' | 'force_values'
  blur?: string
  opacity?: string
}

export interface ThemeSettingOption {
  label: string
  value: string
}

export interface ThemeSetting {
  id: string
  name: string
  description?: string
  setting_type: 'toggle' | 'select' | 'slider' | 'color' | 'text'
  default_value: unknown
  options?: ThemeSettingOption[]
  min?: number
  max?: number
  step?: number
  css_variable?: string
}

export interface ThemeCapabilities {
  design_modes?: ThemeDesignMode[]
  auto_behavior?: ThemeAutoBehavior
  accent_control?: ThemeAccentControl
  glass_control?: ThemeGlassControl
  custom_settings?: ThemeSetting[]
}

export interface ThemeCssResponse {
  theme_id: string
  source: string
  css_variables: Record<string, string>
  additional_css?: string
  css_url?: string
  /** File-based themes: CSS file URLs to load via <link> */
  css_urls: string[]
  /** File-based themes: JS file URLs to load via <script> */
  js_urls: string[]
  /** Base URL for theme assets */
  assets_base_url?: string
  fonts: ThemeFont[]
  icon_font?: ThemeIconConfig
  /** HTML template name → resolved URL */
  html_templates: Record<string, string>
  /** Theme capabilities */
  capabilities?: ThemeCapabilities
}

export type ThemeOption = ThemeMode | 'auto' | string

interface ThemeContextType {
  /** Current active theme ID (built-in or custom) */
  theme: string
  sleepMode: boolean
  setSleepMode: (enabled: boolean) => void
  autoTheme: boolean
  setAutoTheme: (enabled: boolean) => void
  selectedTheme: string
  setSelectedTheme: (theme: string) => void
  availableThemes: ThemeDefinition[]
  installedThemes: InstalledTheme[]
  loading: boolean
  refreshThemes: () => Promise<void>
  activeCssVariables: Record<string, string>
  /** The full theme CSS response (includes fonts, icon config, additional CSS, templates) */
  themeResponse: ThemeCssResponse | null
  /** HTML template URLs from the active theme (name → URL) */
  activeTemplates: Record<string, string>
  /** Theme capabilities: design modes, auto, accent, glass, settings */
  capabilities: ThemeCapabilities | null
  /** Custom design modes from the active theme */
  designModes: ThemeDesignMode[]
  /** Active design mode ID (from theme's custom modes, or built-in) */
  activeDesignMode: string
  /** Set active design mode (for themes with custom modes) */
  setActiveDesignMode: (modeId: string) => void
  /** Current custom settings values for the active theme */
  customSettings: Record<string, unknown>
  /** Update a custom setting value */
  updateCustomSetting: (key: string, value: unknown) => Promise<void>
  /** Whether accent color is controlled by theme */
  accentLocked: boolean
  /** Forced accent color (if theme locks it) */
  forcedAccent: string | null
  /** Whether glass effects are overridden by theme */
  glassLocked: boolean
  /** Forced glass effect values */
  forcedGlass: { blur?: string; opacity?: string } | null
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getThemeFromTime(): string {
  const hour = new Date().getHours()
  if (hour >= 6 && hour < 18) return 'day'
  if (hour >= 18 && hour < 21) return 'evening'
  return 'night'
}

/** Get the design mode for the current time based on theme capabilities */
function getDesignModeFromTime(modes: ThemeDesignMode[]): string | null {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  
  for (const mode of modes) {
    if (!mode.time_start || !mode.time_end) continue
    const [startH, startM] = mode.time_start.split(':').map(Number)
    const [endH, endM] = mode.time_end.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM
    
    // Handle overnight ranges (e.g., 22:00 - 06:00)
    if (endMinutes <= startMinutes) {
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
        return mode.id
      }
    } else {
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return mode.id
      }
    }
  }
  
  return null
}

const DEFAULT_BUILTIN_THEMES: ThemeDefinition[] = [
  { id: 'auto', name: 'Automatisch', version: '1.0.0', developer: 'IORA', description: 'Wechselt nach Tageszeit', icon: 'ArrowsClockwise', system: true, order: 0, css_variables: {} },
  { id: 'light', name: 'Hell', version: '1.0.0', developer: 'IORA', description: 'Maximale Helligkeit', icon: 'Sun', system: true, order: 5, css_variables: {} },
  { id: 'day', name: 'Tag', version: '1.0.0', developer: 'IORA', description: 'Helles Design', icon: 'CloudSun', system: true, order: 10, css_variables: {} },
  { id: 'day-classic', name: 'Klassisch', version: '1.0.0', developer: 'IORA', description: 'Dunkler Hintergrund', icon: 'Monitor', system: true, order: 20, css_variables: {} },
  { id: 'evening', name: 'Abend', version: '1.0.0', developer: 'IORA', description: 'Warme Töne', icon: 'SunDim', system: true, order: 30, css_variables: {} },
  { id: 'night', name: 'Nacht', version: '1.0.0', developer: 'IORA', description: 'Dunkles Design', icon: 'MoonStars', system: true, order: 40, css_variables: {} },
  { id: 'sleep', name: 'Schlaf', version: '1.0.0', developer: 'IORA', description: 'OLED Schwarz', icon: 'Moon', system: true, order: 50, css_variables: {} },
]

function getThemePreview(themeId: string): string {
  const previews: Record<string, string> = {
    auto: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)',
    light: 'linear-gradient(135deg, #f5f5f7 0%, #e8eaf0 50%, #dde0e8 100%)',
    day: 'linear-gradient(135deg, #e0e4ec 0%, #c8cdd8 50%, #b8bfcc 100%)',
    'day-classic': 'linear-gradient(135deg, #2a2d3e 0%, #1a1d2e 50%, #0f1118 100%)',
    evening: 'linear-gradient(135deg, #2d2f4a 0%, #1e2040 50%, #15172e 100%)',
    night: 'linear-gradient(135deg, #181c2e 0%, #0f1220 50%, #0a0d18 100%)',
    sleep: 'linear-gradient(135deg, #050508 0%, #000000 100%)',
  }
  return previews[themeId] || 'linear-gradient(135deg, #1a1d2e 0%, #0f1220 100%)'
}

// ─── Font & Style injection helpers ─────────────────────────────────

/** IDs used for injected elements so we can clean them up on theme switch */
const FONT_CONTAINER_ID = 'iora-theme-fonts'
const STYLE_CONTAINER_ID = 'iora-theme-css'
const ICON_FONT_ID = 'iora-theme-icon-font'
const JS_CONTAINER_ID = 'iora-theme-js'
const CSS_FILES_PREFIX = 'iora-theme-css-file-'

/** Inject <link> tags for custom fonts into <head> */
function injectFonts(fonts: ThemeFont[]) {
  let container = document.getElementById(FONT_CONTAINER_ID)
  if (!container) {
    container = document.createElement('span')
    container.id = FONT_CONTAINER_ID
    container.style.display = 'none'
    document.head.appendChild(container)
  }
  // Clear previous fonts
  container.innerHTML = ''

  fonts.forEach(font => {
    let href = font.url
    // If it's a Google Fonts URL, append weights & subsets
    if (href.includes('fonts.googleapis.com') && font.weights) {
      const separator = href.includes('?') ? '&' : '?'
      href += `${separator}weight=${font.weights}`
      if (font.subsets) {
        href += `&subset=${font.subsets}`
      }
    }
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    container.appendChild(link)
  })

  // If a primary font is set, apply it to body
  const primaryFont = fonts.find(f => f.is_primary)
  if (primaryFont) {
    document.body.style.fontFamily = primaryFont.family
  } else {
    document.body.style.fontFamily = ''
  }

  // If a heading font is set, apply via CSS variable
  const headingFont = fonts.find(f => f.is_heading)
  if (headingFont) {
    document.documentElement.style.setProperty('--font-heading', headingFont.family)
  } else {
    document.documentElement.style.removeProperty('--font-heading')
  }

  // Monospace font
  const monoFont = fonts.find(f => f.is_monospace)
  if (monoFont) {
    document.documentElement.style.setProperty('--font-mono', monoFont.family)
  } else {
    document.documentElement.style.removeProperty('--font-mono')
  }
}

/** Inject a <style> tag for custom CSS */
function injectCustomCss(css: string) {
  let style = document.getElementById(STYLE_CONTAINER_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_CONTAINER_ID
    document.head.appendChild(style)
  }
  style.textContent = css
}

/** Inject external CSS file URL (single file, legacy) */
function injectCssUrl(url: string) {
  let link = document.getElementById(STYLE_CONTAINER_ID) as HTMLLinkElement | null
  if (!link || link.tagName !== 'LINK') {
    // Remove existing style tag if present
    const existing = document.getElementById(STYLE_CONTAINER_ID)
    if (existing) existing.remove()
    link = document.createElement('link')
    link.id = STYLE_CONTAINER_ID
    link.rel = 'stylesheet'
    link.href = url
    document.head.appendChild(link)
  } else {
    link.href = url
  }
}

/** Inject multiple CSS file URLs as <link> tags */
function injectCssFiles(urls: string[]) {
  urls.forEach((url, index) => {
    const id = `${CSS_FILES_PREFIX}${index}`
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = url
      document.head.appendChild(link)
    } else {
      link.href = url
    }
  })
}

/** Inject JavaScript files as <script> tags */
function injectJsFiles(urls: string[]) {
  // Create container for tracking
  let container = document.getElementById(JS_CONTAINER_ID)
  if (!container) {
    container = document.createElement('span')
    container.id = JS_CONTAINER_ID
    container.style.display = 'none'
    document.head.appendChild(container)
  }

  urls.forEach((url, index) => {
    const scriptId = `iora-theme-js-${index}`
    // Remove previous script with same ID
    const existing = document.getElementById(scriptId)
    if (existing) existing.remove()

    const script = document.createElement('script')
    script.id = scriptId
    script.src = url
    script.async = false  // Load in order
    script.onerror = () => console.warn(`[ThemeContext] Failed to load theme JS: ${url}`)
    document.head.appendChild(script)
  })
}

/** Inject icon font stylesheet */
function injectIconFont(config: ThemeIconConfig) {
  let link = document.getElementById(ICON_FONT_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = ICON_FONT_ID
    link.rel = 'stylesheet'
    link.href = config.font_url
    document.head.appendChild(link)
  } else {
    link.href = config.font_url
  }

  // Store icon map on document for runtime use
  ;(window as any).__iora_icon_map = config.icon_map
  ;(window as any).__iora_icon_prefix = config.class_prefix
}

/** Remove all injected theme styles/fonts/scripts */
function clearThemeInjections() {
  // Remove font container
  const fontContainer = document.getElementById(FONT_CONTAINER_ID)
  if (fontContainer) fontContainer.remove()

  // Remove style tag (inline additional_css)
  const styleTag = document.getElementById(STYLE_CONTAINER_ID)
  if (styleTag) styleTag.remove()

  // Remove all CSS file <link> tags
  document.querySelectorAll(`link[id^="${CSS_FILES_PREFIX}"]`).forEach(el => el.remove())

  // Remove icon font
  const iconFont = document.getElementById(ICON_FONT_ID)
  if (iconFont) iconFont.remove()

  // Remove all JS scripts
  const jsContainer = document.getElementById(JS_CONTAINER_ID)
  if (jsContainer) jsContainer.remove()
  document.querySelectorAll(`script[id^="iora-theme-js-"]`).forEach(el => el.remove())

  // Reset body font
  document.body.style.fontFamily = ''

  // Reset heading/mono fonts
  document.documentElement.style.removeProperty('--font-heading')
  document.documentElement.style.removeProperty('--font-mono')

  // Clear icon map
  delete (window as any).__iora_icon_map
  delete (window as any).__iora_icon_prefix
}

// ─── Theme Provider ─────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [sleepMode, setSleepMode] = useLocalStorage<boolean>('ha-sleep-mode', false)
  const [autoTheme, setAutoTheme] = useLocalStorage<boolean>('ha-auto-theme', true)
  const [selectedTheme, setSelectedThemeState] = useLocalStorage<string>('ha-selected-theme', 'auto')
  const [theme, setTheme] = useState<string>(() => {
    if (sleepMode) return 'sleep'
    if (selectedTheme !== 'auto') return selectedTheme
    return getThemeFromTime()
  })
  const [availableThemes, setAvailableThemes] = useState<ThemeDefinition[]>(DEFAULT_BUILTIN_THEMES)
  const [installedThemes, setInstalledThemes] = useState<InstalledTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [activeCssVariables, setActiveCssVariables] = useState<Record<string, string>>({})
  const [themeResponse, setThemeResponse] = useState<ThemeCssResponse | null>(null)

  // Theme capabilities
  const [capabilities, setCapabilities] = useState<ThemeCapabilities | null>(null)
  const [activeDesignMode, setActiveDesignModeState] = useState<string>('default')
  const [customSettings, setCustomSettings] = useState<Record<string, unknown>>({})

  // Track which theme's resources are currently injected
  const injectedThemeRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ha-auth-user')
      if (stored) {
        const user = JSON.parse(stored)
        setProfileId(user.id || user.sub || null)
      }
    } catch {}
  }, [])

  const refreshThemes = useCallback(async () => {
    try {
      const res = await authFetch('/api/themes')
      if (res.ok) {
        const data = await res.json()
        const builtin: ThemeDefinition[] = (data.builtin || []).map((t: ThemeDefinition) => ({
          ...t,
          system: true,
        }))
        const autoThemeDef: ThemeDefinition = {
          id: 'auto', name: 'Automatisch', version: '1.0.0',
          developer: 'IORA', description: 'Wechselt nach Tageszeit',
          icon: 'ArrowsClockwise', system: true, order: 0, css_variables: {},
        }
        setAvailableThemes([autoThemeDef, ...builtin, ...(data.installed || [])])
        setInstalledThemes(data.installed || [])
      }
    } catch (e) {
      console.warn('Failed to fetch themes, using defaults:', e)
      setAvailableThemes(DEFAULT_BUILTIN_THEMES)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refreshThemes() }, [refreshThemes])

  /** Fetch the full theme data (CSS vars, fonts, icons, custom CSS) */
  const fetchThemeData = useCallback(async (pid: string) => {
    try {
      const res = await authFetch(`/api/themes/css/${pid}`)
      if (res.ok) {
        const data: ThemeCssResponse = await res.json()
        setThemeResponse(data)
        if (data.theme_id !== 'auto') {
          setActiveCssVariables(data.css_variables)
        } else {
          setActiveCssVariables({})
        }
      }
    } catch {
      setThemeResponse(null)
      setActiveCssVariables({})
    }
  }, [])

  // Resolve theme + design mode
  useEffect(() => {
    if (sleepMode) { setTheme('sleep'); setActiveDesignModeState('default'); return }
    if (selectedTheme !== 'auto') { setTheme(selectedTheme); return }
    if (!autoTheme) { setTheme('day'); setActiveDesignModeState('default'); return }

    const update = () => {
      const timeTheme = getThemeFromTime()
      setTheme(timeTheme)
      
      // If the theme has custom design modes, pick the right one for current time
      if (capabilities?.design_modes && capabilities.design_modes.length > 0) {
        const modeFromTime = getDesignModeFromTime(capabilities.design_modes)
        if (modeFromTime) {
          setActiveDesignModeState(modeFromTime)
          const mode = capabilities.design_modes.find(m => m.id === modeFromTime)
          if (mode) {
            Object.entries(mode.css_variables).forEach(([key, value]) => {
              document.documentElement.style.setProperty(`--${key}`, value)
            })
          }
        } else if (capabilities.auto_behavior?.default_mode) {
          setActiveDesignModeState(capabilities.auto_behavior.default_mode)
        }
      }
    }
    update()
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [sleepMode, autoTheme, selectedTheme, capabilities])

  // Fetch theme data when theme changes
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)

    const isBuiltin = ['day', 'day-classic', 'light', 'evening', 'night', 'sleep', 'auto'].includes(theme)

    if (!isBuiltin && profileId) {
      fetchThemeData(profileId)
    } else {
      setThemeResponse(null)
      setActiveCssVariables({})
    }
  }, [theme, profileId, fetchThemeData])

  // Apply CSS variables + fonts + icons + custom CSS when themeResponse changes
  useEffect(() => {
    const root = document.documentElement

    // Clear previous custom theme variables
    const customVars = root.getAttribute('data-custom-theme-vars')
    if (customVars) {
      const prevVars = JSON.parse(customVars)
      Object.keys(prevVars).forEach(key => {
        root.style.removeProperty(`--${key}`)
      })
      root.removeAttribute('data-custom-theme-vars')
    }

    // If switching themes, clean up injected resources
    if (themeResponse) {
      // Apply CSS variables
      if (Object.keys(themeResponse.css_variables).length > 0) {
        Object.entries(themeResponse.css_variables).forEach(([key, value]) => {
          root.style.setProperty(`--${key}`, value)
        })
        root.setAttribute('data-custom-theme-vars', JSON.stringify(Object.keys(themeResponse.css_variables)))
      }

      // Set layout attributes for CSS-driven layout changes
      // Themes can set --layout-nav-position, --layout-nav-width, etc.
      const navPosition = themeResponse.css_variables['layout-nav-position']
      if (navPosition) {
        root.setAttribute('data-nav-position', navPosition)
      } else {
        root.removeAttribute('data-nav-position')
      }
      const headerStyle = themeResponse.css_variables['layout-header-style']
      if (headerStyle) {
        root.setAttribute('data-header-style', headerStyle)
      } else {
        root.removeAttribute('data-header-style')
      }

      // Apply custom fonts
      if (themeResponse.fonts && themeResponse.fonts.length > 0) {
        injectFonts(themeResponse.fonts)
      } else {
        // Clear fonts if theme doesn't specify any
        const fc = document.getElementById(FONT_CONTAINER_ID)
        if (fc) fc.remove()
        document.body.style.fontFamily = ''
        root.style.removeProperty('--font-heading')
        root.style.removeProperty('--font-mono')
      }

      // Apply additional CSS
      if (themeResponse.additional_css) {
        injectCustomCss(themeResponse.additional_css)
      } else {
        const st = document.getElementById(STYLE_CONTAINER_ID)
        if (st && st.tagName === 'STYLE') st.remove()
      }

      // Apply CSS files (primary: css_urls array from backend)
      if (themeResponse.css_urls && themeResponse.css_urls.length > 0) {
        injectCssFiles(themeResponse.css_urls)
      } else if (themeResponse.css_url) {
        // Legacy single CSS URL fallback
        injectCssUrl(themeResponse.css_url)
      } else {
        // Remove all injected CSS files
        document.querySelectorAll(`link[id^="${CSS_FILES_PREFIX}"]`).forEach(el => el.remove())
        const existing = document.getElementById(STYLE_CONTAINER_ID)
        if (existing && existing.tagName === 'LINK') existing.remove()
      }

      // Apply JavaScript files (theme interactivity)
      if (themeResponse.js_urls && themeResponse.js_urls.length > 0) {
        injectJsFiles(themeResponse.js_urls)
      }

      // Apply icon font
      if (themeResponse.icon_font) {
        injectIconFont(themeResponse.icon_font)
      } else {
        const iconLink = document.getElementById(ICON_FONT_ID)
        if (iconLink) iconLink.remove()
        delete (window as any).__iora_icon_map
        delete (window as any).__iora_icon_prefix
      }

      injectedThemeRef.current = themeResponse.theme_id
    } else {
      // No theme response = built-in theme, clean everything
      clearThemeInjections()
      // Remove layout attributes
      root.removeAttribute('data-nav-position')
      root.removeAttribute('data-header-style')
      injectedThemeRef.current = null
    }
  }, [themeResponse])

  // ─── Capabilities & Custom Settings ────────────────────────────
  useEffect(() => {
    const caps = themeResponse?.capabilities || null
    setCapabilities(caps)

    // Reset design mode when theme changes
    if (caps?.design_modes && caps.design_modes.length > 0) {
      const firstMode = caps.design_modes[0].id
      setActiveDesignModeState(firstMode)
      // Apply mode-specific CSS variables
      const mode = caps.design_modes.find(m => m.id === firstMode)
      if (mode) {
        Object.entries(mode.css_variables).forEach(([key, value]) => {
          document.documentElement.style.setProperty(`--${key}`, value)
        })
      }
    } else {
      setActiveDesignModeState('default')
    }

    // Apply accent override
    if (caps?.accent_control) {
      if (caps.accent_control.mode === 'force' && caps.accent_control.forced_color) {
        document.documentElement.style.setProperty('--accent', caps.accent_control.forced_color)
        document.documentElement.setAttribute('data-accent-locked', 'true')
      } else {
        document.documentElement.removeAttribute('data-accent-locked')
      }
    } else {
      document.documentElement.removeAttribute('data-accent-locked')
    }

    // Apply glass override
    if (caps?.glass_control) {
      const gc = caps.glass_control
      if (gc.mode === 'force_off') {
        document.documentElement.setAttribute('data-glass', 'off')
        document.documentElement.setAttribute('data-glass-locked', 'true')
      } else if (gc.mode === 'force_on') {
        document.documentElement.removeAttribute('data-glass')
        document.documentElement.setAttribute('data-glass-locked', 'true')
      } else if (gc.mode === 'force_values') {
        if (gc.blur) document.documentElement.style.setProperty('--glass-blur', gc.blur)
        if (gc.opacity) document.documentElement.style.setProperty('--glass-opacity', gc.opacity)
        document.documentElement.removeAttribute('data-glass')
        document.documentElement.setAttribute('data-glass-locked', 'true')
      } else {
        document.documentElement.removeAttribute('data-glass-locked')
      }
    } else {
      document.documentElement.removeAttribute('data-glass-locked')
    }

    // Load custom settings from API
    if (profileId && themeResponse?.theme_id && themeResponse.theme_id !== 'auto') {
      authFetch(`/api/themes/user/${profileId}/settings/${themeResponse.theme_id}`)
        .then(r => r.ok ? r.json() : null)
        .then((data: { settings?: Record<string, unknown> } | null) => {
          if (data?.settings) {
            setCustomSettings(data.settings)
            // Apply CSS variable bindings
            caps?.custom_settings?.forEach(setting => {
              if (setting.css_variable && data.settings?.[setting.id] !== undefined) {
                const value = String(data.settings[setting.id])
                document.documentElement.style.setProperty(`--${setting.css_variable}`, value)
              }
            })
          } else {
            // Use defaults
            const defaults: Record<string, unknown> = {}
            caps?.custom_settings?.forEach(s => {
              defaults[s.id] = s.default_value
              if (s.css_variable) {
                document.documentElement.style.setProperty(`--${s.css_variable}`, String(s.default_value))
              }
            })
            setCustomSettings(defaults)
          }
        })
        .catch(() => {
          // Use defaults on error
          const defaults: Record<string, unknown> = {}
          caps?.custom_settings?.forEach(s => {
            defaults[s.id] = s.default_value
          })
          setCustomSettings(defaults)
        })
    } else {
      setCustomSettings({})
    }
  }, [themeResponse?.theme_id, themeResponse?.capabilities, profileId])

  // Update custom setting
  const updateCustomSetting = useCallback(async (key: string, value: unknown) => {
    const tid = themeResponse?.theme_id
    if (!profileId || !tid || tid === 'auto') return

    const newSettings = { ...customSettings, [key]: value }
    setCustomSettings(newSettings)

    // Apply CSS variable binding immediately
    const setting = capabilities?.custom_settings?.find(s => s.id === key)
    if (setting?.css_variable) {
      document.documentElement.style.setProperty(`--${setting.css_variable}`, String(value))
    }

    // Save to backend
    try {
      await authFetch(`/api/themes/user/${profileId}/settings/${tid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [key]: value } }),
      })
    } catch (e) {
      console.warn('Failed to save theme setting:', e)
    }
  }, [profileId, themeResponse?.theme_id, customSettings, capabilities])

  // Set active design mode (for themes with custom modes)
  const setActiveDesignMode = useCallback((modeId: string) => {
    setActiveDesignModeState(modeId)
    const mode = capabilities?.design_modes?.find(m => m.id === modeId)
    if (mode) {
      Object.entries(mode.css_variables).forEach(([key, value]) => {
        document.documentElement.style.setProperty(`--${key}`, value)
      })
    }
  }, [capabilities])

  // Computed accent/glass lock states
  const accentLocked = capabilities?.accent_control?.mode === 'force'
  const forcedAccent = accentLocked ? (capabilities?.accent_control?.forced_color || null) : null
  const glassLocked = capabilities?.glass_control?.mode !== 'user'
  const forcedGlass = capabilities?.glass_control?.mode === 'force_values'
    ? { blur: capabilities.glass_control.blur, opacity: capabilities.glass_control.opacity }
    : null

  const setSelectedTheme = useCallback(async (themeId: string) => {
    setSelectedThemeState(themeId)
    if (profileId) {
      try {
        await authFetch(`/api/themes/user/${profileId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme_id: themeId,
            auto_theme: themeId === 'auto',
            overrides: {},
          }),
        })
      } catch (e) {
        console.warn('Failed to save theme selection:', e)
      }
    }
  }, [profileId, setSelectedThemeState])

  const activeTemplates = useMemo(() => {
    return themeResponse?.html_templates || {}
  }, [themeResponse?.html_templates])

  const designModes = useMemo(() => {
    return capabilities?.design_modes || []
  }, [capabilities])

  const contextValue = useMemo(() => ({
    theme, sleepMode, setSleepMode,
    autoTheme, setAutoTheme,
    selectedTheme, setSelectedTheme,
    availableThemes, installedThemes, loading, refreshThemes,
    activeCssVariables, themeResponse,
    activeTemplates,
    capabilities, designModes,
    activeDesignMode, setActiveDesignMode,
    customSettings, updateCustomSetting,
    accentLocked, forcedAccent,
    glassLocked, forcedGlass,
  }), [
    theme, sleepMode, setSleepMode,
    autoTheme, setAutoTheme,
    selectedTheme, setSelectedTheme,
    availableThemes, installedThemes, loading, refreshThemes,
    activeCssVariables, themeResponse,
    activeTemplates,
    capabilities, designModes,
    activeDesignMode, setActiveDesignMode,
    customSettings, updateCustomSetting,
    accentLocked, forcedAccent,
    glassLocked, forcedGlass,
  ])

  return (
    <ThemeContext.Provider value={contextValue}>
      <div className="theme-transition min-h-screen bg-background text-foreground">
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
