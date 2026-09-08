import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { storage, useLocalStorage } from '@/lib/storage'
import { readTimeThemePalette } from '@/lib/timeThemePalette'
import { authFetch } from '@/lib/authHelpers'
import { getBackendUrl } from '@/lib/config'
import type { ThemeMode } from '@/lib/types'
import { loadTranslationBundlesFromAssets } from '@/i18n/external'

function readableForeground(background: string) {
  const hex = background.replace('#', '')
  if (!/^[\da-f]{6}$/i.test(hex)) return undefined
  const [r, g, b] = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.58 ? '#171922' : '#f3f4f8'
}

// ─── Type definitions ──────────────────────────────────────────────

export interface ThemeFont {
  name: string
  family: string
  url: string
  weights?: string
  subsets?: string
  /** Font format hint, e.g. "woff2", "truetype", "opentype" */
  format?: string
  is_primary?: boolean
  is_heading?: boolean
  is_monospace?: boolean
}

export interface ThemeIconConfig {
  font_name: string
  css_path: string
  class_prefix: string
  icon_map: Record<string, string>
  /** Path to the icon font file (e.g. .woff2, .ttf) inside theme assets */
  font_file?: string
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
  /** Optional i18n key inside the theme namespace */
  label_key?: string
  value: string
}

export interface ThemeSetting {
  id: string
  name: string
  /** Optional i18n key inside the theme namespace */
  name_key?: string
  description?: string
  /** Optional i18n key inside the theme namespace */
  description_key?: string
  setting_type: 'toggle' | 'select' | 'slider' | 'color' | 'text'
  default_value: unknown
  options?: ThemeSettingOption[]
  min?: number
  max?: number
  step?: number
  css_variable?: string
}

// ─── Deep UI Customization Types ──────────────────────────────

export interface NavButtonCustomization {
  page_id: string
  icon?: string
  label?: string
  order?: number
  hidden?: boolean
  css_class?: string
  active_bg?: string
  active_color?: string
  badge?: string
}

export interface NavCustomization {
  position?: 'bottom' | 'left' | 'right' | 'top' | 'floating'
  background?: 'glass' | 'solid' | 'transparent' | 'gradient'
  size?: number
  radius?: string
  css_class?: string
  show_labels?: boolean
  icon_size?: number
  gap?: number
  buttons?: NavButtonCustomization[]
}

export interface ModalThemeConfig {
  backdrop?: 'blur' | 'dim' | 'solid' | 'none'
  backdrop_blur?: number
  backdrop_opacity?: number
  radius?: string
  border?: string
  background?: string
  enter_animation?: 'scale' | 'slide-up' | 'slide-down' | 'fade' | 'custom'
  exit_animation?: 'scale' | 'slide-up' | 'slide-down' | 'fade' | 'custom'
  close_button?: 'x' | 'circle' | 'pill' | 'none'
  shadow?: 'none' | 'sm' | 'md' | 'lg' | 'xl'
}

export interface NotificationThemeConfig {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center'
  enter_animation?: 'slide-left' | 'slide-right' | 'slide-up' | 'fade' | 'scale'
  exit_animation?: 'slide-left' | 'slide-right' | 'slide-up' | 'fade' | 'scale'
  radius?: string
  background?: string
  border?: string
  icon_size?: number
  accent_bar?: boolean
  max_visible?: number
  auto_dismiss_ms?: number
}

export interface NightModeConfig {
  overlay_color?: string
  overlay_opacity?: number
  css_filter?: string
  transition_ms?: number
  vignette?: boolean
  background_url?: string
  blend_mode?: string
  reduce_motion?: boolean
}

export interface ThemeCapabilities {
  design_modes?: ThemeDesignMode[]
  auto_behavior?: ThemeAutoBehavior
  accent_control?: ThemeAccentControl
  glass_control?: ThemeGlassControl
  custom_settings?: ThemeSetting[]
  /** Animation configuration (splash, page transitions, widget animations) */
  animation?: ThemeAnimationConfig
  /** Navigation bar customization */
  navigation?: NavCustomization
  /** Modal/dialog theming */
  modals?: ModalThemeConfig
  /** Notification theming */
  notifications?: NotificationThemeConfig
  /** Night mode / light-off customization */
  night_mode?: NightModeConfig
}

// ─── Animation Types (for motion.dev) ──────────────────────────

export interface SpringConfig {
  stiffness: number
  damping: number
  mass: number
}

export type SplashExitAnimation = 'fade' | 'scale' | 'slide-up' | 'slide-down' | 'custom'

export interface SplashConfig {
  enabled: boolean
  /** Path to splash HTML template inside the theme */
  template?: string
  /** Path to splash-specific CSS */
  css?: string
  /** Path to splash-specific JavaScript (can use Motion API) */
  js?: string
  /** Duration of the splash screen in milliseconds */
  duration_ms: number
  /** Logo/image URL (relative to theme assets or absolute) */
  logo_url?: string
  /** Background color for the splash */
  background_color?: string
  /** Brand text below the logo */
  brand_text?: string
  /** Subtitle / tagline */
  tagline?: string
  /** Show a loading progress bar */
  show_progress: boolean
  /** Custom exit animation type */
  exit_animation: SplashExitAnimation
}

export type PageTransitionType = 'fade' | 'slide' | 'scale' | 'flip' | 'custom'

export interface PageTransitionConfig {
  enabled: boolean
  transition_type: PageTransitionType
  duration_secs: number
  spring?: SpringConfig
  custom_name?: string
}

export type WidgetAnimationStyle = 'fade-up' | 'scale-in' | 'slide-left' | 'slide-right' | 'custom'

export interface WidgetAnimationConfig {
  style: WidgetAnimationStyle
  duration_secs: number
  stagger_secs: number
  spring?: SpringConfig
}

export interface ThemeAnimationConfig {
  splash?: SplashConfig
  page_transitions?: PageTransitionConfig
  widget_animations?: WidgetAnimationConfig
  /** Custom CSS @keyframes (name → CSS content) */
  keyframes?: Record<string, string>
}

// ─── Widget Template Types (v2.4) ──────────────────────────────

export interface WidgetTemplateVariant {
  name: string
  template: string
  css?: string
  js?: string
  label?: string
  icon?: string
  is_default?: boolean
  responsive?: string  // "all" | "mobile" | "tablet" | "desktop"
}

export interface WidgetTemplate {
  widget_type: string
  variants: WidgetTemplateVariant[]
  css_variables?: Record<string, string>
  replace_default?: boolean
}

// ─── Theme Response Types ──────────────────────────────────────

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
  /** Animation configuration (splash, page transitions, widget animations) */
  animation?: ThemeAnimationConfig
  /** Widget templates for theme-defined widget rendering */
  widget_templates?: WidgetTemplate[]
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
  /** Widget templates from the active theme (widget_type → WidgetTemplate) */
  widgetTemplates: WidgetTemplate[]
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
  /** Full animation configuration from the active theme */
  animationConfig: ThemeAnimationConfig | null
  /** Splash screen configuration (convenience accessor) */
  splashConfig: SplashConfig | null
  /** Page transition configuration (convenience accessor) */
  pageTransitionConfig: PageTransitionConfig | null
  /** Widget animation configuration (convenience accessor) */
  widgetAnimationConfig: WidgetAnimationConfig | null
  /** Navigation bar customization from the active theme */
  navConfig: NavCustomization | null
  /** Modal/dialog theming from the active theme */
  modalConfig: ModalThemeConfig | null
  /** Notification theming from the active theme */
  notificationConfig: NotificationThemeConfig | null
  /** Night mode customization from the active theme */
  nightModeConfig: NightModeConfig | null
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

// ─── Split Contexts for Render Performance ─────────────────────
// Only components that need the full context should use useTheme().
// For targeted re-renders, use the split hooks below.

interface ThemeMetaContextType {
  availableThemes: ThemeDefinition[]
  installedThemes: InstalledTheme[]
  loading: boolean
  refreshThemes: () => Promise<void>
}
const ThemeMetaContext = createContext<ThemeMetaContextType | undefined>(undefined)

interface ThemeActiveContextType {
  theme: string
  sleepMode: boolean
  autoTheme: boolean
  selectedTheme: string
  activeCssVariables: Record<string, string>
  themeResponse: ThemeCssResponse | null
  capabilities: ThemeCapabilities | null
  activeTemplates: Record<string, string>
  widgetTemplates: WidgetTemplate[]
  designModes: ThemeDesignMode[]
  activeDesignMode: string
  customSettings: Record<string, unknown>
  accentLocked: boolean
  forcedAccent: string | null
  glassLocked: boolean
  forcedGlass: { blur?: string; opacity?: string } | null
  animationConfig: ThemeAnimationConfig | null
  splashConfig: SplashConfig | null
  pageTransitionConfig: PageTransitionConfig | null
  widgetAnimationConfig: WidgetAnimationConfig | null
  navConfig: NavCustomization | null
  modalConfig: ModalThemeConfig | null
  notificationConfig: NotificationThemeConfig | null
  nightModeConfig: NightModeConfig | null
}
const ThemeActiveContext = createContext<ThemeActiveContextType | undefined>(undefined)

interface ThemeActionContextType {
  setSleepMode: (enabled: boolean) => void
  setAutoTheme: (enabled: boolean) => void
  setSelectedTheme: (theme: string) => void
  setActiveDesignMode: (modeId: string) => void
  updateCustomSetting: (key: string, value: unknown) => Promise<void>
}
const ThemeActionContext = createContext<ThemeActionContextType | undefined>(undefined)

function getThemeFromTime(): string {
  const cfg = readTimeThemeConfig()
  const hour = new Date().getHours()
  if (hour >= cfg.dayStart && hour < cfg.eveningStart) return 'day'
  if (hour >= cfg.eveningStart && hour < cfg.nightStart) return 'evening'
  return 'night'
}

// ─── Configurable day/evening/night boundaries (per user) ───────────────
export interface TimeThemeConfig {
  dayStart: number
  eveningStart: number
  nightStart: number
}

const TIME_THEME_KEY = 'rumahl-time-theme-boundaries'
const DEFAULT_TIME_THEME: TimeThemeConfig = { dayStart: 6, eveningStart: 18, nightStart:21 }

export function readTimeThemeConfig(): TimeThemeConfig {
  const stored = storage.get<Partial<TimeThemeConfig>>(TIME_THEME_KEY)
  if (stored) {
    return {
      dayStart: typeof stored.dayStart === 'number' ? stored.dayStart : DEFAULT_TIME_THEME.dayStart,
      eveningStart: typeof stored.eveningStart === 'number' ? stored.eveningStart : DEFAULT_TIME_THEME.eveningStart,
      nightStart: typeof stored.nightStart === 'number' ? stored.nightStart : DEFAULT_TIME_THEME.nightStart,
    }
  }
  return DEFAULT_TIME_THEME
}

export function writeTimeThemeConfig(config: TimeThemeConfig): void {
  storage.set(TIME_THEME_KEY, config)
  window.dispatchEvent(new CustomEvent('rumahl:time-theme-change'))
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
  { id: 'auto', name: 'Automatisch', version: '1.0.0', developer: 'rumahl', description: 'Wechselt nach Tageszeit', icon: 'ArrowsClockwise', system: true, order: 0, css_variables: {} },
  { id: 'light', name: 'Hell', version: '1.0.0', developer: 'rumahl', description: 'Maximale Helligkeit', icon: 'Sun', system: true, order: 5, css_variables: {} },
  { id: 'day', name: 'Tag', version: '1.0.0', developer: 'rumahl', description: 'Helles Design', icon: 'CloudSun', system: true, order: 10, css_variables: {} },
  { id: 'day-classic', name: 'Klassisch', version: '1.0.0', developer: 'rumahl', description: 'Dunkler Hintergrund', icon: 'Monitor', system: true, order: 20, css_variables: {} },
  { id: 'evening', name: 'Abend', version: '1.0.0', developer: 'rumahl', description: 'Warme Töne', icon: 'SunDim', system: true, order: 30, css_variables: {} },
  { id: 'night', name: 'Nacht', version: '1.0.0', developer: 'rumahl', description: 'Dunkles Design', icon: 'MoonStars', system: true, order: 40, css_variables: {} },
  { id: 'sleep', name: 'Schlaf', version: '1.0.0', developer: 'rumahl', description: 'OLED Schwarz', icon: 'Moon', system: true, order: 50, css_variables: {} },
  { id: 'midnight', name: 'rumahl Midnight UI', version: '1.0.0', developer: 'rumahl', description: 'Pure black with white accents', icon: 'CircleHalfTilt', system: true, order: 60, css_variables: {} },
]

function getThemePreview(themeId: string): string {
  const previews: Record<string, string> = {
    auto: 'linear-gradient(135deg, #e8eaf0 0%, #1a1d2e 100%)',
    light: 'linear-gradient(135deg, #f5f5f7 0%, #e8eaf0 50%, #dde0e8 100%)',
    day: 'linear-gradient(135deg, #e0e4ec 0%, #c8cdd8 50%, #b8bfcc 100%)',
    'day-classic': 'linear-gradient(135deg, #2a2d3e 0%, #1a1d2e 50%, #0f1118 100%)',
    evening: 'linear-gradient(135deg, #2d2f4a 0%, #1e2040 50%, #15172e 100%)',
    night: 'linear-gradient(135deg, #0d0d0d 0%, #070707 50%, #050505 100%)',
    sleep: 'linear-gradient(135deg, #050508 0%, #000000 100%)',
    midnight: 'linear-gradient(135deg, #242424 0%, #080808 42%, #000000 100%)',
  }
  return previews[themeId] || 'linear-gradient(135deg, #1a1d2e 0%, #0f1220 100%)'
}

// ─── Font & Style injection helpers ─────────────────────────────────

/** IDs used for injected elements so we can clean them up on theme switch */
const FONT_CONTAINER_ID = 'rumahl-theme-fonts'
const STYLE_CONTAINER_ID = 'rumahl-theme-css'
const ICON_FONT_ID = 'rumahl-theme-icon-font'
const JS_CONTAINER_ID = 'rumahl-theme-js'
const CSS_FILES_PREFIX = 'rumahl-theme-css-file-'

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
  if (import.meta.env.DEV) {
    const lines = css.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.includes('{') && !trimmed.startsWith(':root[') && !trimmed.startsWith('@') && !trimmed.startsWith('/*') && !trimmed.startsWith('//') && !trimmed.startsWith('}') && !trimmed.startsWith('*')) {
        console.warn('[ThemeContext] CSS rule without :root[data-theme] scope — may affect ALL themes:', trimmed.substring(0, 80))
      }
    }
  }
  let style = document.getElementById(STYLE_CONTAINER_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_CONTAINER_ID
    document.head.appendChild(style)
  } else if ((style as HTMLStyleElement).textContent === css) {
    return
  }
  ;(style as HTMLStyleElement).textContent = css
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
    const scriptId = `rumahl-theme-js-${index}`
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
    link.href = config.css_path
    document.head.appendChild(link)
  } else {
    link.href = config.css_path
  }

  // Store icon map on document for runtime use
  ;(window as any).__rumahl_icon_map = config.icon_map
  ;(window as any).__rumahl_icon_prefix = config.class_prefix
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
  document.querySelectorAll(`script[id^="rumahl-theme-js-"]`).forEach(el => el.remove())

  // Reset body font
  document.body.style.fontFamily = ''

  // Reset heading/mono fonts
  document.documentElement.style.removeProperty('--font-heading')
  document.documentElement.style.removeProperty('--font-mono')

  // Clear icon map
  delete (window as any).__rumahl_icon_map
  delete (window as any).__rumahl_icon_prefix
}

// ─── FOUC Protection - sessionStorage CSS cache ───────────────────

const THEME_CSS_CACHE_KEY = 'rumahl-theme-css-cache'
function cacheThemeCss(id: string, vars: Record<string, string>) {
  try { sessionStorage.setItem(THEME_CSS_CACHE_KEY, JSON.stringify({ id, vars })) } catch {}
}
function applyCachedThemeCss(): string | null {
  try {
    const raw = sessionStorage.getItem(THEME_CSS_CACHE_KEY)
    if (!raw) return null
    const { id, vars } = JSON.parse(raw) as { id: string; vars: Record<string, string> }
    const root = document.documentElement
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(`--${k}`, v))
    root.setAttribute('data-theme', id)
    // Track which keys/id came from the FOUC cache so they can be removed
    // once the authoritative theme data resolves (see clearStaleFoucVars).
    root.setAttribute('data-fouc-theme-cache', JSON.stringify({ id, keys: Object.keys(vars) }))
    return id
  } catch { return null }
}

/**
 * Remove FOUC-cache inline vars when they belong to a different theme than
 * the one that is now active. The cache is only a flash guard for the moment
 * before theme data loads — if it is never cleared, stale (e.g. light custom
 * theme) vars stay inline and override the current theme's stylesheet on
 * every page, system-wide.
 */
function clearStaleFoucVars(root: HTMLElement, currentThemeId: string) {
  const foucRaw = root.getAttribute('data-fouc-theme-cache')
  if (!foucRaw) return
  try {
    const fouc = JSON.parse(foucRaw) as { id?: string; keys?: string[] }
    if (fouc.id && fouc.id !== currentThemeId && Array.isArray(fouc.keys)) {
      fouc.keys.forEach((key) => root.style.removeProperty(`--${key}`))
    }
    root.removeAttribute('data-fouc-theme-cache')
  } catch {}
}

// ─── Theme Provider ─────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [sleepMode, setSleepMode] = useLocalStorage<boolean>('ha-sleep-mode', false)
  const [autoTheme, setAutoTheme] = useLocalStorage<boolean>('ha-auto-theme', true)
  const [selectedTheme, setSelectedThemeState] = useLocalStorage<string>('ha-selected-theme', 'auto')
  const [theme, setTheme] = useState<string>(() => {
    const cached = applyCachedThemeCss()
    if (cached && sleepMode) return 'sleep'
    if (cached && selectedTheme === cached) return cached
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
  const [activeDesignMode, setActiveDesignModeState] = useState<string>(() => {
    // Restore a manually selected design mode across reloads (the modes are
    // per-theme; a mode the active theme does not provide is reset below).
    try {
      const raw = localStorage.getItem('rumahl-active-design-mode')
      if (raw) {
        const parsed = JSON.parse(raw) as { mode?: string }
        if (parsed && typeof parsed.mode === 'string') return parsed.mode
      }
    } catch {}
    return 'default'
  })
  const [customSettings, setCustomSettings] = useState<Record<string, unknown>>({})

  // Track which theme's resources are currently injected
  const injectedThemeRef = useRef<string | null>(null)
  const prevModeVarsRef = useRef<Record<string, string>>({})
  const abortRef = useRef<AbortController | null>(null)

  const { user } = useAuth()

  // Resolve the configuration profile id that theme selections/settings are
  // keyed on server-side. configuration_profiles.id is a UUID distinct from
  // the auth user id — sending user.id as profile_id violates the FK
  // (user_theme_selections_profile_id_fkey) and every theme save returns 500.
  // Same load-or-create endpoint as ConfigurationContext; the backend reuses
  // the existing default user profile, so this is idempotent.
  const loadOrCreateThemeProfile = useCallback(async (userId: string): Promise<string | null> => {
    try {
      const res = await authFetch('/api/config/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Theme Settings',
          profile_type: 'user',
          owner_id: userId,
        }),
      })
      if (!res.ok) return null
      const profile = await res.json() as { id?: unknown }
      return typeof profile?.id === 'string' ? profile.id : null
    } catch (e) {
      console.warn('Failed to resolve theme profile:', e)
      return null
    }
  }, [])

  useEffect(() => {
    if (!user?.id) {
      setProfileId(null)
      return
    }
    let cancelled = false
    void loadOrCreateThemeProfile(user.id).then((id) => {
      if (!cancelled) setProfileId(id)
    })
    return () => { cancelled = true }
  }, [user?.id, loadOrCreateThemeProfile])

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
          developer: 'rumahl', description: 'Wechselt nach Tageszeit',
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

  const fetchSeqRef = useRef(0)

  /** Fetch the full theme data (CSS vars, fonts, icons, custom CSS) */
  const fetchThemeData = useCallback(async (pid: string) => {
    const seq = ++fetchSeqRef.current
    try {
      const res = await authFetch(`/api/themes/css/${pid}`)
      if (seq !== fetchSeqRef.current) return
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
      if (seq !== fetchSeqRef.current) return
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
      
      // Design modes with time windows: pick the mode matching the current
      // time. `capabilities` is in the effect deps so this re-runs when the
      // theme data arrives — the previous closure captured the mount-time
      // (empty) capabilities, so the time-of-day mode was never applied and
      // the theme stayed on its lightest/base mode.
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
    window.addEventListener('rumahl:time-theme-change', update)
    const interval = setInterval(update, 60000)
    return () => { clearInterval(interval); window.removeEventListener('rumahl:time-theme-change', update) }
  }, [sleepMode, autoTheme, selectedTheme, capabilities])

  // Fetch theme data when theme changes
  useEffect(() => {
    const applyTimePalette = () => {
      if (!['day', 'evening', 'night'].includes(theme)) return
      const colors = readTimeThemePalette()[theme as 'day' | 'evening' | 'night']
      document.documentElement.style.setProperty('--background', colors.background)
      document.documentElement.style.setProperty('--accent', colors.accent)
      const foreground = readableForeground(colors.background)
      if (foreground) document.documentElement.style.setProperty('--foreground', foreground)
    }
    applyTimePalette()
    window.addEventListener('rumahl:time-theme-palette-change', applyTimePalette)
    return () => window.removeEventListener('rumahl:time-theme-palette-change', applyTimePalette)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)

    const isBuiltin = ['day', 'day-classic', 'light', 'evening', 'night', 'sleep', 'midnight', 'auto'].includes(theme)

    if (!isBuiltin && profileId) {
      fetchThemeData(profileId)
    } else {
      // Builtin theme: the stylesheet is authoritative — drop any FOUC-cache
      // inline vars that came from a different (custom) theme.
      clearStaleFoucVars(root, theme)
      if (['day', 'evening', 'night'].includes(theme)) {
        const colors = readTimeThemePalette()[theme as 'day' | 'evening' | 'night']
        root.style.setProperty('--background', colors.background)
        root.style.setProperty('--accent', colors.accent)
        const foreground = readableForeground(colors.background)
        if (foreground) root.style.setProperty('--foreground', foreground)
      }
      setThemeResponse(null)
      setActiveCssVariables({})
    }
  }, [theme, profileId, fetchThemeData])

  // Apply CSS variables + fonts + icons + custom CSS when themeResponse changes
  useEffect(() => {
    if (themeResponse?.theme_id === injectedThemeRef.current) return

    const root = document.documentElement

    // Drop FOUC-cache inline vars from a previously cached theme before
    // applying this theme's authoritative variables.
    if (themeResponse?.theme_id) {
      clearStaleFoucVars(root, themeResponse.theme_id)
    }

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
        const applyVars = () => {
          Object.entries(themeResponse.css_variables).forEach(([key, value]) => {
            root.style.setProperty(`--${key}`, value)
          })
        }
        if (typeof document !== 'undefined' && 'startViewTransition' in document) {
          (document as any).startViewTransition(() => {
            requestAnimationFrame(applyVars)
          })
        } else {
          requestAnimationFrame(applyVars)
        }
        root.setAttribute('data-custom-theme-vars', JSON.stringify(Object.keys(themeResponse.css_variables)))
        cacheThemeCss(themeResponse.theme_id, themeResponse.css_variables)
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
        delete (window as any).__rumahl_icon_map
        delete (window as any).__rumahl_icon_prefix
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

  // Load theme-provided translation bundles (optional).
  // Themes can ship `/i18n/en.json`, `/i18n/de.json` inside their ZIP.
  useEffect(() => {
    if (!themeResponse?.assets_base_url) return
    if (!themeResponse.theme_id || themeResponse.theme_id === 'auto') return

    const namespace = `theme-${themeResponse.theme_id}`
    void loadTranslationBundlesFromAssets({
      assetsBaseUrl: themeResponse.assets_base_url,
      namespace,
      fetcher: authFetch,
    })
  }, [themeResponse?.assets_base_url, themeResponse?.theme_id])

  // ─── Capabilities & Custom Settings ────────────────────────────
  useEffect(() => {
    const caps = themeResponse?.capabilities || null
    setCapabilities(caps)

    // The design mode itself is resolved by the theme/design-mode effects
    // (time-based auto switch for auto_behavior "time", otherwise the user's
    // stored selection). Forcing the first mode here overrode the time-of-day
    // mode on every theme-data load and left the lightest mode active.
    if (!caps?.design_modes || caps.design_modes.length === 0) {
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
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      let cancelled = false
      const fetchSettings = async () => {
        try {
          const r = await authFetch(`/api/themes/user/${profileId}/settings/${themeResponse.theme_id}`)
          const data: { settings?: Record<string, unknown> } | null = r.ok ? await r.json() : null
          if (cancelled) return
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
        } catch {
          if (cancelled) return
          // Use defaults on error
          const defaults: Record<string, unknown> = {}
          caps?.custom_settings?.forEach(s => {
            defaults[s.id] = s.default_value
          })
          setCustomSettings(defaults)
        }
      }
      fetchSettings()
      return () => { cancelled = true; abortRef.current?.abort() }
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

  // Restore/validate the design mode after theme data (capabilities) loads:
  // apply the stored mode's CSS variables (state alone survives a reload,
  // inline styles do not) and reset modes the active theme does not provide.
  useEffect(() => {
    const modes = capabilities?.design_modes
    if (!modes || modes.length === 0) return
    const mode = modes.find((m) => m.id === activeDesignMode)
    if (!mode) {
      setActiveDesignModeState('default')
      try { localStorage.removeItem('rumahl-active-design-mode') } catch {}
      return
    }
    Object.keys(prevModeVarsRef.current).forEach((key) => {
      document.documentElement.style.removeProperty(`--${key}`)
    })
    prevModeVarsRef.current = mode.css_variables
    Object.entries(mode.css_variables).forEach(([key, value]) => {
      document.documentElement.style.setProperty(`--${key}`, value)
    })
  }, [capabilities, activeDesignMode])

  // Set active design mode (for themes with custom modes)
  const setActiveDesignMode = useCallback((modeId: string) => {
    setActiveDesignModeState(modeId)
    try {
      localStorage.setItem('rumahl-active-design-mode', JSON.stringify({ mode: modeId }))
    } catch {}
    // Clean up previous mode variables
    Object.keys(prevModeVarsRef.current).forEach(key => {
      document.documentElement.style.removeProperty(`--${key}`)
    })
    const mode = capabilities?.design_modes?.find(m => m.id === modeId)
    if (mode) {
      prevModeVarsRef.current = mode.css_variables
      Object.entries(mode.css_variables).forEach(([key, value]) => {
        document.documentElement.style.setProperty(`--${key}`, value)
      })
    } else {
      prevModeVarsRef.current = {}
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

  const widgetTemplates = useMemo(() => {
    return themeResponse?.widget_templates || []
  }, [themeResponse?.widget_templates])

  const designModes = useMemo(() => {
    return capabilities?.design_modes || []
  }, [capabilities])

  // Computed animation config
  const animationConfig = useMemo(() => capabilities?.animation || null, [capabilities])
  const splashConfig = useMemo(() => capabilities?.animation?.splash || null, [capabilities])
  const pageTransitionConfig = useMemo(() => capabilities?.animation?.page_transitions || null, [capabilities])
  const widgetAnimationConfig = useMemo(() => capabilities?.animation?.widget_animations || null, [capabilities])

  // Computed UI customization configs
  const navConfig = useMemo(() => capabilities?.navigation || null, [capabilities])
  const modalConfig = useMemo(() => capabilities?.modals || null, [capabilities])
  const notificationConfig = useMemo(() => capabilities?.notifications || null, [capabilities])
  const nightModeConfig = useMemo(() => capabilities?.night_mode || null, [capabilities])

  // Inject custom CSS keyframes from theme animation config
  useEffect(() => {
    const KEYFRAME_STYLE_ID = 'rumahl-theme-keyframes'
    let styleEl = document.getElementById(KEYFRAME_STYLE_ID)
    
    if (capabilities?.animation?.keyframes && Object.keys(capabilities.animation.keyframes).length > 0) {
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = KEYFRAME_STYLE_ID
        document.head.appendChild(styleEl)
      }
      // Build CSS from keyframes map
      const css = Object.entries(capabilities.animation.keyframes)
        .map(([name, keyframeCss]) => `@keyframes ${name} { ${keyframeCss} }`)
        .join('\n')
      styleEl.textContent = css
    } else {
      if (styleEl) styleEl.remove()
    }
  }, [capabilities?.animation?.keyframes])

  // Update transition CSS variable from animation config
  useEffect(() => {
    const root = document.documentElement
    if (pageTransitionConfig?.duration_secs) {
      root.style.setProperty('--page-transition-duration', `${pageTransitionConfig.duration_secs}s`)
    } else {
      root.style.removeProperty('--page-transition-duration')
    }
  }, [pageTransitionConfig?.duration_secs])

  const metaValue = useMemo(() => ({
    availableThemes, installedThemes, loading, refreshThemes,
  }), [availableThemes, installedThemes, loading, refreshThemes])

  const activeValue = useMemo(() => ({
    theme, sleepMode, autoTheme, selectedTheme,
    activeCssVariables, themeResponse, capabilities,
    activeTemplates, widgetTemplates, designModes,
    activeDesignMode, customSettings,
    accentLocked, forcedAccent, glassLocked, forcedGlass,
    animationConfig, splashConfig, pageTransitionConfig, widgetAnimationConfig,
    navConfig, modalConfig, notificationConfig, nightModeConfig,
  }), [
    theme, sleepMode, autoTheme, selectedTheme,
    activeCssVariables, themeResponse, capabilities,
    activeTemplates, widgetTemplates, designModes,
    activeDesignMode, customSettings,
    accentLocked, forcedAccent, glassLocked, forcedGlass,
    animationConfig, splashConfig, pageTransitionConfig, widgetAnimationConfig,
    navConfig, modalConfig, notificationConfig, nightModeConfig,
  ])

  const actionValue = useMemo(() => ({
    setSleepMode, setAutoTheme, setSelectedTheme,
    setActiveDesignMode, updateCustomSetting,
  }), [setSleepMode, setAutoTheme, setSelectedTheme, setActiveDesignMode, updateCustomSetting])

  const contextValue = useMemo(() => ({
    theme, sleepMode, setSleepMode,
    autoTheme, setAutoTheme,
    selectedTheme, setSelectedTheme,
    availableThemes, installedThemes, loading, refreshThemes,
    activeCssVariables, themeResponse,
    activeTemplates, widgetTemplates,
    capabilities, designModes,
    activeDesignMode, setActiveDesignMode,
    customSettings, updateCustomSetting,
    accentLocked, forcedAccent,
    glassLocked, forcedGlass,
    animationConfig, splashConfig, pageTransitionConfig, widgetAnimationConfig,
    navConfig, modalConfig, notificationConfig, nightModeConfig,
  }), [
    theme, sleepMode, setSleepMode,
    autoTheme, setAutoTheme,
    selectedTheme, setSelectedTheme,
    availableThemes, installedThemes, loading, refreshThemes,
    activeCssVariables, themeResponse,
    activeTemplates, widgetTemplates,
    capabilities, designModes,
    activeDesignMode, setActiveDesignMode,
    customSettings, updateCustomSetting,
    accentLocked, forcedAccent,
    glassLocked, forcedGlass,
    animationConfig, splashConfig, pageTransitionConfig, widgetAnimationConfig,
    navConfig, modalConfig, notificationConfig, nightModeConfig,
  ])

  return (
    <ThemeMetaContext.Provider value={metaValue}>
    <ThemeActiveContext.Provider value={activeValue}>
    <ThemeActionContext.Provider value={actionValue}>
    <ThemeContext.Provider value={contextValue}>
      <div className="theme-transition min-h-screen bg-background text-foreground">
        {children}
      </div>
    </ThemeContext.Provider>
    </ThemeActionContext.Provider>
    </ThemeActiveContext.Provider>
    </ThemeMetaContext.Provider>
  )
}

export function useThemeMeta() {
  const ctx = useContext(ThemeMetaContext)
  if (!ctx) throw new Error('useThemeMeta must be used within ThemeProvider')
  return ctx
}
export function useThemeActive() {
  const ctx = useContext(ThemeActiveContext)
  if (!ctx) throw new Error('useThemeActive must be used within ThemeProvider')
  return ctx
}
export function useThemeActions() {
  const ctx = useContext(ThemeActionContext)
  if (!ctx) throw new Error('useThemeActions must be used within ThemeProvider')
  return ctx
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
