/**
 * rumahl Theme SDK - Enable apps to use, customize, or override rumahl themes
 * 
 * Features:
 * - Access current rumahl theme
 * - Inherit and customize theme variables
 * - Create app-specific themes
 * - React to theme changes
 * - Apply theme to iframe contexts
 */

export interface ThemeVariable {
  name: string
  value: string
  category?: 'color' | 'spacing' | 'typography' | 'effect' | 'custom'
}

export interface ThemeConfig {
  /** Inherit from parent rumahl theme (default: true) */
  inherit: boolean
  /** Override specific CSS variables */
  variables?: Record<string, string>
  /** Custom CSS to inject */
  customCss?: string
  /** CSS file URLs to load */
  cssFiles?: string[]
  /** Fonts to load */
  fonts?: Array<{
    family: string
    url: string
    weights?: string
    subsets?: string
  }>
  /** Design mode overrides */
  designModes?: Record<string, Record<string, string>>
}

export interface ThemeInfo {
  id: string
  name: string
  mode: 'light' | 'dark' | 'auto'
  variables: Record<string, string>
  capabilities?: {
    supportsCustomization?: boolean
    locksAccent?: boolean
    locksGlass?: boolean
  }
}

export class rumahlThemeClient {
  private appId: string
  private config: ThemeConfig
  private listeners: Set<(theme: ThemeInfo) => void> = new Set()
  private currentTheme: ThemeInfo | null = null
  private styleElement: HTMLStyleElement | null = null

  constructor(appId: string, config: ThemeConfig = { inherit: true }) {
    this.appId = appId
    this.config = config
    this.init()
  }

  private init() {
    // Listen for theme changes from parent
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'ora:theme:update') {
        this.handleThemeUpdate(event.data.theme)
      }
    })

    // Request initial theme
    this.requestTheme()
  }

  private requestTheme() {
    window.parent.postMessage({
      type: 'ora:theme:request',
      appId: this.appId,
    }, '*')
  }

  private handleThemeUpdate(theme: ThemeInfo) {
    this.currentTheme = theme
    this.applyTheme(theme)
    this.listeners.forEach(listener => listener(theme))
  }

  private applyTheme(theme: ThemeInfo) {
    // Create or update style element
    if (!this.styleElement) {
      this.styleElement = document.createElement('style')
      this.styleElement.id = 'rumahl-theme-variables'
      document.head.appendChild(this.styleElement)
    }

    // Build CSS from theme
    let css = ':root {\n'

    // Apply inherited variables if enabled
    if (this.config.inherit) {
      Object.entries(theme.variables).forEach(([key, value]) => {
        // Don't override if we have a custom value
        if (!this.config.variables?.[key]) {
          css += `  --${key}: ${value};\n`
        }
      })
    }

    // Apply custom variable overrides
    if (this.config.variables) {
      Object.entries(this.config.variables).forEach(([key, value]) => {
        css += `  --${key}: ${value};\n`
      })
    }

    css += '}\n'

    // Add custom CSS
    if (this.config.customCss) {
      css += '\n' + this.config.customCss
    }

    this.styleElement.textContent = css

    // Load custom fonts
    if (this.config.fonts) {
      this.loadFonts(this.config.fonts)
    }

    // Load CSS files
    if (this.config.cssFiles) {
      this.loadCssFiles(this.config.cssFiles)
    }
  }

  private loadFonts(fonts: ThemeConfig['fonts']) {
    if (!fonts) return

    let container = document.getElementById('rumahl-app-fonts')
    if (!container) {
      container = document.createElement('div')
      container.id = 'rumahl-app-fonts'
      container.style.display = 'none'
      document.head.appendChild(container)
    }
    container.innerHTML = ''

    fonts.forEach(font => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = font.url
      container.appendChild(link)
    })
  }

  private loadCssFiles(cssFiles: string[]) {
    cssFiles.forEach((url, index) => {
      const id = `rumahl-app-css-${index}`
      let link = document.getElementById(id) as HTMLLinkElement
      if (!link) {
        link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        document.head.appendChild(link)
      }
      link.href = url
    })
  }

  /**
   * Get current theme information
   */
  getTheme(): ThemeInfo | null {
    return this.currentTheme
  }

  /**
   * Update theme configuration
   */
  updateConfig(config: Partial<ThemeConfig>) {
    this.config = { ...this.config, ...config }
    if (this.currentTheme) {
      this.applyTheme(this.currentTheme)
    }
  }

  /**
   * Override specific CSS variables
   */
  setVariables(variables: Record<string, string>) {
    this.config.variables = { ...this.config.variables, ...variables }
    if (this.currentTheme) {
      this.applyTheme(this.currentTheme)
    }
  }

  /**
   * Get a specific CSS variable value
   */
  getVariable(name: string): string | null {
    // Check custom overrides first
    if (this.config.variables?.[name]) {
      return this.config.variables[name]
    }
    // Check current theme
    if (this.currentTheme?.variables[name]) {
      return this.currentTheme.variables[name]
    }
    // Fall back to computed value
    return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || null
  }

  /**
   * Listen to theme changes
   */
  onThemeChange(listener: (theme: ThemeInfo) => void): () => void {
    this.listeners.add(listener)
    // Call immediately with current theme
    if (this.currentTheme) {
      listener(this.currentTheme)
    }
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Request a specific design mode (if supported by theme)
   */
  setDesignMode(mode: string) {
    window.parent.postMessage({
      type: 'ora:theme:setDesignMode',
      appId: this.appId,
      mode,
    }, '*')
  }

  /**
   * Check if current theme is dark mode
   */
  isDark(): boolean {
    if (!this.currentTheme) return false
    return this.currentTheme.mode === 'dark' || 
           (this.currentTheme.mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  }

  /**
   * Get all available CSS variables from current theme
   */
  getAllVariables(): Record<string, string> {
    const computed: Record<string, string> = {}
    const styles = getComputedStyle(document.documentElement)
    
    // Get all custom properties
    Array.from(document.styleSheets).forEach(sheet => {
      try {
        Array.from(sheet.cssRules).forEach(rule => {
          if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
            Array.from(rule.style).forEach(prop => {
              if (prop.startsWith('--')) {
                const name = prop.substring(2)
                computed[name] = styles.getPropertyValue(prop).trim()
              }
            })
          }
        })
      } catch (e) {
        // Cross-origin stylesheets
      }
    })

    return computed
  }

  /**
   * Export current theme configuration
   */
  exportConfig(): ThemeConfig {
    return {
      inherit: this.config.inherit,
      variables: this.config.variables,
      customCss: this.config.customCss,
      cssFiles: this.config.cssFiles,
      fonts: this.config.fonts,
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.listeners.clear()
    if (this.styleElement) {
      this.styleElement.remove()
    }
    document.getElementById('rumahl-app-fonts')?.remove()
  }
}

/**
 * Utility: Create a scoped theme for a specific element
 */
export function createScopedTheme(element: HTMLElement, variables: Record<string, string>) {
  Object.entries(variables).forEach(([key, value]) => {
    element.style.setProperty(`--${key}`, value)
  })
}

/**
 * Utility: Get all color variables from current theme
 */
export function getColorVariables(): Record<string, string> {
  const colors: Record<string, string> = {}
  const colorVars = [
    'background', 'foreground', 'card', 'card-foreground',
    'popover', 'popover-foreground', 'primary', 'primary-foreground',
    'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
    'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
    'border', 'input', 'ring', 'success', 'warning', 'info',
  ]

  colorVars.forEach(varName => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--${varName}`).trim()
    if (value) {
      colors[varName] = value
    }
  })

  return colors
}

/**
 * Utility: Generate theme preview
 */
export function generateThemePreview(variables: Record<string, string>): string {
  const bg = variables.background || '#1a1d2e'
  const fg = variables.foreground || '#ffffff'
  const accent = variables.accent || '#6366f1'

  return `
    <div style="background: ${bg}; color: ${fg}; padding: 20px; border-radius: 12px; border: 1px solid ${accent}33;">
      <h3 style="color: ${accent}; margin: 0 0 10px 0;">Theme Preview</h3>
      <p style="margin: 0; font-size: 14px; opacity: 0.8;">Background: ${bg}</p>
      <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.8;">Foreground: ${fg}</p>
      <div style="margin-top: 10px; padding: 10px; background: ${accent}22; border-radius: 8px; border: 1px solid ${accent}44;">
        <span style="color: ${accent}; font-weight: 600;">Accent Color</span>
      </div>
    </div>
  `
}
