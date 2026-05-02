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

export interface ThemeCssResponse {
  theme_id: string
  css_variables: Record<string, string>
  additional_css?: string
  css_url?: string
  fonts: ThemeFont[]
  icon_font?: ThemeIconConfig
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
  /** The full theme CSS response (includes fonts, icon config, additional CSS) */
  themeResponse: ThemeCssResponse | null
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getThemeFromTime(): string {
  const hour = new Date().getHours()
  if (hour >= 6 && hour < 18) return 'day'
  if (hour >= 18 && hour < 21) return 'evening'
  return 'night'
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

/** Inject external CSS file URL */
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

/** Remove all injected theme styles/fonts */
function clearThemeInjections() {
  // Remove font container
  const fontContainer = document.getElementById(FONT_CONTAINER_ID)
  if (fontContainer) fontContainer.remove()

  // Remove style tag
  const styleTag = document.getElementById(STYLE_CONTAINER_ID)
  if (styleTag) styleTag.remove()

  // Remove icon font
  const iconFont = document.getElementById(ICON_FONT_ID)
  if (iconFont) iconFont.remove()

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

  // Resolve theme
  useEffect(() => {
    if (sleepMode) { setTheme('sleep'); return }
    if (selectedTheme !== 'auto') { setTheme(selectedTheme); return }
    if (!autoTheme) { setTheme('day'); return }

    const update = () => setTheme(getThemeFromTime())
    update()
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [sleepMode, autoTheme, selectedTheme])

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

      // Apply external CSS URL
      if (themeResponse.css_url) {
        injectCssUrl(themeResponse.css_url)
      } else {
        // Only remove if it's a LINK tag (CSS URL), not a STYLE tag
        const existing = document.getElementById(STYLE_CONTAINER_ID)
        if (existing && existing.tagName === 'LINK') existing.remove()
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
      injectedThemeRef.current = null
    }
  }, [themeResponse])

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

  const contextValue = useMemo(() => ({
    theme, sleepMode, setSleepMode,
    autoTheme, setAutoTheme,
    selectedTheme, setSelectedTheme,
    availableThemes, installedThemes, loading, refreshThemes,
    activeCssVariables, themeResponse,
  }), [
    theme, sleepMode, setSleepMode,
    autoTheme, setAutoTheme,
    selectedTheme, setSelectedTheme,
    availableThemes, installedThemes, loading, refreshThemes,
    activeCssVariables, themeResponse,
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
