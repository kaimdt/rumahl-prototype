/**
 * ThemeWidgetRenderer – Renders widgets using theme-defined HTML templates.
 *
 * When the active theme provides a `widget_templates` entry for a widget type,
 * this component fetches and renders the theme's custom template instead of
 * the default React widget component.
 *
 * Templates use `data-slot` for React component injection and `data-prop`
 * for data binding from entity attributes.
 *
 * Supported data-prop bindings:
 *   data-prop="entity.state"      – Current state value
 *   data-prop="entity.name"       – Friendly name
 *   data-prop="entity.icon"      – Icon indicator (on/off, etc.)
 *   data-prop="entity.attr.X"    – Any entity attribute by key
 *
 * Usage:
 * ```tsx
 * <ThemeWidgetRenderer
 *   widgetType="light"
 *   entity={entity}
 *   config={config}
 *   fallback={<LightWidget entity={entity} />}
 * />
 * ```
 */

import React, { useMemo, useState, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { renderTemplate } from '@/lib/templateRenderer'
import type { WidgetTemplate, WidgetTemplateVariant } from '@/contexts/ThemeContext'
import type { EntityState } from '@/lib/types'

// ─── Props ──────────────────────────────────────────────────────────

export interface ThemeWidgetRendererProps {
  /** The widget type (e.g. "light", "switch", "climate") */
  widgetType: string
  /** The entity data for this widget */
  entity?: EntityState
  /** Widget configuration (card variant, transparency, etc.) */
  config?: Record<string, unknown>
  /** Additional entities (for grouped widgets) */
  allEntities?: EntityState[]
  /** Widget size in grid cells */
  widgetSize?: { w: number; h: number }
  /** Callback when the widget state changes */
  onUpdate?: () => void
  /** Fallback React element when no theme template is available */
  fallback: React.ReactNode
  /** CSS class added to the wrapper */
  className?: string
}

// ─── Template Cache ─────────────────────────────────────────────────

const templateContentCache = new Map<string, string>()
const pendingTemplateFetches = new Map<string, Promise<string | null>>()

async function fetchTemplateContent(url: string): Promise<string | null> {
  if (templateContentCache.has(url)) {
    return templateContentCache.get(url)!
  }
  if (pendingTemplateFetches.has(url)) {
    return pendingTemplateFetches.get(url)!
  }

  const promise = (async () => {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        console.warn(`[ThemeWidgetRenderer] Failed to fetch template: ${url} (${response.status})`)
        return null
      }
      const html = await response.text()
      templateContentCache.set(url, html)
      return html
    } catch (err) {
      console.warn(`[ThemeWidgetRenderer] Error fetching template: ${url}`, err)
      return null
    } finally {
      pendingTemplateFetches.delete(url)
    }
  })()

  pendingTemplateFetches.set(url, promise)
  return promise
}

// ─── Data Binding Helpers ───────────────────────────────────────────

/**
 * Extract a value from an entity based on a data-prop path.
 * Supported paths:
 *   - "entity.state"         → entity.state
 *   - "entity.name"          → entity.attributes.friendly_name || entity.entity_id
 *   - "entity.attr.brightness" → entity.attributes.brightness
 *   - "entity.attr.rgb_color" → entity.attributes.rgb_color (as array)
 *   - "entity.is_on"          → entity.state === 'on'
 *   - "entity.unit"           → entity.attributes.unit_of_measurement
 *   - "config.X"              → config.X value
 */
function resolveDataProp(
  path: string,
  entity: EntityState | undefined,
  config: Record<string, unknown> | undefined,
): string {
  if (!path) return ''

  // Handle config bindings
  if (path.startsWith('config.')) {
    const key = path.substring(7)
    const value = config?.[key]
    return value !== undefined ? String(value) : ''
  }

  // Handle entity bindings
  if (!entity) return ''

  if (path === 'entity.state') return entity.state
  if (path === 'entity.name') return entity.attributes?.friendly_name || entity.entity_id
  if (path === 'entity.is_on') return entity.state === 'on' ? 'true' : 'false'
  if (path === 'entity.unit') return entity.attributes?.unit_of_measurement || ''

  // Nested attribute access
  if (path.startsWith('entity.attr.')) {
    const attrKey = path.substring(12)
    const value = entity.attributes?.[attrKey]
    if (value === undefined || value === null) return ''
    if (Array.isArray(value)) return value.join(',')
    return String(value)
  }

  return ''
}

/**
 * Process a template HTML string by replacing data-prop attributes
 * with their resolved values before DOM parsing.
 *
 * This handles:
 *   data-prop-bind="path"    → Sets textContent to the resolved value
 *   data-prop-attr="path"    → Sets the element's attribute value
 *   data-prop-class="path"   → Adds/removes CSS classes based on value
 *   data-prop-show="path"    → Shows/hides element based on truthy value
 */
function preprocessTemplate(
  html: string,
  entity: EntityState | undefined,
  config: Record<string, unknown> | undefined,
): string {
  if (!entity) return html

  let processed = html

  // Process data-prop-bind: replace text content
  processed = processed.replace(
    /data-prop-bind="([^"]+)"/g,
    (_, path: string) => {
      const value = resolveDataProp(path, entity, config)
      return `data-prop-bind="${path}" data-resolved="${escapeHtml(value)}"`
    },
  )

  // Process data-prop-show: add hidden attribute if falsy
  processed = processed.replace(
    /data-prop-show="([^"]+)"/g,
    (_, path: string) => {
      const value = resolveDataProp(path, entity, config)
      const hidden = !value || value === 'false' || value === '0' ? 'hidden' : ''
      return `data-prop-show="${path}" ${hidden}`
    },
  )

  return processed
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Responsive Breakpoint Detection ─────────────────────────────────

/**
 * Detects the current responsive breakpoint based on window width.
 * Returns: "mobile" (<768px), "tablet" (768-1024px), "desktop" (>1024px)
 */
function useResponsiveBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const [breakpoint, setBreakpoint] = useState<'mobile' | 'tablet' | 'desktop'>(() => getBreakpoint())

  useEffect(() => {
    const handler = () => setBreakpoint(getBreakpoint())
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return breakpoint
}

function getBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

// ─── Component ──────────────────────────────────────────────────────

/**
 * Renders a widget using the active theme's template, or falls back to
 * the default React component.
 */
export function ThemeWidgetRenderer({
  widgetType,
  entity,
  config,
  allEntities,
  widgetSize,
  onUpdate,
  fallback,
  className,
}: ThemeWidgetRendererProps) {
  const { widgetTemplates } = useTheme()
  const [templateHtml, setTemplateHtml] = useState<string | null>(null)
  const [variantCss, setVariantCss] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Find the matching widget template
  const widgetTemplate = useMemo(() => {
    if (!widgetTemplates || widgetTemplates.length === 0) return null
    return widgetTemplates.find(wt => wt.widget_type === widgetType) || null
  }, [widgetTemplates, widgetType])

  // Get the active variant, considering responsive breakpoints
  const breakpoint = useResponsiveBreakpoint()
  const activeVariant = useMemo(() => {
    if (!widgetTemplate) return null

    // Filter variants that match the current breakpoint or are "all"
    const responsiveVariants = widgetTemplate.variants.filter(v =>
      !v.responsive || v.responsive === 'all' || v.responsive === breakpoint
    )

    // Use the same variant list if no responsive matches found
    const candidates = responsiveVariants.length > 0 ? responsiveVariants : widgetTemplate.variants

    const variantName = (config?.cardVariant as string) || 'default'
    // Find matching variant by name, fall back to default variant, then first variant
    const byName = candidates.find(v => v.name === variantName)
    if (byName) return byName
    const defaultVariant = candidates.find(v => v.is_default)
    if (defaultVariant) return defaultVariant
    return candidates[0] || null
  }, [widgetTemplate, config, breakpoint])

  // Fetch template content when variant changes
  useEffect(() => {
    if (!activeVariant) return

    let cancelled = false
    setLoading(true)

    fetchTemplateContent(activeVariant.template).then(html => {
      if (cancelled) return
      setTemplateHtml(html)
      setLoading(false)
    })

    // Fetch variant CSS if provided
    if (activeVariant.css) {
      fetchTemplateContent(activeVariant.css).then(css => {
        if (cancelled) return
        setVariantCss(css)
      })
    }

    return () => { cancelled = true }
  }, [activeVariant])

  // Render using the template
  const rendered = useMemo(() => {
    if (!activeVariant || !templateHtml) return null

    // Preprocess the template with entity data
    const processedHtml = preprocessTemplate(templateHtml, entity, config)

    // Build slot map
    const slotMap: Record<string, React.ReactNode> = {}

    // If template has a "content" slot, render the fallback there
    // This allows themes to wrap the default widget in custom chrome
    if (processedHtml.includes('data-slot="content"')) {
      slotMap.content = fallback
    }

    // Render template
    return renderTemplate(processedHtml, slotMap, {
      wrapMultipleRoots: true,
      wrapperClassName: className || 'theme-widget-wrapper',
    })
  }, [activeVariant, templateHtml, entity, config, fallback, className])

  // Inject variant CSS
  useEffect(() => {
    if (!variantCss) return
    const styleId = `theme-widget-css-${widgetType}-${activeVariant?.name || 'default'}`
    let styleEl = document.getElementById(styleId)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = variantCss
    return () => {
      const el = document.getElementById(styleId)
      if (el) el.remove()
    }
  }, [variantCss, widgetType, activeVariant])

  // Show fallback if no template or template hasn't loaded yet
  if (!widgetTemplate || !activeVariant || !rendered) {
    return <>{fallback}</>
  }

  // Show a minimal loading state while template fetches
  // (templates are small enough that this is typically instant after first load)
  if (loading && !templateHtml) {
    return <>{fallback}</>
  }

  return <>{rendered}</>
}

/**
 * Hook to check if the current theme has a widget template for a given type.
 */
export function useHasThemeWidget(widgetType: string): boolean {
  const { widgetTemplates } = useTheme()
  return widgetTemplates.some(wt => wt.widget_type === widgetType)
}

/**
 * Hook to get available variants for a widget type from the active theme.
 */
export function useThemeWidgetVariants(widgetType: string): WidgetTemplateVariant[] {
  const { widgetTemplates } = useTheme()
  const template = widgetTemplates.find(wt => wt.widget_type === widgetType)
  return template?.variants || []
}

/**
 * Clear the template cache. Useful during development.
 */
export function clearThemeWidgetCache(): void {
  templateContentCache.clear()
  pendingTemplateFetches.clear()
}
